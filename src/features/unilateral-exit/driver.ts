import { singleKeyCpfpSigner } from '@breeztech/breez-sdk-spark';
import type {
  BreezSdk,
  CheckRecoverFundsResponse,
  CpfpInput,
  PrepareRecoverFundsResponse,
  RecoverFundsResponse,
  RecoveryTransaction,
} from '@breeztech/breez-sdk-spark';
import type { ChainClient, ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { outputTotalSat } from '@/utils/rawTx';
import { loadExitState, restoreExitState } from './exitState';
import { deriveFundingKey, MnemonicNeedsPasskeyError, readWalletMnemonic, type FundingKey } from './funding';
import {EXIT_PLAN_STORAGE_PREFIX,EXIT_PENDING_STORAGE_PREFIX} from './removalProtection';

/**
 * `complete` is the sdk's `done` verdict. `redo` is its `redo`: the chain no
 * longer matches these transactions, so the exit has to be built again.
 */
export type ExitPhase = 'active' | 'complete' | 'redo';

export interface UnilateralExitPlan {
  version: 5;
  network: string;
  destination: string;
  feeRateSatPerVbyte: number;
  fundingAddressIndex: number;
  /**
   * The sweep fee the exit was quoted at: the one fee that comes off the
   * balance, so the figure shown is the balance less this. The fees the
   * funding pays do not reduce what arrives.
   */
  quotedSweepFeeSat: number;
  /**
   * What the exit was quoted to need at its fee address, from the build that
   * produced this plan. Absent on a plan written before the field existed.
   */
  quotedExitFeeSat?: number;
  /** The sdk's latest word on the exit, handed back to `checkRecoverFunds` unchanged. */
  exit: RecoverFundsResponse;
  /**
   * Why the network last refused each transaction, by txid, for diagnostics. The
   * tracker shows none: Glow retries a refusal on every check. Cleared once the
   * transaction is accepted or confirms.
   */
  refusals: Record<string, string>;
  phase: ExitPhase;
  /** Frozen when the exit was built: the operators stop reporting the leaves it moves. */
  exitStateSnapshot?: string;
}

const PLAN_VERSION = 5;

export interface WalletKey {
  identityPubkey: string;
  network: string;
}

export interface PlanMeta {
  network: string;
  destination: string;
  feeRateSatPerVbyte: number;
  fundingAddressIndex: number;
  quotedSweepFeeSat: number;
  quotedExitFeeSat?: number;
}

const storageKey = ({ identityPubkey, network }: WalletKey): string =>
  `${EXIT_PLAN_STORAGE_PREFIX}${identityPubkey.slice(0, 16)}:${network}`;

export function planFromExitResponse(exit: RecoverFundsResponse, meta: PlanMeta): UnilateralExitPlan {
  return { version: PLAN_VERSION, ...meta, exit, refusals: {}, phase: 'active' };
}

/** Folds a check onto the plan. The sdk owns the exit and the phase; glow keeps only what the network told it about its own sends. */
export function applyExitCheck(
  plan: UnilateralExitPlan,
  checked: RecoverFundsResponse,
  phase: ExitPhase,
): UnilateralExitPlan {
  const open = new Set(
    checked.transactions.filter(tx => tx.status.type !== 'confirmed').map(tx => tx.txid),
  );
  const refusals = Object.fromEntries(
    Object.entries(plan.refusals).filter(([txid]) => open.has(txid)),
  );
  return { ...plan, exit: checked, refusals, phase };
}

/** Recovery plan persistence must complete before broadcasting or clearing a pending exit.
 * Keep the whole snapshot; never silently drop it on quota failure. */
export function savePlan(wallet: WalletKey, plan: UnilateralExitPlan): void {
  const key = storageKey(wallet);
  const serialized = JSON.stringify(plan);
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) {
    throw new Error('Recovery plan could not be saved. No new exit broadcast is permitted. Keep wallet data.');
  }
}

// The plan Glow stored under SDK 0.26 (version 4). Its exit no longer parses
// as this SDK's recovery, so a stored one is converted on load.

type V4CpfpInput =
  | { type: 'p2wpkh' | 'p2tr'; txid: string; vout: number; value: number; pubkey: string }
  | { type: 'custom'; txid: string; vout: number; value: number; scriptPubkeyHex: string; signedInputWeight: number };

