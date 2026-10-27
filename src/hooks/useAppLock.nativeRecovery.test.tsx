import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppLock } from './useAppLock';
import { invalidateNativePinPolicy } from '@/services/nativeReadLease';

const mocks = vi.hoisted(() => ({
  pinRecord: 'retained PIN metadata' as string | null,
  device: vi.fn(), bound: vi.fn(), clearPin: vi.fn(), warn: vi.fn(),
}));
vi.mock('@/services/appLock', () => ({
  PIN_RECORD_UNAVAILABLE_MESSAGE: 'PIN settings could not be verified',
  clearPin: mocks.clearPin, isAppLockSupported: () => true,
  isPinEnabledSync: () => mocks.pinRecord !== null, isPinEnabled: async () => mocks.pinRecord !== null,
  isBiometricGateEnabledSync: () => true, isBiometricGateEnabled: async () => true,
  getAutoLockSecondsSync: () => 30, getAutoLockSeconds: async () => 30,
  isIdleLockSuppressed: () => false, verifyPin: vi.fn(),
}));
vi.mock('@/services/secureStorage', () => ({
  deviceOnlyStorage: {hasStoredSeed: mocks.device}, secureStorage: {hasStoredSeed: mocks.bound},
  tryAuthenticateBiometric: vi.fn(),
}));
vi.mock('@/services/passkeyService', () => ({isPasskeyMode: () => false}));
vi.mock('@/services/logger', () => ({logger: {warn: mocks.warn}, LogCategory: {AUTH: 'auth'}}));

beforeEach(() => {
  invalidateNativePinPolicy();
  localStorage.clear();
  mocks.pinRecord = 'retained PIN metadata';
  mocks.device.mockReset().mockResolvedValue(false);
  mocks.bound.mockReset().mockResolvedValue(false);
  mocks.clearPin.mockReset().mockImplementation(async () => {mocks.pinRecord = null;});
});
afterEach(cleanup);

describe('native app lock preserves uncertain wallet records', () => {
  it.each(['device', 'bound', 'both'] as const)('retains the PIN and lock when %s presence is unknown', async tier => {
    if (tier !== 'bound') mocks.device.mockRejectedValue(new Error('Presence unknown'));
    if (tier !== 'device') mocks.bound.mockRejectedValue(new Error('Presence unknown'));
    const {result} = renderHook(() => useAppLock());
    await waitFor(() => expect(mocks.warn).toHaveBeenCalled());
    expect(result.current.locked).toBe(true);
    expect(result.current.biometricGate).toBe(false);
    expect(mocks.pinRecord).toBe('retained PIN metadata');
    expect(mocks.clearPin).not.toHaveBeenCalled();
  });

  it('keeps a confirmed existing wallet locked', async () => {
    mocks.bound.mockResolvedValue(true);
    const {result} = renderHook(() => useAppLock());
    await waitFor(() => expect(mocks.bound).toHaveBeenCalledOnce());
    expect(result.current.locked).toBe(true);
    expect(mocks.clearPin).not.toHaveBeenCalled();
  });

  it('still removes an orphan PIN after both probes confirm absence', async () => {
    const {result} = renderHook(() => useAppLock());
    await waitFor(() => expect(result.current.locked).toBe(false));
    expect(mocks.clearPin).toHaveBeenCalledOnce();
    expect(mocks.pinRecord).toBeNull();
  });
});
