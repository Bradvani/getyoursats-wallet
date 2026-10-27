import {
  advanceUnilateralExit,
  applyExitCheck,
  blocksToFinish,
  broadcastReadyTransactions,
  checkExit,
  clearPlan,
  destinationAddressOf,
  exitStages,
  isReady,
  loadPlan,
  nextAction,
  planFromExitResponse,
  requiredFundingOf,
  sentFunding,
  topUpFor,
  planProgress,
  quotedSweepFeeSat,
  savePlan,
  startExit,
  willReceiveSat,
} from './driver';
import {
  blocked,
  checked,
  coin as feeCoin,
  confirmed,
  locked,
  MNEMONIC,
  paying,
  pendingExit,
  plan,
  prepared,
  ready,
  sdk,
  tx,
} from './testFixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckRecoverFundsRequest, RecoveryVerdict } from '@breeztech/breez-sdk-spark';
import type { ChainClient } from '@/services/chain';

const meta = {
  network: 'mainnet',
  destination: 'bc1qdest',
  feeRateSatPerVbyte: 3,
  fundingAddressIndex: 0,
  quotedSweepFeeSat: 200,
};

describe('planFromExitResponse', () => {
  it('keeps the sdk response whole, for the check to read back', () => {
    const exit = checked([{ txid: 'node-1' }], {
      fundingInputs: [{ type: 'p2wpkh', txid: 'fund', vout: 0, valueSats: 50_000, pubkey: '02ab' }],
    });
    const built = planFromExitResponse(exit, meta);
    expect(built.exit).toBe(exit);
    expect(built).toMatchObject({ ...meta, phase: 'active', refusals: {} });
  });
});

describe('applyExitCheck', () => {
  it('takes the sdk word on the whole exit', () => {
    const exit = checked([{ txid: 'a', status: confirmed(812_345) }], { sweepFeeSats: 250 });
    expect(applyExitCheck(plan([tx({ txid: 'a' })]), exit, 'active').exit).toBe(exit);
  });

  it('keeps the refusal on a step that is still out there', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' })], { refusals: { a: 'txn-mempool-conflict' } }),
      checked([{ txid: 'a', status: ready }]),
      'active',
    );
    expect(next.refusals).toEqual({ a: 'txn-mempool-conflict' });
  });

  it('drops the refusal once the step has confirmed, or is no longer in the set', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' }), tx({ txid: 'b' })], { refusals: { a: 'conflict', b: 'conflict' } }),
      checked([{ txid: 'a', status: confirmed(1) }]),
      'active',
    );
    expect(next.refusals).toEqual({});
  });

  it('sets the phase', () => {
    const next = applyExitCheck(plan([tx({ txid: 'a' })]), checked([{ txid: 'a' }]), 'complete');
    expect(next.phase).toBe('complete');
  });
});

describe('storing a plan', () => {
  beforeEach(() => localStorage.clear());

  const wallet = { identityPubkey: '02abcdef0123456789', network: 'mainnet' };
  const key = `recovery-plan:${wallet.identityPubkey.slice(0, 16)}:mainnet`;

  it('returns null when no plan was ever saved', () => {
    expect(loadPlan(wallet)).toBeNull();
  });

  it('round-trips a saved plan', () => {
    const built = plan([tx({ txid: 'a' })]);
    savePlan(wallet, built);
    expect(loadPlan(wallet)).toEqual(built);
  });

  // A plan saved under SDK 0.26 holds an exit this SDK no longer parses.
  it('reads a plan saved under the previous SDK in the current shape', () => {
    const transactions = [tx({ txid: 'a', kind: 'refund' })];
    const { exit, ...rest } = plan(transactions);
    localStorage.setItem(key, JSON.stringify({
      ...rest,
      version: 4,
      exit: {
        recoverableValueSat: 100_000,
        totalFeeSat: 2_000,
        cpfpFeeSat: 1_800,
        fanoutFeeSat: 0,
        sweepFeeSat: 200,
        leaves: [{ leafId: 'leaf-1', value: 100_000 }],
        transactions,
        fundingInputs: [{ type: 'p2wpkh', txid: 'fund', vout: 0, value: 50_000, pubkey: '02ab' }],
      },
    }));

    expect(loadPlan(wallet)).toEqual({
      ...rest,
      exit: {
        ...exit,
        fundingInputs: [{ type: 'p2wpkh', txid: 'fund', vout: 0, valueSats: 50_000, pubkey: '02ab' }],
      },
    });
  });

  it('keeps plans of different wallets and networks apart', () => {
    savePlan(wallet, plan([tx({ txid: 'a' })]));
    expect(loadPlan({ identityPubkey: '03999999', network: 'mainnet' })).toBeNull();
    expect(loadPlan({ ...wallet, network: 'regtest' })).toBeNull();
  });

  it('forgets a cleared plan', () => {
    savePlan(wallet, plan([tx({ txid: 'a' })]));
    clearPlan(wallet);
    expect(loadPlan(wallet)).toBeNull();
  });

  it('ignores a stored plan of another version', () => {
    localStorage.setItem(key, JSON.stringify({ ...plan([tx({ txid: 'a' })]), version: 3 }));
    expect(loadPlan(wallet)).toBeNull();
  });

  it('ignores unparseable stored data', () => {
    localStorage.setItem(key, '{oops');
    expect(loadPlan(wallet)).toBeNull();
  });
});