interface V4Exit {
  recoverableValueSat: number;
  totalFeeSat: number;
  cpfpFeeSat: number;
  fanoutFeeSat: number;
  sweepFeeSat: number;
  leaves: { leafId: string; value: number }[];
  transactions: RecoveryTransaction[];
  fundingInputs: V4CpfpInput[];
}

interface V4Plan extends Omit<UnilateralExitPlan, 'version' | 'exit'> {
  version: 4;
  exit: V4Exit;
}

const fundingInputOf = (input: V4CpfpInput): CpfpInput =>
  input.type === 'custom'
    ? {
        type: 'custom',
        txid: input.txid,
        vout: input.vout,
        valueSats: input.value,
        scriptPubkeyHex: input.scriptPubkeyHex,
        signedInputWeight: input.signedInputWeight,
      }
    : { type: input.type, txid: input.txid, vout: input.vout, valueSats: input.value, pubkey: input.pubkey };

/** The same exit in this SDK's shape. Each transaction reads the same in both, so the set keeps running. */
export function planFromV4(old: V4Plan): UnilateralExitPlan {
  const { exit, ...rest } = old;
  return {
    ...rest,
    version: PLAN_VERSION,
    exit: {
      recoverableValueSats: exit.recoverableValueSat,
      totalFeeSats: exit.totalFeeSat,
      cooperativeFeeSats: 0,
      refundFeeSats: 0,
      cpfpFeeSats: exit.cpfpFeeSat,
      fanoutFeeSats: exit.fanoutFeeSat,
      sweepFeeSats: exit.sweepFeeSat,
      leaves: exit.leaves.map(leaf => ({ leafId: leaf.leafId, valueSats: leaf.value, method: 'unilateral' })),
      failed: [],
      transactions: exit.transactions,
      fundingInputs: exit.fundingInputs.map(fundingInputOf),
      feeRateSatPerVbyte: old.feeRateSatPerVbyte,
      destination: old.destination,
    },
  };
}

export function loadPlan(wallet: WalletKey): UnilateralExitPlan | null {
  const raw = localStorage.getItem(storageKey(wallet));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UnilateralExitPlan | V4Plan;
    if (!Array.isArray(parsed?.exit?.transactions)) return null;
    if (parsed.version === 4) return planFromV4(parsed);
    return parsed.version === PLAN_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPlan(wallet: WalletKey): void {
  localStorage.removeItem(storageKey(wallet));
}

/**
 * An exit saved when its fee address is first shown, before anything is built.
 * The user starts it once confirmed coins at the address pay for it.
 */
export interface PendingExit {
  network: string;
  destination: string;
  feeRateSatPerVbyte: number;
  fundingAddressIndex: number;
  fundingAddress: string;
  /** The quote's figure, until a start that fell short replaces it with the build's. */
  required: Funding;
  /** What the quote said would arrive, shown until the exit is built. */
  willReceiveSat: number;
}

const pendingKey = ({ identityPubkey, network }: WalletKey): string =>
  `${EXIT_PENDING_STORAGE_PREFIX}${identityPubkey.slice(0, 16)}:${network}`;

export function savePendingExit(wallet: WalletKey, pending: PendingExit): void {
  const key = pendingKey(wallet);
  const serialized = JSON.stringify(pending);
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) {
    throw new Error('Pending exit could not be saved. Do not fund or replace this exit yet.');
  }
}

