import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppLock } from './useAppLock';
import { setAutoLockSeconds, setBiometricGateEnabled, setPin } from '@/services/appLock';
import {
  assertNativeReadLease, captureNativeReadLease, getNativePinPolicyRevision, invalidateNativePinPolicy,
  invalidateNativeReadBinding, lockNativeReadAccess,
} from '@/services/nativeReadLease';
import { isSpendingSessionLocked, lockSpendingSession } from '@/security/spendApproval';

const fixtures = vi.hoisted(() => ({
  preferences: new Map<string, string>(), get: vi.fn(), remove: vi.fn(), biometric: vi.fn(),
  device: vi.fn(), bound: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: fixtures.get,
  set: async ({ key, value }: { key: string; value: string }) => { fixtures.preferences.set(key, value); },
  remove: fixtures.remove,
} }));
vi.mock('@/services/secureStorage', () => ({
  deviceOnlyStorage: { hasStoredSeed: fixtures.device },
  secureStorage: { hasStoredSeed: fixtures.bound },
  tryAuthenticateBiometric: fixtures.biometric,
}));
vi.mock('@/services/passkeyService', () => ({ isPasskeyMode: () => false }));
vi.mock('@/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() }, LogCategory: { AUTH: 'auth' } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function visibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}
async function pinWallet() {
  await setPin('123456');
  await setBiometricGateEnabled(true);
  const hook = renderHook(() => useAppLock());
  await waitFor(() => expect(hook.result.current.biometricGate).toBe(true));
  return hook;
}

beforeEach(() => {
  visibility('visible');
  invalidateNativePinPolicy();
  fixtures.preferences.clear();
  fixtures.get.mockReset().mockImplementation(async ({ key }: { key: string }) => ({ value: fixtures.preferences.get(key) ?? null }));
  fixtures.remove.mockReset().mockImplementation(async ({ key }: { key: string }) => { fixtures.preferences.delete(key); });
  fixtures.device.mockReset().mockResolvedValue(true);
  fixtures.bound.mockReset().mockResolvedValue(false);
  fixtures.biometric.mockReset().mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); visibility('visible'); });

