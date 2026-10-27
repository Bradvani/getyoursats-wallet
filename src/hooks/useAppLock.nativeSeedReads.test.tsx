import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Seed } from '@breeztech/breez-sdk-spark';
import { useAppLock } from './useAppLock';
import { setAutoLockSeconds, setBiometricGateEnabled, setPin } from '@/services/appLock';
import { readWalletSeed } from '@/features/unilateral-exit/funding';
import {
  readSelectedNativeSeed, resetNativeSeedSelection, setActiveNativeSeedWallet, setNativeSeedTier,
} from '@/services/nativeSeedSelection';
import {
  captureNativeReadLease, invalidateNativePinPolicy, lockNativeReadAccess,
} from '@/services/nativeReadLease';
import { clearSignerIdentity, isSpendingSessionLocked } from '@/security/spendApproval';

const fixtures = vi.hoisted(() => ({
  preferences: new Map<string, string>(),
  devicePresence: vi.fn(), boundPresence: vi.fn(), deviceRead: vi.fn(), boundRead: vi.fn(),
  biometric: vi.fn(), passkey: vi.fn(), passkeyMode: vi.fn(), factory: vi.fn(), identity: vi.fn(),
  getInfo: vi.fn(), breezFree: vi.fn(), sparkFree: vi.fn(), containerFree: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: async ({ key }: { key: string }) => ({ value: fixtures.preferences.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => { fixtures.preferences.set(key, value); },
  remove: async ({ key }: { key: string }) => { fixtures.preferences.delete(key); },
} }));
vi.mock('@/services/secureStorage', () => ({
  deviceOnlyStorage: { isSupported: () => true, hasStoredSeed: fixtures.devicePresence, retrieveSeed: fixtures.deviceRead },
  secureStorage: { isSupported: () => true, hasStoredSeed: fixtures.boundPresence, retrieveSeed: fixtures.boundRead },
  tryAuthenticateBiometric: fixtures.biometric,
}));
vi.mock('@/services/passkeyService', () => ({
  isPasskeyMode: fixtures.passkeyMode, getPasskeyLabel: () => 'fixture-label',
  signInPinnedToActiveCredential: fixtures.passkey,
}));
vi.mock('@/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() }, LogCategory: { AUTH: 'auth' } }));
vi.mock('@breeztech/breez-sdk-spark', () => ({ defaultExternalSignersFromSeed: fixtures.factory }));
vi.mock('@/services/sdkReady', () => ({ sdkReady: vi.fn(async () => {}) }));

const SEED: Seed = { type: 'mnemonic', mnemonic: Array(11).fill('abandon').concat('about').join(' '), passphrase: 'retained identity' };
const KEY = [2, ...Array(32).fill(17)];
const IDENTITY = KEY.map(byte => byte.toString(16).padStart(2, '0')).join('');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}
async function pinWallet(timeout = 0) {
  setNativeSeedTier('device');
  setActiveNativeSeedWallet({ getInfo: fixtures.getInfo }, 'regtest');
  await setAutoLockSeconds(timeout);
  await setPin('123456');
  await setBiometricGateEnabled(true);
  const hook = renderHook(() => useAppLock());
  await waitFor(() => expect(hook.result.current.biometricGate).toBe(true));
  expect(hook.result.current.locked).toBe(true);
  return hook;
}

beforeEach(() => {
  visibility('visible');
  resetNativeSeedSelection();
  invalidateNativePinPolicy();
  clearSignerIdentity();
  fixtures.preferences.clear();
  fixtures.devicePresence.mockReset().mockResolvedValue(true);
  fixtures.boundPresence.mockReset().mockResolvedValue(false);
  fixtures.deviceRead.mockReset().mockResolvedValue(SEED);
  fixtures.boundRead.mockReset().mockRejectedValue(new Error('Unexpected other-tier read'));
  fixtures.biometric.mockReset().mockResolvedValue(true);
  fixtures.passkeyMode.mockReset().mockReturnValue(false);
  fixtures.passkey.mockReset().mockRejectedValue(new Error('Unexpected passkey read'));
  fixtures.getInfo.mockReset().mockResolvedValue({ identityPubkey: IDENTITY });
  fixtures.identity.mockReset().mockResolvedValue({ bytes: KEY.slice() });
  fixtures.factory.mockReset().mockReturnValue({
    breezSigner: { free: fixtures.breezFree },
    sparkSigner: { getIdentityPublicKey: fixtures.identity, free: fixtures.sparkFree },
    free: fixtures.containerFree,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  visibility('visible');
  resetNativeSeedSelection();
  invalidateNativePinPolicy();
  clearSignerIdentity();
});

describe('real native app-lock transitions guard backup and funding reads', () => {
  it('allows the same wallet proof after background and real PIN unlock while browser state stays locked', async () => {
    const { result } = await pinWallet();
    await act(async () => { expect(await result.current.unlockWithPin('123456')).toMatchObject({ ok: true }); });
    await expect(readWalletSeed({ interactive: true })).resolves.toEqual(SEED);
    act(() => { visibility('hidden'); visibility('visible'); });
    expect(result.current.locked).toBe(true);
    expect(isSpendingSessionLocked()).toBe(true);
    await expect(readWalletSeed({ interactive: true })).rejects.toThrow(/locked/);
    await act(async () => { expect(await result.current.unlockWithPin('123456')).toMatchObject({ ok: true }); });
    await expect(readWalletSeed({ interactive: true })).resolves.toEqual(SEED);
    expect(fixtures.getInfo).toHaveBeenLastCalledWith({ ensureSynced: false });
    expect(fixtures.factory).toHaveBeenLastCalledWith(SEED, 'regtest', undefined);
    expect(fixtures.boundRead).not.toHaveBeenCalled();
    expect(isSpendingSessionLocked()).toBe(true);
  });

  it('foreground idle lock revokes a native vault read before any public-identity proof', async () => {
    const { result } = await pinWallet(30);
    vi.useFakeTimers();
    await act(async () => { expect(await result.current.unlockWithPin('123456')).toMatchObject({ ok: true }); });
    const entered = deferred<void>();
    const pending = deferred<Seed>();
    fixtures.deviceRead.mockImplementationOnce(() => { entered.resolve(); return pending.promise; });
    const read = readWalletSeed({ interactive: true }).then(
      value => ({ value }), error => ({ error }),
    );
    await entered.promise;
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current.locked).toBe(true);
    pending.resolve(SEED);
    expect(await read).toMatchObject({ error: expect.objectContaining({ message: expect.stringMatching(/changed|locked/) }) });
    expect(fixtures.factory).not.toHaveBeenCalled();
    expect(() => captureNativeReadLease()).toThrow(/locked/);
  });

  it('does not release a proof started before background after a later successful PIN unlock', async () => {
    const { result } = await pinWallet();
    await act(async () => { await result.current.unlockWithPin('123456'); });
    const pending = deferred<{ bytes: number[] }>();
    fixtures.identity.mockReturnValueOnce(pending.promise);
    const read = readSelectedNativeSeed().then(value => ({ value }), error => ({ error }));
    await waitFor(() => expect(fixtures.identity).toHaveBeenCalledOnce());
    act(() => { visibility('hidden'); visibility('visible'); });
    await act(async () => { expect(await result.current.unlockWithPin('123456')).toMatchObject({ ok: true }); });
    pending.resolve({ bytes: KEY.slice() });
    expect(await read).toMatchObject({ error: expect.objectContaining({ message: expect.stringMatching(/changed|locked/) }) });
    expect(fixtures.breezFree).toHaveBeenCalledOnce();
    expect(fixtures.sparkFree).toHaveBeenCalledOnce();
    expect(fixtures.containerFree).toHaveBeenCalledOnce();
    await expect(readSelectedNativeSeed()).resolves.toEqual(SEED);
  });

  it('a real PIN completion cannot reopen access after the SDK binding changes', async () => {
    const { result } = await pinWallet();
    const entered = deferred<void>();
    const release = deferred<void>();
    const derive = crypto.subtle.deriveBits.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'deriveBits').mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return derive(...args);
    });
    let unlocking!: ReturnType<typeof result.current.unlockWithPin>;
    act(() => { unlocking = result.current.unlockWithPin('123456'); });
    await entered.promise;
    act(() => { setActiveNativeSeedWallet({ getInfo: fixtures.getInfo }, 'regtest'); });
    let outcome;
    await act(async () => { release.resolve(); outcome = await unlocking; });
    expect(outcome).toMatchObject({ ok: false });
    expect(result.current.locked).toBe(true);
    await expect(readSelectedNativeSeed()).rejects.toThrow(/locked/);
    expect(fixtures.deviceRead).not.toHaveBeenCalled();
  });

  it('keeps entry authorization across a delayed first selection and real PIN reauthentication', async () => {
    const { result } = await pinWallet();
    await act(async () => { await result.current.unlockWithPin('123456'); });
    act(() => {
      resetNativeSeedSelection();
      setActiveNativeSeedWallet({ getInfo: fixtures.getInfo }, 'regtest');
    });
    const pending = deferred<boolean>();
    fixtures.devicePresence.mockReturnValueOnce(pending.promise);
    const read = readWalletSeed({ interactive: true }).then(value => ({ value }), error => ({ error }));
    act(() => { lockNativeReadAccess(); });
    await act(async () => { expect(await result.current.unlockWithPin('123456')).toMatchObject({ ok: true }); });
    await act(async () => { pending.resolve(true); });
    expect(await read).toMatchObject({ error: expect.objectContaining({ message: expect.stringMatching(/changed|locked/) }) });
    expect(fixtures.deviceRead).not.toHaveBeenCalled();
    expect(fixtures.factory).not.toHaveBeenCalled();
  });

  it('cancels a legacy native passkey funding read after a later PIN authorization', async () => {
    const { result } = await pinWallet();
    await act(async () => { await result.current.unlockWithPin('123456'); });
    act(() => {
      resetNativeSeedSelection();
      setActiveNativeSeedWallet({ getInfo: fixtures.getInfo }, 'regtest');
    });
    fixtures.devicePresence.mockResolvedValue(false);
    fixtures.boundPresence.mockResolvedValue(false);
    fixtures.passkeyMode.mockReturnValue(true);
    const pending = deferred<{ wallet: { seed: Seed } }>();
    fixtures.passkey.mockReturnValueOnce(pending.promise);
    const read = readWalletSeed({ interactive: true }).then(value => ({ value }), error => ({ error }));
    await waitFor(() => expect(fixtures.passkey).toHaveBeenCalledOnce());
    act(() => { lockNativeReadAccess(); });
    await act(async () => { expect(await result.current.unlockWithPin('123456')).toMatchObject({ ok: true }); });
    pending.resolve({ wallet: { seed: SEED } });
    expect(await read).toMatchObject({ error: expect.objectContaining({ message: expect.stringMatching(/changed|locked/) }) });
    expect(fixtures.factory).not.toHaveBeenCalled();
  });
});