export function loadPendingExit(wallet: WalletKey): PendingExit | null {
  const raw = localStorage.getItem(pendingKey(wallet));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingExit;
    return typeof parsed?.fundingAddress === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingExit(wallet: WalletKey): void {
  localStorage.removeItem(pendingKey(wallet));
}

/**
 * The sweep fee an exit is held to. A rebuild is quoted on the refunds it has
 * left to sweep, so an earlier quote stays the floor; a quote at a higher rate
 * replaces it.
 */
export function quotedSweepFeeSat(
  quote: PrepareRecoverFundsResponse,
  resuming: UnilateralExitPlan | null,
): number {
  return Math.max(quote.sweepFeeSats, resuming?.quotedSweepFeeSat ?? 0);
}

/** The fees besides the sweep's that come off the leaves' own value: the cooperative recoveries' and the refunds'. */
export const leafFeesSat = (exit: { cooperativeFeeSats: number; refundFeeSats: number }): number =>
  exit.cooperativeFeeSats + exit.refundFeeSats;

const isConfirmed = (tx: RecoveryTransaction): boolean => tx.status.type === 'confirmed';

/**
 * What pays the destination: the sweep of the unilateral leaves, and one
 * transaction per cooperative leaf. An exit can have either part alone.
 */
const deliveries = (transactions: RecoveryTransaction[]): RecoveryTransaction[] =>
  transactions.filter(tx => tx.kind === 'sweep' || tx.kind === 'cooperative');

/**
 * What the destination address ends up with: the balance less the fees taken
 * from it, until everything paying the destination confirms and the figure is
 * read off those transactions.
 *
 * The funding is not counted. It pays the other fees, and what it has left
 * comes back only if the sweep glow built is the one that lands.
 */
export function willReceiveSat(
  exit: PrepareRecoverFundsResponse | UnilateralExitPlan,
  resuming: UnilateralExitPlan | null = null,
): number {
  if (!('exit' in exit)) {
    return Math.max(0, exit.recoverableValueSats - quotedSweepFeeSat(exit, resuming) - leafFeesSat(exit));
  }
  const paying = deliveries(exit.exit.transactions);
  const paid = paying.map(tx => (isConfirmed(tx) ? outputTotalSat(tx.txHex) : null));
  if (paid.length > 0 && paid.every(sat => sat !== null)) {
    return paid.reduce<number>((sum, sat) => sum + (sat ?? 0), 0);
  }
  return Math.max(0, exit.exit.recoverableValueSats - exit.quotedSweepFeeSat - leafFeesSat(exit.exit));
}

/** Whether a quote moves anything worth more than it costs to move. */
export const isWorthExiting = (
  quote: PrepareRecoverFundsResponse,
  receiveSat: number = willReceiveSat(quote),
): boolean => quote.leaves.length > 0 && quote.totalFeeSats < quote.recoverableValueSats && receiveSat > 0;

/**
 * Where the money is. A leaf sits in Spark until its refund is on-chain, then
 * in an output only the owner can spend, and reaches the destination when the
 * sweep confirms. A cooperative leaf is on-chain from the start, the operators
 * having moved it, and reaches the destination when its own recovery confirms.
 */
export interface ExitStages {
  inSpark: number;
  onChain: number;
  delivered: number;
  willReceive: number;
}

export function exitStages(plan: UnilateralExitPlan): ExitStages {
  const willReceive = willReceiveSat(plan);
  const { transactions, leaves } = plan.exit;
  const paying = deliveries(transactions);
  if (paying.length > 0 && paying.every(isConfirmed)) {
    return { inSpark: 0, onChain: 0, delivered: willReceive, willReceive };
  }

  const sweep = transactions.find(tx => tx.kind === 'sweep');
  const swept = sweep !== undefined && isConfirmed(sweep);
  const recovered = new Map(
    transactions.filter(tx => tx.kind === 'cooperative' && isConfirmed(tx)).map(tx => [tx.nodeId, tx]),
  );
  const refunded = new Set(
    transactions.filter(tx => tx.kind === 'refund' && isConfirmed(tx)).map(tx => tx.nodeId),
  );
  const stages = { inSpark: 0, onChain: 0, delivered: swept ? (outputTotalSat(sweep.txHex) ?? 0) : 0, willReceive };
  for (const leaf of leaves) {
    if (leaf.method === 'cooperative') {
      const recovery = recovered.get(leaf.leafId);
      if (recovery) stages.delivered += outputTotalSat(recovery.txHex) ?? 0;
      else stages.onChain += leaf.valueSats;
    } else if (!swept) {
      if (refunded.has(leaf.leafId)) stages.onChain += leaf.valueSats;
      else stages.inSpark += leaf.valueSats;
    }
  }
  return stages;
}

/**
 * Blocks until the last step could confirm: the longest path left through the
 * set, each step costing its remaining timelock plus a block to confirm in.
 * Null once nothing is left to send. Relies on the sdk returning the set in
 * broadcast order, so a dependency is always reached before what depends on it.
 */
export function blocksToFinish(all: RecoveryTransaction[], tipHeight: number): number | null {
  const after = new Map<string, number>();
  let longest: number | null = null;

  for (const tx of all) {
    if (tx.status.type === 'confirmed') {
      after.set(tx.txid, 0);
      continue;
    }
    // A ready step's timelock has matured; a started one counts down from the
    // height the sdk gives; one not yet started lies wholly ahead of whatever
    // its dependency waits on.
    const timelock =
      tx.status.type === 'ready'
        ? 0
        : tx.status.type === 'waitingForTimelock' && tx.status.spendableAtHeight !== undefined
          ? Math.max(0, tx.status.spendableAtHeight - tipHeight)
          : (tx.csvTimelockBlocks ?? 0);
    const waits = tx.dependsOn.map(id => after.get(id) ?? 0);
    const blocks = (waits.length > 0 ? Math.max(...waits) : 0) + timelock + 1;

    after.set(tx.txid, blocks);
    longest = longest === null ? blocks : Math.max(longest, blocks);
  }
  return longest;
}

/** The slice of the sdk a pass drives. */
export type ExitSdk = Pick<
  BreezSdk,
  | 'checkRecoverFunds'
  | 'prepareRecoverFunds'
  | 'recoverFunds'
  | 'importUnilateralExitState'
  | 'exportUnilateralExitState'
>;

/** The sdk resolves this against the chain tip, timelock included. */
export const isReady = (tx: RecoveryTransaction): boolean => tx.status.type === 'ready';

export { destinationAddressOf } from '@/utils/destinationAddress';

/** What a build said it needs: the sdk's error reaches the page only as its message. */
export function requiredFundingOf(error: string): number | null {
  const match = /need at least (\d+) sats/i.exec(error);
  return match ? Number(match[1]) : null;
}

export interface Funding {
  sat: number;
  inputs: number;
}

/**
 * What a build counts as sent to the exit fee address: the exit's own funding
 * until one of its transactions confirms, since the sdk replaces an unconfirmed
 * spender rather than building on it, plus every confirmed coin there.
 * ponytail: mirrors the sdk's rules; take the figure from the sdk once its
 * shortfall error reports what it counted.
 */
export function sentFunding(
  plan: UnilateralExitPlan | null,
  confirmed: { txid: string; vout: number; value: number }[],
): Funding {
  const own = plan && !plan.exit.transactions.some(tx => tx.status.type === 'confirmed')
    ? plan.exit.fundingInputs.map(input => ({ txid: input.txid, vout: input.vout, value: input.valueSats }))
    : [];
  const coins = new Map([...own, ...confirmed].map(coin => [`${coin.txid}:${coin.vout}`, coin.value]));
  return { sat: [...coins.values()].reduce((total, value) => total + value, 0), inputs: coins.size };
}

/** A signed P2WPKH input: each coin at the exit fee address is one more for the build to pay for. */
const P2WPKH_INPUT_VBYTES = 68;

export interface TopUp {
  /** What the address needs at the new rate, the coin still to send included. */
  neededSat: number;
  sentSat: number;
  stillToSendSat: number;
}

/**
 * What to send after a build fell short. The sdk sized `required` on the inputs
 * that build had, so each coin sent since, and the one still to send, adds its
 * own input fee. A quote is sized on the one coin it assumes, so its first coin
 * adds nothing.
 */
export function topUpFor(required: Funding, sent: Funding, feeRateSatPerVbyte: number): TopUp {
  const inputFeeSat = Math.ceil(P2WPKH_INPUT_VBYTES * feeRateSatPerVbyte);
  const neededNowSat = required.sat + inputFeeSat * Math.max(0, sent.inputs - required.inputs);
  const nextCoinSat = sent.inputs < required.inputs ? 0 : inputFeeSat;
  const neededSat = sent.sat >= neededNowSat ? neededNowSat : neededNowSat + nextCoinSat;
  return { neededSat, sentSat: sent.sat, stillToSendSat: Math.max(0, neededSat - sent.sat) };
}

/** What a pending exit's fee address still needs. Unconfirmed coins count, so a payment on its way is not asked for twice. */
export const pendingTopUp = (pending: PendingExit, coins: ChainUtxo[]): TopUp =>
  topUpFor(pending.required, sentFunding(null, coins), pending.feeRateSatPerVbyte);

/** Whether the confirmed coins at the fee address pay for the exit, so it can be started. */
export const isPendingFunded = (pending: PendingExit, coins: ChainUtxo[]): boolean =>
  pendingTopUp(pending, coins.filter(coin => coin.confirmed)).stillToSendSat === 0;

export type StartOutcome =
  | { type: 'started'; plan: UnilateralExitPlan }
  | { type: 'short'; required: Funding }
  | { type: 'nothingToExit' };

/**
 * Builds a pending exit from its confirmed fee coins, on the user's tap. It
 * quotes again first, so it exits what the wallet holds now: a payment or a
 * leaf swap since the first quote would fail a build that names the leaves
 * that quote picked.
 *
 * The key is read before anything else, while the tap is fresh enough for a
 * passkey prompt. `key` is one the wizard already derived.
 */
export async function startExit(
  pending: PendingExit,
  coins: ChainUtxo[],
  sdk: ExitSdk,
  identityPubkey: string,
  key?: FundingKey,
): Promise<StartOutcome> {
  const { network, destination, feeRateSatPerVbyte, fundingAddressIndex } = pending;
  const { publicKeyHex, secretKey } =
    key ?? deriveFundingKey(await readWalletMnemonic({ interactive: true }), network, fundingAddressIndex);
  await restoreExitState(sdk, null, await loadExitState(identityPubkey).catch(() => null));

  const quote = await sdk.prepareRecoverFunds({
    feeRateSatPerVbyte,
    fundingKind: { type: 'p2wpkh' },
    destination,
    selection: { type: 'all' },
  });
  if (!isWorthExiting(quote)) return { type: 'nothingToExit' };

  const fundingInputs: CpfpInput[] = coins.map(({ txid, vout, value }) => ({
    type: 'p2wpkh',
    txid,
    vout,
    valueSats: value,
    pubkey: publicKeyHex,
  }));
  let exit: RecoverFundsResponse;
  try {
    exit = await sdk.recoverFunds({ prepared: quote, fundingInputs }, singleKeyCpfpSigner(secretKey));
  } catch (e) {
    const required = requiredFundingOf(e instanceof Error ? e.message : String(e));
    if (required === null) throw e;
    return { type: 'short', required: { sat: required, inputs: coins.length } };
  }

  // Frozen now: from here the operators stop reporting the leaves this exit moves.
  const exitStateSnapshot = await sdk
    .exportUnilateralExitState()
    .then(r => r.exitState)
    .catch(() => undefined);
  const meta = { network, destination, feeRateSatPerVbyte, fundingAddressIndex, quotedSweepFeeSat: quote.sweepFeeSats, quotedExitFeeSat: quote.funding?.singleUtxoSats };
  return { type: 'started', plan: { ...planFromExitResponse(exit, meta), exitStateSnapshot } };
}

export interface PlanProgress {
  confirmed: number;
  total: number;
  isComplete: boolean;
}

/** `isComplete` follows the sdk's verdict: only a confirmed sweep finishes an exit. */
export function planProgress(plan: UnilateralExitPlan): PlanProgress {
  const { transactions } = plan.exit;
  const confirmed = transactions.filter(tx => tx.status.type === 'confirmed').length;
  return { confirmed, total: transactions.length, isComplete: plan.phase === 'complete' };
}

export interface NextAction {
  blocks: number;
  /** How many steps that wait releases. */
  transactions: number;
}

/**
 * The next timelock to mature, and what it frees. A step that is ready is
 * already being sent, so it is not something to wait for.
 */
export function nextAction(all: RecoveryTransaction[], tipHeight: number): NextAction | null {
  const waits = all.flatMap(tx =>
    tx.status.type === 'waitingForTimelock' && tx.status.spendableAtHeight !== undefined
      ? [Math.max(0, tx.status.spendableAtHeight - tipHeight)]
      : [],
  );
  if (waits.length === 0) return null;
  const blocks = Math.min(...waits);
  return { blocks, transactions: waits.filter(w => w === blocks).length };
}

const phaseOf = (verdict: CheckRecoverFundsResponse['verdict']): ExitPhase => {
  switch (verdict.type) {
    case 'done':
      return 'complete';
    case 'redo':
      return 'redo';
    default:
      return 'active';
  }
};

/** Reads the exit back against the chain. Needs nothing but the stored response, so it works with the leaves gone from the operators' view. */
export async function checkExit(plan: UnilateralExitPlan, sdk: ExitSdk): Promise<UnilateralExitPlan> {
  const checked = await sdk.checkRecoverFunds({ recovery: plan.exit });
  return applyExitCheck(plan, checked.recovery, phaseOf(checked.verdict));
}

/**
 * Builds the exit again over whatever the chain now holds, keeping its leaves,
 * destination, fee rate and funding. Null when there is nothing left to build,
 * which leaves the stored exit as it was.
 *
 * A background pass never asks for the recovery phrase: a wallet that keeps
 * none on the device throws, and the tracker offers the rebuild as a button.
 * The button passes `interactive`, since its tap is what lets a passkey
 * prompt run. The phrase is read first, while that tap is still fresh.
 */
export async function rebuildExit(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  { interactive = false }: { interactive?: boolean } = {},
): Promise<UnilateralExitPlan | null> {
  const key = deriveFundingKey(
    await readWalletMnemonic({ interactive }),
    plan.network,
    plan.fundingAddressIndex,
  );
  await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));

  // Named, not reselected: `all` can drop a leaf that is part-way out.
  const prepared = await sdk.prepareRecoverFunds({
    feeRateSatPerVbyte: plan.feeRateSatPerVbyte,
    fundingKind: { type: 'p2wpkh' },
    destination: plan.destination,
    selection: { type: 'specific', leafIds: plan.exit.leaves.map(leaf => leaf.leafId) },
  });
  if (prepared.leaves.length === 0) return null;

  const rebuilt = await sdk.recoverFunds(
    { prepared, fundingInputs: plan.exit.fundingInputs },
    singleKeyCpfpSigner(key.secretKey),
  );
  if (rebuilt.transactions.length === 0) return null;

  const { network, destination, feeRateSatPerVbyte, fundingAddressIndex, quotedSweepFeeSat } = plan;
  return {
    ...planFromExitResponse(rebuilt, { network, destination, feeRateSatPerVbyte, fundingAddressIndex, quotedSweepFeeSat }),
    exitStateSnapshot: plan.exitStateSnapshot,
  };
}