// one input, one 596 524 sat output
const sweepHex =
  '0200000001' + '00'.repeat(32) + '00000000' + '00' + 'ffffffff' +
  '01' + '2c1a090000000000' + '160014' + 'ab'.repeat(20) + '00000000';

/** A unilateral leaf and one the operators' watchtower already moved on-chain, recovered cooperatively. */
const mixed = (transactions: Parameters<typeof plan>[0]) =>
  plan(transactions, {
    quotedSweepFeeSat: 215,
    exit: {
      leaves: [
        { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
        { leafId: 'leaf-2', valueSats: 420_000, method: 'cooperative' },
      ],
      recoverableValueSats: 600_000,
      cooperativeFeeSats: 1_000,
      refundFeeSats: 300,
      sweepFeeSats: 0,
    },
  });

const cooperativeOnly = (status: ReturnType<typeof confirmed> = ready) =>
  plan([tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-2', txHex: paying(418_000), status })], {
    quotedSweepFeeSat: 0,
    exit: {
      leaves: [{ leafId: 'leaf-2', valueSats: 420_000, method: 'cooperative' }],
      recoverableValueSats: 420_000,
      cooperativeFeeSats: 2_000,
      sweepFeeSats: 0,
    },
  });

const twoLeaves = (transactions: Parameters<typeof plan>[0], over: Parameters<typeof plan>[1] = {}) =>
  plan(transactions, {
    quotedSweepFeeSat: 215,
    ...over,
    exit: {
      leaves: [
        { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
        { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
      ],
      recoverableValueSats: 600_000,
      totalFeeSats: 3_122,
      cpfpFeeSats: 2_907,
      sweepFeeSats: 0,
      ...over.exit,
    },
  });

describe('willReceiveSat', () => {
  it('is the balance less the sweep fee: the other fees come out of the funding', () => {
    const quote = prepared({ recoverableValueSats: 600_000, totalFeeSats: 3_122, cpfpFeeSats: 2_907, sweepFeeSats: 215 });
    expect(willReceiveSat(quote)).toBe(599_785);
  });

  it('says the same thing on the quote and on the exit built from it', () => {
    const quote = prepared({ recoverableValueSats: 600_000, totalFeeSats: 3_122, cpfpFeeSats: 2_907, sweepFeeSats: 215 });
    // A fresh build carries no sweep yet, so the sdk reports its fee as zero there.
    const built = planFromExitResponse(
      checked([{ txid: 'r', kind: 'refund' }], { recoverableValueSats: 600_000, sweepFeeSats: 0 }),
      { ...meta, quotedSweepFeeSat: quotedSweepFeeSat(quote, null) },
    );
    expect(willReceiveSat(built)).toBe(willReceiveSat(quote));
    expect(willReceiveSat(built)).toBe(599_785);
  });

  it('does not move when a check or rebuild reprices the exit', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 'r', kind: 'refund' })], { exit: { totalFeeSats: 214, sweepFeeSats: 214 } }))).toBe(599_785);
  });

  it('holds a resumed quote to the sweep fee the exit was first quoted at', () => {
    const resuming = twoLeaves([]);
    expect(quotedSweepFeeSat(prepared({ sweepFeeSats: 180 }), resuming)).toBe(215);
    expect(willReceiveSat(prepared({ recoverableValueSats: 600_000, sweepFeeSats: 180 }), resuming)).toBe(599_785);
  });

  it('lets a quote at a higher rate cost more', () => {
    expect(quotedSweepFeeSat(prepared({ sweepFeeSats: 900 }), twoLeaves([]))).toBe(900);
  });

  it('reports what a confirmed sweep actually paid', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(1) })]))).toBe(596_524);
  });

  it('ignores an unconfirmed sweep, which may still be rebuilt', () => {
    expect(willReceiveSat(twoLeaves([tx({ txid: 's', kind: 'sweep', txHex: sweepHex })]))).toBe(599_785);
  });

  // Like the sweep's, these come off the leaves' own value; CPFP and fan-out come out of the funding.
  it('takes the cooperative and refund fees off the balance too', () => {
    const quote = prepared({
      recoverableValueSats: 600_000,
      sweepFeeSats: 215,
      cooperativeFeeSats: 1_000,
      refundFeeSats: 300,
    });
    expect(willReceiveSat(quote)).toBe(598_485);
    const built = planFromExitResponse(
      checked([{ txid: 'r', kind: 'refund' }], { recoverableValueSats: 600_000, cooperativeFeeSats: 1_000, refundFeeSats: 300 }),
      { ...meta, quotedSweepFeeSat: quotedSweepFeeSat(quote, null) },
    );
    expect(willReceiveSat(built)).toBe(598_485);
  });

  it('adds up the sweep and every cooperative recovery once all of them confirm', () => {
    expect(willReceiveSat(mixed([
      tx({ txid: 's', kind: 'sweep', txHex: paying(178_000), status: confirmed(1) }),
      tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-2', txHex: paying(418_000), status: confirmed(1) }),
    ]))).toBe(596_000);
  });

  it('keeps estimating while a cooperative recovery is unconfirmed, sweep or not', () => {
    expect(willReceiveSat(mixed([
      tx({ txid: 's', kind: 'sweep', txHex: paying(178_000), status: confirmed(1) }),
      tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-2', txHex: paying(418_000) }),
    ]))).toBe(598_485);
  });

  it('reads an exit without a sweep off its cooperative recoveries', () => {
    expect(willReceiveSat(cooperativeOnly(confirmed(1)))).toBe(418_000);
  });
});

