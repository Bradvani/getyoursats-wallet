import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinGate } from './PinEntry';
import {
  confirmNativePinPolicy, getNativePinPolicyRevision, invalidateNativePinPolicy, invalidateNativeReadBinding,
} from '@/services/nativeReadLease';

const fixtures = vi.hoisted(() => ({
  pin: vi.fn(), gate: vi.fn(), mirror: vi.fn(), verify: vi.fn(), authenticate: vi.fn(), info: vi.fn(),
}));
vi.mock('@/services/appLock', () => ({
  PIN_LENGTH: 6, PIN_RECORD_UNAVAILABLE_MESSAGE: 'PIN settings could not be verified. Your wallet is preserved.',
  isAppLockSupported: () => true, isPinEnabled: fixtures.pin,
  isBiometricGateEnabled: fixtures.gate, isBiometricGateEnabledSync: fixtures.mirror,
  verifyPin: fixtures.verify,
  pinAttemptMessage: (result: { error?: string }) => result.error ?? 'Incorrect PIN',
}));
vi.mock('@/services/secureStorage', () => ({
  authenticateBiometric: fixtures.authenticate, getBiometryInfo: fixtures.info,
}));
vi.mock('@/hooks/useBackButton', () => ({ useBackButton: vi.fn() }));
vi.mock('@/components/StartupLogo', () => ({ default: () => <span>Wallet</span> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function visibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}
function enterPin() {
  for (const digit of '123456') fireEvent.click(screen.getByRole('button', { name: digit }));
}

beforeEach(() => {
  visibility('visible');
  invalidateNativePinPolicy();
  confirmNativePinPolicy(false, getNativePinPolicyRevision());
  fixtures.pin.mockReset().mockResolvedValue(true);
  fixtures.gate.mockReset().mockResolvedValue(false);
  fixtures.mirror.mockReset().mockReturnValue(false);
  fixtures.verify.mockReset().mockResolvedValue({ ok: true, lockedForMs: 0 });
  fixtures.authenticate.mockReset().mockResolvedValue(undefined);
  fixtures.info.mockReset().mockResolvedValue({ kind: 'face', label: 'Face ID' });
});
afterEach(() => { cleanup(); visibility('visible'); });

describe('shared PIN gate policy and ceremony freshness', () => {
  it('falls back visibly to PIN when durable biometric policy is unreadable', async () => {
    fixtures.mirror.mockReturnValue(true);
    fixtures.gate.mockRejectedValue(new Error('Preferences unavailable'));
    const unlocked = vi.fn();
    render(<PinGate reason="Sensitive action" onUnlocked={unlocked} />);
    await screen.findByText('Biometric unlock settings could not be verified. Enter your PIN to continue.');
    expect(fixtures.authenticate).not.toHaveBeenCalled();
    enterPin();
    await waitFor(() => expect(unlocked).toHaveBeenCalledOnce());
  });

  it('does not trust a true biometric mirror when the durable gate is disabled', async () => {
    fixtures.mirror.mockReturnValue(true);
    render(<PinGate reason="Sensitive action" onUnlocked={vi.fn()} />);
    await screen.findByText('Enter your PIN to continue');
    expect(fixtures.authenticate).not.toHaveBeenCalled();
  });

  it('requires a current PIN policy before starting an enabled biometric ceremony', async () => {
    fixtures.gate.mockResolvedValue(true);
    fixtures.pin.mockResolvedValue(false);
    const unlocked = vi.fn();
    render(<PinGate reason="Sensitive action" onUnlocked={unlocked} />);
    await waitFor(() => expect(fixtures.pin).toHaveBeenCalledOnce());
    expect(fixtures.authenticate).not.toHaveBeenCalled();
    expect(unlocked).not.toHaveBeenCalled();
  });

  it('accepts a current biometric ceremony only after both durable policy checks', async () => {
    fixtures.gate.mockResolvedValue(true);
    const unlocked = vi.fn();
    render(<PinGate reason="Sensitive action" onUnlocked={unlocked} />);
    await waitFor(() => expect(unlocked).toHaveBeenCalledOnce());
    expect(fixtures.authenticate).toHaveBeenCalledExactlyOnceWith('Sensitive action');
    expect(fixtures.pin).toHaveBeenCalledTimes(2);
    expect(fixtures.gate).toHaveBeenCalledTimes(3);
  });

  it.each(['background', 'binding', 'policy', 'unmount', 'target'] as const)('rejects successful biometric completion after %s changes', async change => {
    fixtures.gate.mockResolvedValue(true);
    fixtures.mirror.mockReturnValue(true);
    const pending = deferred<void>();
    fixtures.authenticate.mockReturnValueOnce(pending.promise);
    const unlocked = vi.fn();
    const newTarget = vi.fn();
    const view = render(<PinGate reason="Sensitive action" onUnlocked={unlocked} />);
    await waitFor(() => expect(fixtures.authenticate).toHaveBeenCalledOnce());
    act(() => {
      if (change === 'background') { visibility('hidden'); visibility('visible'); }
      if (change === 'binding') invalidateNativeReadBinding();
      if (change === 'policy') invalidateNativePinPolicy();
      if (change === 'unmount') view.unmount();
      if (change === 'target') view.rerender(<PinGate reason="Different action" onUnlocked={newTarget} />);
    });
    await act(async () => { pending.resolve(); });
    expect(unlocked).not.toHaveBeenCalled();
    expect(newTarget).not.toHaveBeenCalled();
    if (change !== 'unmount') await screen.findByText('Enter your PIN to continue');
    if (change === 'target') {
      enterPin();
      await waitFor(() => expect(newTarget).toHaveBeenCalledOnce());
      expect(unlocked).not.toHaveBeenCalled();
    }
  });

  it('rejects biometric success if a fresh durable read finds the gate disabled', async () => {
    fixtures.gate.mockResolvedValue(true);
    const pending = deferred<void>();
    fixtures.authenticate.mockReturnValueOnce(pending.promise);
    const unlocked = vi.fn();
    render(<PinGate reason="Sensitive action" onUnlocked={unlocked} />);
    await waitFor(() => expect(fixtures.authenticate).toHaveBeenCalledOnce());
    fixtures.gate.mockResolvedValue(false);
    await act(async () => { pending.resolve(); });
    expect(unlocked).not.toHaveBeenCalled();
    await screen.findByText(/PIN settings could not be verified/);
  });

  it('checks the durable flag again before a new attempt using an old biometric button', async () => {
    fixtures.gate.mockResolvedValue(true);
    fixtures.authenticate.mockRejectedValueOnce({ code: 'USER_CANCELLED' });
    const unlocked = vi.fn();
    render(<PinGate reason="Sensitive action" onUnlocked={unlocked} />);
    const retry = await screen.findByRole('button', { name: 'Use biometrics' });
    await waitFor(() => expect(fixtures.authenticate).toHaveBeenCalledOnce());
    fixtures.gate.mockResolvedValue(false);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Use biometrics' })).toBeNull());
    expect(fixtures.authenticate).toHaveBeenCalledOnce();
    expect(unlocked).not.toHaveBeenCalled();
  });

  it.each(['background', 'binding', 'policy', 'unmount', 'target'] as const)('rejects a valid PIN response after %s changes', async change => {
    const pending = deferred<{ ok: boolean; lockedForMs: number }>();
    fixtures.verify.mockReturnValueOnce(pending.promise);
    const oldTarget = vi.fn();
    const newTarget = vi.fn();
    const view = render(<PinGate reason="Original action" onUnlocked={oldTarget} />);
    await waitFor(() => expect(fixtures.gate).toHaveBeenCalledOnce());
    enterPin();
    await waitFor(() => expect(fixtures.verify).toHaveBeenCalledOnce());
    act(() => {
      if (change === 'background') { visibility('hidden'); visibility('visible'); }
      if (change === 'binding') invalidateNativeReadBinding();
      if (change === 'policy') invalidateNativePinPolicy();
      if (change === 'unmount') view.unmount();
      if (change === 'target') view.rerender(<PinGate reason="Different action" onUnlocked={newTarget} />);
    });
    await act(async () => { pending.resolve({ ok: true, lockedForMs: 0 }); });
    expect(oldTarget).not.toHaveBeenCalled();
    expect(newTarget).not.toHaveBeenCalled();
  });

  it.each(['incorrect', 'unavailable'])('keeps %s PIN verification closed without unhandled errors', async outcome => {
    if (outcome === 'incorrect') fixtures.verify.mockResolvedValueOnce({ ok: false, lockedForMs: 0 });
    else fixtures.verify.mockRejectedValueOnce(new Error('PIN storage unavailable'));
    const unlocked = vi.fn();
    render(<PinGate reason="Sensitive action" onUnlocked={unlocked} />);
    await waitFor(() => expect(fixtures.gate).toHaveBeenCalledOnce());
    enterPin();
    await screen.findByText(outcome === 'incorrect' ? 'Incorrect PIN' : /PIN settings could not be verified/);
    expect(unlocked).not.toHaveBeenCalled();
  });
});