/**
 * Sends every step whose turn has come, again on every pass: a node already
 * holding one answers as if it were sent, and one the mempool has since dropped
 * is put back. A refusal is kept on the step and retried, since the operators'
 * watchtower may settle it with its own copy.
 */
export async function broadcastReadyTransactions(
  plan: UnilateralExitPlan,
  chain: ChainClient,
): Promise<UnilateralExitPlan> {
  const refusals = { ...plan.refusals };
  for (const tx of plan.exit.transactions.filter(isReady)) {
    try {
      if (tx.cpfpTxHex) await chain.broadcastPackage(tx.txHex, tx.cpfpTxHex);
      else await chain.broadcast(tx.txHex);
      delete refusals[tx.txid];
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to broadcast recovery transaction ${tx.txid}: ${reason}`);
      refusals[tx.txid] = reason;
    }
  }
  return { ...plan, refusals };
}

export async function advanceUnilateralExit(
  plan: UnilateralExitPlan,
  chain: ChainClient,
  sdk?: ExitSdk,
  identityPubkey?: string,
): Promise<{ plan: UnilateralExitPlan; tipHeight: number }> {
  const tipHeight = await chain.tipHeight();
  let next = plan;
  if (sdk) {
    try {
      next = await checkExit(next, sdk);
    } catch (e) {
      // Not shown: the next pass tries again, and the log keeps the reason.
      const error = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to read the exit back from the sdk: ${error}`);
    }
  }

  // The chain diverging is routine: the operators' watchtower publishes its own
  // copy of a refund. The exit is rebuilt over what is now on-chain.
  if (next.phase === 'redo' && sdk && identityPubkey) {
    try {
      next = (await rebuildExit(next, sdk, identityPubkey)) ?? next;
    } catch (e) {
      // Waiting on the user to sign in is the designed path, not a fault: the
      // exit stays in `redo` and the tracker offers the rebuild as a button.
      if (e instanceof MnemonicNeedsPasskeyError) return { plan: next, tipHeight };
      const error = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to rebuild the exit: ${error}`);
    }
  }

  if (next.phase !== 'active') return { plan: next, tipHeight };
  return { plan: await broadcastReadyTransactions(next, chain), tipHeight };
}