describe('exitStages', () => {
  it('holds everything in Spark before any refund lands', () => {
    const stages = exitStages(
      twoLeaves([tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1' }), tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2' })]),
    );
    expect(stages).toMatchObject({ inSpark: 600_000, onChain: 0, delivered: 0 });
  });

  it('counts a leaf as out of Spark once its refund confirms', () => {
    const stages = exitStages(
      twoLeaves([
        tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2' }),
      ]),
    );
    expect(stages).toMatchObject({ inSpark: 420_000, onChain: 180_000, delivered: 0 });
  });

  it('does not credit a leaf whose refund is only in the mempool', () => {
    expect(exitStages(twoLeaves([tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: ready })])).onChain).toBe(0);
  });

  it('moves everything to the destination once the sweep confirms', () => {
    const stages = exitStages(
      twoLeaves([
        tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
        tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(900) }),
      ]),
    );
    expect(stages).toEqual({ inSpark: 0, onChain: 0, delivered: 596_524, willReceive: 596_524 });
  });

  it('holds a cooperative leaf on-chain, the operators having moved it there', () => {
    const stages = exitStages(mixed([
      tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-2', txHex: paying(418_000) }),
      tx({ txid: 's', kind: 'sweep', txHex: paying(178_000) }),
    ]));
    expect(stages).toMatchObject({ inSpark: 180_000, onChain: 420_000, delivered: 0 });
  });

  it('delivers a cooperative leaf once its recovery confirms, ahead of the sweep', () => {
    const stages = exitStages(mixed([
      tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-2', txHex: paying(418_000), status: confirmed(900) }),
      tx({ txid: 's', kind: 'sweep', txHex: paying(178_000) }),
    ]));
    expect(stages).toMatchObject({ inSpark: 180_000, onChain: 0, delivered: 418_000 });
  });

  it('delivers the unilateral leaves with the sweep while a cooperative recovery waits', () => {
    const stages = exitStages(mixed([
      tx({ txid: 's', kind: 'sweep', txHex: paying(178_000), status: confirmed(900) }),
      tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-2', txHex: paying(418_000) }),
    ]));
    expect(stages).toMatchObject({ inSpark: 0, onChain: 420_000, delivered: 178_000 });
  });

  it('finishes an exit without a sweep once its cooperative recoveries confirm', () => {
    expect(exitStages(cooperativeOnly(confirmed(900))))
      .toEqual({ inSpark: 0, onChain: 0, delivered: 418_000, willReceive: 418_000 });
  });
});