describe('native app-lock and read authorization integration', () => {
  it('starts locked without a mirror and opens only after durable no-PIN policy resolves', async () => {
    const pending = deferred<{ value: null }>();
    fixtures.get.mockImplementation(async ({ key }: { key: string }) =>
      key === 'glow.appLock.pin' ? pending.promise : { value: null });
    const { result } = renderHook(() => useAppLock());
    expect(result.current.locked).toBe(true);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
    await act(async () => { pending.resolve({ value: null }); });
    await waitFor(() => expect(result.current.locked).toBe(false));
    expect(() => captureNativeReadLease()).not.toThrow();
  });

  it('a real valid PIN unlocks native reads even while browser spending state is locked', async () => {
    const { result } = await pinWallet();
    lockSpendingSession('Browser state is intentionally independent');
    expect(isSpendingSessionLocked()).toBe(true);
    let outcome;
    await act(async () => { outcome = await result.current.unlockWithPin('123456'); });
    expect(outcome).toMatchObject({ ok: true });
    expect(result.current.locked).toBe(false);
    expect(() => assertNativeReadLease(captureNativeReadLease())).not.toThrow();
    expect(isSpendingSessionLocked()).toBe(true);
  });

  it('background timeout closes access and authenticated resume grants only a new lease', async () => {
    await setAutoLockSeconds(0);
    const { result } = await pinWallet();
    await act(async () => { await result.current.unlockWithPin('123456'); });
    const before = captureNativeReadLease();
    act(() => { visibility('hidden'); visibility('visible'); });
    expect(result.current.locked).toBe(true);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
    await act(async () => { await result.current.unlockWithPin('123456'); });
    expect(result.current.locked).toBe(false);
    expect(() => assertNativeReadLease(before)).toThrow(/changed/);
    expect(() => assertNativeReadLease(captureNativeReadLease())).not.toThrow();
  });

  it('a brief background preserves the configured timeout but cancels an already-started read', async () => {
    await setAutoLockSeconds(120);
    const { result } = await pinWallet();
    await act(async () => { await result.current.unlockWithPin('123456'); });
    const before = captureNativeReadLease();
    act(() => { visibility('hidden'); visibility('visible'); });
    expect(result.current.locked).toBe(false);
    expect(() => assertNativeReadLease(before)).toThrow(/changed/);
    expect(() => captureNativeReadLease()).not.toThrow();
  });

  it('foreground idle locking revokes the same lease used by backup and funding reads', async () => {
    await setAutoLockSeconds(30);
    const { result } = await pinWallet();
    vi.useFakeTimers();
    await act(async () => { await result.current.unlockWithPin('123456'); });
    const before = captureNativeReadLease();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current.locked).toBe(true);
    expect(() => assertNativeReadLease(before)).toThrow(/locked/);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
  });

  it.each(['background', 'binding', 'lock', 'unmount'] as const)(
    'a correct PIN result cannot unlock after intervening %s', async change => {
      const { result, unmount } = await pinWallet();
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
      act(() => {
        if (change === 'background') { visibility('hidden'); visibility('visible'); }
        if (change === 'binding') invalidateNativeReadBinding();
        if (change === 'lock') lockNativeReadAccess();
        if (change === 'unmount') unmount();
      });
      let outcome;
      await act(async () => { release.resolve(); outcome = await unlocking; });
      expect(outcome).toMatchObject({ ok: false });
      expect(() => captureNativeReadLease()).toThrow(/locked/);
      if (change !== 'unmount') expect(result.current.locked).toBe(true);
    },
  );

  it.each(['background', 'binding', 'lock', 'unmount'] as const)(
    'a successful biometric result cannot unlock after intervening %s', async change => {
      const { result, unmount } = await pinWallet();
      const pending = deferred<boolean>();
      fixtures.biometric.mockReturnValue(pending.promise);
      let unlocking!: Promise<void>;
      act(() => { unlocking = result.current.unlockWithBiometric(); });
      await waitFor(() => expect(fixtures.biometric).toHaveBeenCalledOnce());
      act(() => {
        if (change === 'background') { visibility('hidden'); visibility('visible'); }
        if (change === 'binding') invalidateNativeReadBinding();
        if (change === 'lock') lockNativeReadAccess();
        if (change === 'unmount') unmount();
      });
      await act(async () => { pending.resolve(true); await unlocking; });
      expect(() => captureNativeReadLease()).toThrow(/locked/);
      if (change !== 'unmount') expect(result.current.locked).toBe(true);
    },
  );

  it('a successful current biometric confirmation opens native reads', async () => {
    const { result } = await pinWallet();
    await act(async () => { await result.current.unlockWithBiometric(); });
    expect(result.current.locked).toBe(false);
    expect(() => captureNativeReadLease()).not.toThrow();
  });

  it('a pending biometric success is revoked when biometric unlock is disabled', async () => {
    const { result } = await pinWallet();
    const pending = deferred<boolean>();
    fixtures.biometric.mockReturnValue(pending.promise);
    let unlocking!: Promise<void>;
    act(() => { unlocking = result.current.unlockWithBiometric(); });
    await waitFor(() => expect(fixtures.biometric).toHaveBeenCalledOnce());
    await act(async () => { await setBiometricGateEnabled(false); });
    await act(async () => { pending.resolve(true); await unlocking; });
    expect(result.current.locked).toBe(true);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
  });

  it('a stale cached biometric flag cannot authorize a new ceremony during or after disable/background', async () => {
    await setAutoLockSeconds(0);
    const { result } = await pinWallet();
    const entered = deferred<void>();
    const release = deferred<void>();
    fixtures.remove.mockImplementationOnce(async ({ key }: { key: string }) => {
      expect(key).toBe('glow.appLock.biometricEnabled');
      entered.resolve();
      await release.promise;
      fixtures.preferences.delete(key);
    });
    let disabling!: Promise<void>;
    act(() => { disabling = setBiometricGateEnabled(false); });
    await entered.promise;
    act(() => { visibility('hidden'); visibility('visible'); });
    expect(result.current.biometricGate).toBe(true); // Old mirror, intentionally retained until commit.
    await act(async () => { await result.current.unlockWithBiometric(); });
    expect(fixtures.biometric).not.toHaveBeenCalled();
    expect(result.current.locked).toBe(true);
    await act(async () => { release.resolve(); await disabling; });
    expect(result.current.biometricGate).toBe(true); // The stale callback must re-read durable policy.
    await act(async () => { await result.current.unlockWithBiometric(); });
    expect(fixtures.biometric).not.toHaveBeenCalled();
    expect(result.current.biometricGate).toBe(false);
    expect(result.current.locked).toBe(true);
  });

  it.each(['pin', 'binding', 'background', 'lock', 'unmount'] as const)(
    'stale empty-vault results cannot remove a PIN after %s changes', async change => {
      await setPin('123456');
      const device = deferred<boolean>();
      const bound = deferred<boolean>();
      fixtures.device.mockReturnValue(device.promise);
      fixtures.bound.mockReturnValue(bound.promise);
      const { result, unmount } = renderHook(() => useAppLock());
      await waitFor(() => expect(fixtures.bound).toHaveBeenCalledOnce());
      if (change === 'pin') await act(async () => { await setPin('654321'); });
      act(() => {
        if (change === 'binding') invalidateNativeReadBinding();
        if (change === 'background') { visibility('hidden'); visibility('visible'); }
        if (change === 'lock') lockNativeReadAccess();
        if (change === 'unmount') unmount();
      });
      const record = fixtures.preferences.get('glow.appLock.pin');
      const policyRevision = getNativePinPolicyRevision();
      await act(async () => { device.resolve(false); bound.resolve(false); });
      expect(fixtures.preferences.get('glow.appLock.pin')).toBe(record);
      expect(fixtures.remove.mock.calls.some(([entry]) => entry.key === 'glow.appLock.pin')).toBe(false);
      expect(getNativePinPolicyRevision()).toBe(policyRevision);
      expect(() => captureNativeReadLease()).toThrow(/locked/);
      if (change !== 'unmount') expect(result.current.locked).toBe(true);
    },
  );

  it.each(['malformed', 'unavailable'] as const)('keeps %s durable PIN data locked without clearing it', async state => {
    fixtures.preferences.set('glow.appLock.pin', 'retained invalid record');
    if (state === 'unavailable') fixtures.get.mockRejectedValue(new Error('Preferences unavailable'));
    const { result } = renderHook(() => useAppLock());
    await waitFor(() => expect(fixtures.get).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.locked).toBe(true);
    expect(result.current.biometricGate).toBe(false);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
    expect(fixtures.preferences.get('glow.appLock.pin')).toBe('retained invalid record');
    let outcome;
    await act(async () => { outcome = await result.current.unlockWithPin('123456'); });
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/preserved/) });
  });

  it('a fresh PIN attempt recovers a transient policy read failure without erasing the original record', async () => {
    await setPin('123456');
    const original = fixtures.preferences.get('glow.appLock.pin');
    fixtures.get.mockRejectedValueOnce(new Error('Transient Preferences failure'));
    const { result } = renderHook(() => useAppLock());
    await waitFor(() => expect(fixtures.get).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.locked).toBe(true);
    let outcome;
    await act(async () => { outcome = await result.current.unlockWithPin('123456'); });
    expect(outcome).toMatchObject({ ok: true });
    expect(result.current.locked).toBe(false);
    expect(fixtures.preferences.get('glow.appLock.pin')).toBe(original);
  });
});
