import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Seed } from '@breeztech/breez-sdk-spark';
import { prepared } from '../testFixtures';
import { useUnilateralExitFlow } from './useUnilateralExitFlow';

const fixtures = vi.hoisted(() => ({
  read: vi.fn(), derive: vi.fn(), pending: vi.fn(), prepare: vi.fn(),
  chain: { feeRates: vi.fn(), addressUtxos: vi.fn() },
  wallet: null as unknown,
  engine: { plan: null, pending: null, archive: [] },
}));
vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => fixtures.wallet,
  useWalletInfo: () => ({ identityPubkey: 'synthetic-wallet', balanceSats: 100_000 }),
}));
vi.mock('@/services/chain', () => ({ createChainClient: () => fixtures.chain }));
vi.mock('../funding', () => ({ readWalletSeed: fixtures.read, deriveFundingKeyFromSeed: fixtures.derive }));
vi.mock('../engine', () => ({ setPendingExit: fixtures.pending, setUnilateralExitPlan: vi.fn() }));
vi.mock('../exitState', () => ({ loadExitState: vi.fn(async () => null), restoreExitState: vi.fn(async () => {}) }));
vi.mock('./useUnilateralExitEngineLifecycle', () => ({ useUnilateralExitEngineState: () => fixtures.engine }));

const seed: Seed = { type: 'mnemonic', mnemonic: 'synthetic test seed; no wallet or funded network' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  fixtures.read.mockReset().mockResolvedValue(seed);
  fixtures.derive.mockReset().mockReturnValue({ address: 'synthetic-funding-address', publicKeyHex: '02', secretKey: new Uint8Array(32) });
  fixtures.pending.mockReset();
  fixtures.prepare.mockReset().mockResolvedValue(prepared());
  fixtures.chain.feeRates.mockReset().mockResolvedValue({ slow: 1, medium: 2, fast: 3 });
  fixtures.chain.addressUtxos.mockReset().mockResolvedValue([]);
  fixtures.wallet = { prepareRecoverFunds: fixtures.prepare };
});
afterEach(cleanup);

async function quotedFlow() {
  const hook = renderHook(() => useUnilateralExitFlow('regtest'));
  act(() => { hook.result.current.destination.onChange('bcrt1qsynthetic'); hook.result.current.goTo('fee'); });
  await waitFor(() => expect(hook.result.current.fee.effectiveFeeRate).toBe(2));
  await act(async () => { await hook.result.current.submitFee(); });
  expect(hook.result.current.quote.quote).not.toBeNull();
  act(() => { hook.result.current.goTo('unlock'); });
  return hook;
}

describe('exit funding read authorization', () => {
  it('retains the current authorized path to pending funding state', async () => {
    const hook = await quotedFlow();
    const assertCurrent = vi.fn();
    await act(async () => { await hook.result.current.unlock(assertCurrent); });
    expect(fixtures.read).toHaveBeenCalledExactlyOnceWith({ interactive: true });
    expect(fixtures.derive).toHaveBeenCalledExactlyOnceWith(seed, 'regtest', 0);
    expect(fixtures.pending).toHaveBeenCalledOnce();
    expect(assertCurrent).toHaveBeenCalled();
  });

  it('does not read a seed when the entry authorization is already stale', async () => {
    const hook = await quotedFlow();
    await expect(hook.result.current.unlock(() => { throw new Error('Page closed'); })).rejects.toThrow('Page closed');
    expect(fixtures.read).not.toHaveBeenCalled();
    expect(fixtures.derive).not.toHaveBeenCalled();
    expect(fixtures.pending).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('does not publish a delayed seed %s after the caller is revoked', async outcome => {
    const pending = deferred<Seed>();
    fixtures.read.mockReturnValueOnce(pending.promise);
    const hook = await quotedFlow();
    let allowed = true;
    let operation!: Promise<void>;
    act(() => { operation = hook.result.current.unlock(() => { if (!allowed) throw new Error('Page closed'); }); });
    await waitFor(() => expect(fixtures.read).toHaveBeenCalledOnce());
    allowed = false;
    act(() => { hook.result.current.back(); });
    await act(async () => {
      if (outcome === 'resolve') pending.resolve(seed);
      else pending.reject(new Error('Late native read error'));
      await operation;
    });
    expect(hook.result.current.phase).toBe('quote');
    expect(hook.result.current.unlockError).toBeNull();
    expect(fixtures.derive).not.toHaveBeenCalled();
    expect(fixtures.pending).not.toHaveBeenCalled();
  });

  it('still reports a current read failure without creating funding state', async () => {
    fixtures.read.mockRejectedValueOnce(new Error('Native wallet unavailable'));
    const hook = await quotedFlow();
    await act(async () => { await hook.result.current.unlock(() => {}); });
    expect(hook.result.current.unlockError).toBe('Native wallet unavailable');
    expect(fixtures.derive).not.toHaveBeenCalled();
    expect(fixtures.pending).not.toHaveBeenCalled();
  });
});