describe('blocksToFinish', () => {
  it('is null once every step has confirmed', () => {
    expect(blocksToFinish([tx({ txid: 'a', status: confirmed(90) })], 100)).toBeNull();
  });

  it('is a block for a single step that can go out now', () => {
    expect(blocksToFinish([tx({ txid: 'a' })], 100)).toBe(1);
  });

  it('uses the height the sdk says a started timelock matures at', () => {
    const parent = tx({ txid: 'p', status: confirmed(100) });
    const refund = tx({ txid: 'r', kind: 'refund', dependsOn: ['p'], csvTimelockBlocks: 2000, status: locked(2100) });
    expect(blocksToFinish([parent, refund], 500)).toBe(1601);
  });

  it('counts the whole timelock while the parent is still unconfirmed', () => {
    const parent = tx({ txid: 'p', status: ready });
    const refund = tx({ txid: 'r', kind: 'refund', dependsOn: ['p'], csvTimelockBlocks: 2000, status: blocked });
    expect(blocksToFinish([parent, refund], 500)).toBe(2002);
  });

  it('follows the longest path rather than the first', () => {
    const parent = tx({ txid: 'p', status: confirmed(100) });
    const quick = tx({ txid: 'q', dependsOn: ['p'], csvTimelockBlocks: 144, status: locked(244) });
    const slow = tx({ txid: 's', dependsOn: ['p'], csvTimelockBlocks: 2000, status: locked(2100) });
    const sweep = tx({ txid: 'w', kind: 'sweep', dependsOn: ['q', 's'], status: blocked });
    expect(blocksToFinish([parent, quick, slow, sweep], 100)).toBe(2002);
  });

  it('reports the sweep alone once the refunds are in', () => {
    const refund = tx({ txid: 'r', kind: 'refund', status: confirmed(50) });
    const sweep = tx({ txid: 'w', kind: 'sweep', dependsOn: ['r'], status: ready });
    expect(blocksToFinish([refund, sweep], 60)).toBe(1);
  });
});

const chain = (over: Partial<ChainClient> = {}): ChainClient => ({
  feeRates: async () => ({ slow: 1, medium: 2, fast: 3 }),
  addressUtxos: async () => [],
  tipHeight: async () => 100,
  broadcast: async () => undefined,
  broadcastPackage: async () => undefined,
  ...over,
});

const redo: RecoveryVerdict = { type: 'redo', reason: 'onChainStateDiverged' };

const checking = (exit: ReturnType<typeof checked>, verdict: RecoveryVerdict = { type: 'valid' }) =>
  sdk({ checkRecoverFunds: async () => ({ recovery: exit, verdict }) });

