import type {
  ExitTransactionStatus,
  PrepareRecoverFundsResponse,
  RecoverFundsResponse,
  RecoveryTransaction,
} from '@breeztech/breez-sdk-spark';
import type { ChainUtxo } from '@/services/chain';
import type { ExitSdk, PendingExit, UnilateralExitPlan } from './driver';

/** The phrase the fee key derives from in tests that start or rebuild an exit. */
export const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/** An exit quoted at 2 sat/vB for 5 898 sats of fee, nothing paid yet. */
export const pendingExit = (over: Partial<PendingExit> = {}): PendingExit => ({
  network: 'regtest',
  destination: 'bcrt1qdest',
  feeRateSatPerVbyte: 2,
  fundingAddressIndex: 0,
  fundingAddress: 'bcrt1qfund',
  required: { sat: 5_898, inputs: 1 },
  willReceiveSat: 94_000,
  ...over,
});

export const coin = (value: number, confirmed = true, txid = `coin-${value}`): ChainUtxo => ({
  txid,
  vout: 0,
  value,
  confirmed,
});

export const confirmed = (blockHeight?: number): ExitTransactionStatus => ({
  type: 'confirmed',
  blockHeight,
});
export const ready: ExitTransactionStatus = { type: 'ready' };
export const blocked: ExitTransactionStatus = { type: 'waitingForDependencies' };
export const locked = (spendableAtHeight?: number): ExitTransactionStatus => ({
  type: 'waitingForTimelock',
  spendableAtHeight,
});

/** A transaction with one input and one output of `sat`, for what a confirmed delivery paid. */
export const paying = (sat: number): string => {
  const value = BigInt(sat).toString(16).padStart(16, '0').match(/../g)!.reverse().join('');
  return '0200000001' + '00'.repeat(32) + '00000000' + '00' + 'ffffffff' +
    '01' + value + '160014' + 'ab'.repeat(20) + '00000000';
};

export const tx = (
  over: Partial<RecoveryTransaction> & { txid: string },
): RecoveryTransaction => ({
  kind: 'node',
  txHex: 'aa',
  dependsOn: [],
  status: ready,
  ...over,
});

/** What the sdk hands back for an exit: the same set, statuses refreshed. */
export const checked = (
  transactions: Array<Partial<RecoveryTransaction> & { txid: string }>,
  over: Partial<RecoverFundsResponse> = {},
): RecoverFundsResponse => ({
  recoverableValueSats: 100_000,
  totalFeeSats: 2_000,
  cooperativeFeeSats: 0,
  cpfpFeeSats: 1_800,
  fanoutFeeSats: 0,
  refundFeeSats: 0,
  sweepFeeSats: 200,
  leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }],
  failed: [],
  fundingInputs: [],
  transactions: transactions.map(tx),
  feeRateSatPerVbyte: 2,
  destination: 'bc1qdest',
  ...over,
});

export const plan = (
  transactions: RecoveryTransaction[],
  over: Partial<Omit<UnilateralExitPlan, 'exit'>> & { exit?: Partial<RecoverFundsResponse> } = {},
): UnilateralExitPlan => {
  const { exit, ...rest } = over;
  return {
    version: 5,
    network: 'mainnet',
    destination: 'bc1qdest',
    feeRateSatPerVbyte: 2,
    fundingAddressIndex: 0,
    quotedSweepFeeSat: 200,
    exit: { ...checked([]), transactions, ...exit },
    refusals: {},
    phase: 'active',
    ...rest,
  };
};

export const prepared = (
  over: Partial<PrepareRecoverFundsResponse> = {},
): PrepareRecoverFundsResponse => ({
  leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }],
  skipped: [],
  recoverableValueSats: 100_000,
  totalFeeSats: 2_000,
  cooperativeFeeSats: 0,
  cpfpFeeSats: 1_800,
  fanoutFeeSats: 0,
  refundFeeSats: 0,
  sweepFeeSats: 200,
  funding: { singleUtxoSats: 3_000, perBranch: [] },
  feeRateSatPerVbyte: 2,
  destination: 'bc1qdest',
  exitChainState: {
    confirmedNodes: [],
    refunds: [],
    stoppedLeafIds: [],
    unverifiedNodeIds: [],
    unverifiableConfirmedNodeIds: [],
  },
  ...over,
});

/** An sdk whose check confirms whatever it is handed, with nothing to rebuild. */
export const sdk = (over: Partial<ExitSdk> = {}): ExitSdk => ({
  checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'valid' } }),
  importUnilateralExitState: async () => ({
    importedLeaves: 0,
    skippedForeignLeaves: 0,
    skippedConflictingLeaves: 0,
    skippedChains: 0,
  }),
  prepareRecoverFunds: async () => prepared({ leaves: [] }),
  recoverFunds: async () => checked([]),
  exportUnilateralExitState: async () => ({ exitState: 'snapshot' }),
  ...over,
});