describe('broadcastReadyTransactions', () => {
  it('sends a package when the step has a cpfp child', async () => {
    const broadcastPackage = vi.fn(async () => undefined);
    await broadcastReadyTransactions(plan([tx({ txid: 'a', cpfpTxHex: 'bb' })]), chain({ broadcastPackage }));
    expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb');
  });

  it('leaves a step the sdk is still waiting on alone', async () => {
    const broadcast = vi.fn(async () => undefined);
    await broadcastReadyTransactions(plan([tx({ txid: 'a', status: blocked })]), chain({ broadcast }));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('sends a ready step on every pass, so one the mempool dropped is put back', async () => {
    const broadcast = vi.fn(async () => undefined);
    const client = chain({ broadcast });
    const once = await broadcastReadyTransactions(plan([tx({ txid: 'a' })]), client);
    await broadcastReadyTransactions(once, client);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('keeps a refusal on the step without giving up on it', async () => {
    const client = chain({
      broadcast: async () => {
        throw new Error('bad-txns-inputs-missingorspent');
      },
    });
    const after = await broadcastReadyTransactions(plan([tx({ txid: 'a' })]), client);
    expect(after.refusals.a).toMatch(/missingorspent/);
    expect(isReady(after.exit.transactions[0])).toBe(true);
  });

  it('clears the refusal once the network takes the step', async () => {
    const after = await broadcastReadyTransactions(plan([tx({ txid: 'a' })], { refusals: { a: 'min relay fee not met' } }), chain());
    expect(after.refusals).toEqual({});
  });
});

describe('advanceUnilateralExit', () => {
  // A rebuild derives the fee key from the phrase the wallet is unlocked with.
  beforeEach(() => {
    localStorage.setItem(
      'walletMnemonic',
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    );
  });

  it('adopts what the check found on-chain, so a step settled elsewhere counts as done', async () => {
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'refund', kind: 'refund' })]),
      chain(),
      checking(checked([{ txid: 'refund', kind: 'refund', status: confirmed(812_345) }])),
    );
    expect(next.exit.transactions[0].status).toEqual({ type: 'confirmed', blockHeight: 812_345 });
  });

  it('finishes the exit on the done verdict', async () => {
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 's', kind: 'sweep' })]),
      chain(),
      checking(checked([{ txid: 's', kind: 'sweep', status: confirmed(9) }]), { type: 'done' }),
    );
    expect(next.phase).toBe('complete');
  });

  it('stops sending once the chain has diverged and nothing can be rebuilt', async () => {
    const broadcast = vi.fn(async () => undefined);
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'a' })]),
      chain({ broadcast }),
      checking(checked([{ txid: 'a' }]), redo),
      '02abc',
    );
    expect(next.phase).toBe('redo');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rebuilds itself when the chain diverges, rather than waiting on the user', async () => {
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => prepared(),
      recoverFunds: async () => checked([{ txid: 'fresh', status: ready }]),
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(next.phase).toBe('active');
    expect(next.exit.transactions.map(t => t.txid)).toEqual(['fresh']);
  });

  it('names the leaves it is rebuilding rather than letting them be reselected', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared());
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds,
      recoverFunds: async () => checked([{ txid: 'fresh', status: ready }]),
    });
    await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(prepareRecoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { type: 'specific', leafIds: ['leaf-1'] } }),
    );
  });

  it('hands the funding it was built from back, for the sdk to follow', async () => {
    const recoverFunds = vi.fn(async () => checked([{ txid: 'fresh', status: ready }]));
    const funding = [{ type: 'p2wpkh' as const, txid: 'f', vout: 0, valueSats: 40_000, pubkey: '02ab' }];
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }], { fundingInputs: funding }), verdict: redo }),
      prepareRecoverFunds: async () => prepared(),
      recoverFunds,
    });
    await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(recoverFunds).toHaveBeenCalledWith(expect.objectContaining({ fundingInputs: funding }), expect.anything());
  });

  it('keeps the sweep fee the exit was first quoted at across a rebuild', async () => {
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => prepared({ sweepFeeSats: 180 }),
      recoverFunds: async () => checked([{ txid: 'fresh', status: ready }], { sweepFeeSats: 180 }),
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })], { quotedSweepFeeSat: 215 }), chain(), driver, '02abc');
    expect(next.quotedSweepFeeSat).toBe(215);
    expect(next.exit.sweepFeeSats).toBe(180);
  });

  it('waits for the user rather than prompting for a passkey in the background', async () => {
    // A wallet that keeps no phrase on the device: the rebuild needs a
    // ceremony, which only a button press can ask for.
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const { plan: next } = await advanceUnilateralExit(
      plan([tx({ txid: 'a' })]),
      chain(),
      checking(checked([{ txid: 'a' }]), redo),
      '02abc',
    );
    expect(next.phase).toBe('redo');
    localStorage.removeItem('passkeyLabel');
  });

  it('leaves the exit for the user to rebuild when it cannot do it unattended', async () => {
    const driver = sdk({
      checkRecoverFunds: async () => ({ recovery: checked([{ txid: 'a' }]), verdict: redo }),
      prepareRecoverFunds: async () => {
        throw new Error('no recovery phrase on this device');
      },
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), driver, '02abc');
    expect(next.phase).toBe('redo');
  });

  it('keeps going on the set it holds when the check fails', async () => {
    const failing = sdk({
      checkRecoverFunds: async () => {
        throw new Error('sdk unavailable');
      },
    });
    const { plan: next } = await advanceUnilateralExit(plan([tx({ txid: 'a' })]), chain(), failing);
    expect(next.exit.transactions).toHaveLength(1);
  });

  it('sends nothing once the exit is complete', async () => {
    const broadcast = vi.fn(async () => undefined);
    await advanceUnilateralExit(
      plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], { phase: 'complete' }),
      chain({ broadcast }),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('checkExit', () => {
  it('hands the sdk the exit it stored, untouched', async () => {
    const stored = plan([tx({ txid: 'a', cpfpTxHex: 'bb', dependsOn: ['x'] })], { refusals: { a: 'refused' } });
    const checkRecoverFunds = vi.fn(async (_request: CheckRecoverFundsRequest) => ({
      recovery: checked([{ txid: 'a' }]),
      verdict: { type: 'valid' as const },
    }));
    await checkExit(stored, sdk({ checkRecoverFunds }));
    expect(checkRecoverFunds.mock.calls[0][0].recovery).toBe(stored.exit);
  });

  it.each([
    [{ type: 'valid' } as const, 'active'],
    [{ type: 'done' } as const, 'complete'],
    [redo, 'redo'],
  ])('turns the %o verdict into the %s phase', async (verdict, phase) => {
    expect((await checkExit(plan([tx({ txid: 'a' })]), checking(checked([{ txid: 'a' }]), verdict))).phase).toBe(phase);
  });
});

describe('isReady', () => {
  it('takes the sdk word that a step can go out now', () => {
    expect(isReady(tx({ txid: 'a', status: ready }))).toBe(true);
  });

  it('holds a step back while the sdk is waiting on something', () => {
    expect(isReady(tx({ txid: 'a', status: blocked }))).toBe(false);
    expect(isReady(tx({ txid: 'b', status: locked(244) }))).toBe(false);
    expect(isReady(tx({ txid: 'c', status: { type: 'unverified' } }))).toBe(false);
    expect(isReady(tx({ txid: 'd', status: confirmed(90) }))).toBe(false);
  });
});

describe('planProgress', () => {
  it('counts confirmed transactions against the total', () => {
    const p = plan([tx({ txid: 'a', status: confirmed(1) }), tx({ txid: 'b' }), tx({ txid: 'c' })]);
    expect(planProgress(p)).toEqual({ confirmed: 1, total: 3, isComplete: false });
  });

  it('is complete on the sdk done verdict', () => {
    const p = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(2) })], { phase: 'complete' });
    expect(planProgress(p).isComplete).toBe(true);
  });

  it('is not complete just because every step confirmed, without a verdict to say so', () => {
    expect(planProgress(plan([tx({ txid: 'n', status: confirmed(1) })])).isComplete).toBe(false);
  });

  it('is not complete when the exit has to be rebuilt', () => {
    expect(planProgress(plan([tx({ txid: 'a' })], { phase: 'redo' })).isComplete).toBe(false);
  });
});

describe('nextAction', () => {
  it('treats a ready step as already on its way, not as something to wait for', () => {
    expect(nextAction([tx({ txid: 'c', status: ready })], 20)).toBeNull();
  });

  it('waits on the soonest timelock, and says how many it releases', () => {
    const all = [
      tx({ txid: 's', status: locked(2100) }),
      tx({ txid: 'f', status: locked(244) }),
      tx({ txid: 'g', status: locked(244) }),
    ];
    expect(nextAction(all, 100)).toEqual({ blocks: 144, transactions: 2 });
  });

  it('reports no wait once the tip has passed the spendable height', () => {
    expect(nextAction([tx({ txid: 'c', status: locked(100) })], 244)).toEqual({ blocks: 0, transactions: 1 });
  });

  it('is null when nothing is left to do', () => {
    expect(nextAction([tx({ txid: 'a', status: confirmed(1) })], 100)).toBeNull();
  });

  it('ignores transactions blocked behind an unconfirmed parent', () => {
    expect(nextAction([tx({ txid: 'p' }), tx({ txid: 'c', status: blocked })], 100)).toBeNull();
  });

  it('ignores a timelock whose starting height could not be read', () => {
    expect(nextAction([tx({ txid: 'c', status: locked() })], 100)).toBeNull();
  });
});

describe('blocksToFinish for a matured step', () => {
  it("does not count a ready step's timelock again", () => {
    // Ready means the sdk has already seen the timelock pass: one block to confirm is left.
    expect(blocksToFinish([tx({ txid: 'r', kind: 'refund', csvTimelockBlocks: 2000 })], 100)).toBe(1);
  });
});

describe('savePlan when the snapshot outgrows storage', () => {
  it('rejects the write without dropping the original snapshot', () => {
    const owner = { identityPubkey: 'snapshot-owner', network: 'regtest' };
    const original = plan([tx({ txid: 'original' })], { exitStateSnapshot: 'original-snapshot' });
    savePlan(owner, original);
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => savePlan(owner, plan([tx({ txid: 'new' })], { exitStateSnapshot: 'huge-snapshot' }))).toThrow();
    expect(loadPlan(owner)).toEqual(original);
  });
});

describe('destinationAddressOf', () => {
  const address = { type: 'bitcoinAddress', address: 'bcrt1qdest', network: 'regtest', source: {} } as const;

  it('takes a plain address as it is', () => {
    expect(destinationAddressOf(address as never)).toBe('bcrt1qdest');
  });

  it('takes the address out of a scanned bitcoin: URI', () => {
    const uri = { type: 'bip21', uri: 'bitcoin:bcrt1qdest?amount=1', extras: [], paymentMethods: [address] };
    expect(destinationAddressOf(uri as never)).toBe('bcrt1qdest');
  });

  it('refuses anything that names no on-chain address', () => {
    expect(destinationAddressOf({ type: 'bip21', uri: 'bitcoin:?lightning=lnbc1', extras: [], paymentMethods: [] } as never)).toBeUndefined();
    expect(destinationAddressOf(null)).toBeUndefined();
  });
});

describe('requiredFundingOf', () => {
  it("reads the amount out of the sdk's shortfall error", () => {
    expect(requiredFundingOf('Insufficient CPFP funding: need at least 5898 sats')).toBe(5898);
  });

  it('is null for any other failure', () => {
    expect(requiredFundingOf('signing failed')).toBeNull();
  });
});

describe('sentFunding', () => {
  const own = [{ type: 'p2wpkh' as const, txid: 'fund', vout: 0, valueSats: 5_361, pubkey: '02' }];
  const coin = (txid: string, value: number) => ({ txid, vout: 0, value });

  it("counts the exit's own funding while its first transaction is unconfirmed", () => {
    // The sdk replaces that transaction and spends the same coin again.
    const unconfirmed = plan([tx({ txid: 'fan', kind: 'fanOut' })], { exit: { fundingInputs: own } });
    expect(sentFunding(unconfirmed, [coin('top-up', 1_000)])).toEqual({ sat: 6_361, inputs: 2 });
  });

  it('leaves it out once a transaction confirms, since that spent it for good', () => {
    const settled = plan([tx({ txid: 'fan', kind: 'fanOut', status: confirmed(10) })], { exit: { fundingInputs: own } });
    expect(sentFunding(settled, [coin('top-up', 1_000)])).toEqual({ sat: 1_000, inputs: 1 });
  });

  it('counts a coin the address still lists only once', () => {
    const unsent = plan([tx({ txid: 'fan', kind: 'fanOut' })], { exit: { fundingInputs: own } });
    expect(sentFunding(unsent, [coin('fund', 5_361)])).toEqual({ sat: 5_361, inputs: 1 });
  });
});

describe('topUpFor', () => {
  it('asks for the gap plus the fee of the coin that fills it', () => {
    // One more input is 68 vB, so 2 720 sats at 40 sat/vB.
    expect(topUpFor({ sat: 93_122, inputs: 2 }, { sat: 6_361, inputs: 2 }, 40)).toEqual({
      neededSat: 95_842,
      sentSat: 6_361,
      stillToSendSat: 89_481,
    });
  });

  it('is covered once that coin arrives', () => {
    expect(topUpFor({ sat: 93_122, inputs: 2 }, { sat: 95_842, inputs: 3 }, 40).stillToSendSat).toBe(0);
  });

  it('asks again, for the next coin too, when the one sent fell short', () => {
    expect(topUpFor({ sat: 93_122, inputs: 2 }, { sat: 93_122, inputs: 3 }, 40)).toEqual({
      neededSat: 98_562,
      sentSat: 93_122,
      stillToSendSat: 5_440,
    });
  });

  it("asks a quote for its own figure, whose single coin is already priced in, and prices a second one", () => {
    expect(topUpFor({ sat: 5_898, inputs: 1 }, { sat: 0, inputs: 0 }, 2).stillToSendSat).toBe(5_898);
    expect(topUpFor({ sat: 5_898, inputs: 1 }, { sat: 3_000, inputs: 1 }, 2).stillToSendSat).toBe(3_034);
  });
});

describe('startExit', () => {
  beforeEach(() => {
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  it('quotes what the wallet holds now and builds it from the confirmed fee coins', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared({ sweepFeeSats: 180 }));
    const recoverFunds = vi.fn(async () => checked([{ txid: 'fan', kind: 'fanOut' }]));
    const outcome = await startExit(
      pendingExit({ fundingAddressIndex: 3 }),
      [feeCoin(5_898)],
      sdk({ prepareRecoverFunds, recoverFunds }),
      '02abc',
    );

    // Not the leaves the first quote picked: a payment since could have spent one.
    expect(prepareRecoverFunds).toHaveBeenCalledWith(expect.objectContaining({ selection: { type: 'all' }, feeRateSatPerVbyte: 2 }));
    expect(recoverFunds).toHaveBeenCalledWith(
      expect.objectContaining({ fundingInputs: [expect.objectContaining({ txid: 'coin-5898', valueSats: 5_898 })] }),
      expect.anything(),
    );
    expect(outcome.type).toBe('started');
    if (outcome.type !== 'started') return;
    expect(outcome.plan).toMatchObject({ fundingAddressIndex: 3, quotedSweepFeeSat: 180, exitStateSnapshot: 'snapshot' });
    expect(outcome.plan.exit.transactions[0].txid).toBe('fan');
  });

  it('reports what the build says it still needs, sized on the coins it had', async () => {
    const driver = sdk({
      prepareRecoverFunds: async () => prepared(),
      recoverFunds: async () => {
        throw new Error('Insufficient CPFP funding: need at least 6400 sats');
      },
    });
    expect(await startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc')).toEqual({
      type: 'short',
      required: { sat: 6_400, inputs: 1 },
    });
  });

  it('builds nothing once the wallet holds nothing worth its fee', async () => {
    const recoverFunds = vi.fn(async () => checked([]));
    const driver = sdk({ prepareRecoverFunds: async () => prepared({ leaves: [] }), recoverFunds });
    expect(await startExit(pendingExit(), [feeCoin(5_898)], driver, '02abc')).toEqual({ type: 'nothingToExit' });
    expect(recoverFunds).not.toHaveBeenCalled();
  });

});
