import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SecurityPage from './SecurityPage';
import {
  confirmNativePinPolicy, getNativePinPolicyRevision, invalidateNativePinPolicy,
  invalidateNativeReadBinding,
} from '@/services/nativeReadLease';

const fixtures = vi.hoisted(() => ({
  pin: vi.fn(), gate: vi.fn(), seconds: vi.fn(), status: vi.fn(),
  setPin: vi.fn(), clearPin: vi.fn(), setGate: vi.fn(), setSeconds: vi.fn(),
  authenticate: vi.fn(), owner: vi.fn(), callbacks: [] as Array<() => void>,
}));
vi.mock('@/services/appLock', () => ({
  isAppLockSupported: () => true,
  PIN_RECORD_UNAVAILABLE_MESSAGE: 'PIN settings could not be verified. Your wallet is preserved.',
  AUTO_LOCK_OPTIONS_SECONDS: [0, 120], formatAutoLockOption: String,
  isPinEnabled: fixtures.pin, isBiometricGateEnabled: fixtures.gate,
  getAutoLockSeconds: fixtures.seconds, setAutoLockSeconds: fixtures.setSeconds,
  setPin: fixtures.setPin, clearPin: fixtures.clearPin, setBiometricGateEnabled: fixtures.setGate,
}));
vi.mock('@/services/secureStorage', () => ({
  getBiometryStatus: fixtures.status, authenticateBiometric: fixtures.authenticate,
  authenticateDeviceOwner: fixtures.owner,
}));
vi.mock('@/services/logger', () => ({ logger: { warn: vi.fn() }, LogCategory: { AUTH: 'auth' } }));
vi.mock('../components/layout/SlideInPage', () => ({
  default: ({ children, onClose }: { children: ReactNode; onClose: () => void }) =>
    <main><button onClick={onClose}>Close settings</button>{children}</main>,
}));
vi.mock('../components/PinEntry', () => ({
  PinGate: ({ onUnlocked }: { onUnlocked: () => void }) => {
    fixtures.callbacks.push(onUnlocked);
    return <button onClick={onUnlocked}>Unlock settings</button>;
  },
  PinEntry: ({ onSubmit }: { onSubmit: (pin: string) => Promise<string | null> }) =>
    <button onClick={() => { void onSubmit('123456'); }}>Submit PIN</button>,
  PinScreenLayout: ({ children, prompt }: { children: ReactNode; prompt: ReactNode }) => <div>{prompt}{children}</div>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function visibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  visibility('visible');
  invalidateNativePinPolicy();
  confirmNativePinPolicy(false, getNativePinPolicyRevision());
  fixtures.callbacks.length = 0;
  fixtures.pin.mockReset().mockResolvedValue(false);
  fixtures.gate.mockReset().mockResolvedValue(false);
  fixtures.seconds.mockReset().mockResolvedValue(120);
  fixtures.status.mockReset().mockResolvedValue({ info: { kind: 'face', label: 'Face ID' }, lockedOut: false });
  fixtures.setPin.mockReset().mockResolvedValue(undefined);
  fixtures.clearPin.mockReset().mockResolvedValue(undefined);
  fixtures.setGate.mockReset().mockResolvedValue(undefined);
  fixtures.setSeconds.mockReset().mockResolvedValue(undefined);
  fixtures.authenticate.mockReset().mockResolvedValue(undefined);
  fixtures.owner.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); visibility('visible'); });

describe('Lock Screen policy failures', () => {
  it.each(['pin', 'gate', 'seconds', 'status'] as const)('keeps actions closed when %s cannot be read', async field => {
    fixtures[field].mockRejectedValue(new Error('Unavailable native setting'));
    render(<SecurityPage onBack={vi.fn()} />);
    await screen.findByText('Lock Screen settings are locked');
    expect(screen.getByText(/Your wallet is preserved/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create PIN' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change PIN' })).toBeNull();
    expect(screen.queryByText('Deactivate PIN')).toBeNull();
    expect(fixtures.setPin).not.toHaveBeenCalled();
    expect(fixtures.clearPin).not.toHaveBeenCalled();
  });

  it('requires a fresh successful policy read before offering Create PIN after retry', async () => {
    fixtures.pin.mockRejectedValueOnce(new Error('Corrupt record'));
    render(<SecurityPage onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Create PIN' });
    expect(fixtures.pin).toHaveBeenCalledTimes(2);
    expect(fixtures.clearPin).not.toHaveBeenCalled();
  });

  it.each(['policy', 'binding', 'background'] as const)('rejects an old no-PIN result after %s changes', async change => {
    const pending = deferred<boolean>();
    fixtures.pin.mockReturnValueOnce(pending.promise);
    render(<SecurityPage onBack={vi.fn()} />);
    await waitFor(() => expect(fixtures.pin).toHaveBeenCalledOnce());
    act(() => {
      if (change === 'policy') invalidateNativePinPolicy();
      if (change === 'binding') invalidateNativeReadBinding();
      if (change === 'background') { visibility('hidden'); visibility('visible'); }
    });
    await act(async () => { pending.resolve(false); });
    await screen.findByText('Lock Screen settings are locked');
    expect(screen.queryByRole('button', { name: 'Create PIN' })).toBeNull();
    expect(fixtures.setPin).not.toHaveBeenCalled();
    expect(fixtures.clearPin).not.toHaveBeenCalled();
  });

  it('ignores a pending policy result after closing and unmounting the page', async () => {
    const pending = deferred<boolean>();
    fixtures.pin.mockReturnValueOnce(pending.promise);
    const { unmount } = render(<SecurityPage onBack={vi.fn()} />);
    await waitFor(() => expect(fixtures.pin).toHaveBeenCalledOnce());
    unmount();
    await act(async () => { pending.resolve(false); });
    expect(fixtures.setPin).not.toHaveBeenCalled();
    expect(fixtures.clearPin).not.toHaveBeenCalled();
  });

  it('rejects a delayed successful PIN-gate callback after a binding change', async () => {
    fixtures.pin.mockResolvedValue(true);
    render(<SecurityPage onBack={vi.fn()} />);
    await screen.findByRole('button', { name: 'Unlock settings' });
    const old = fixtures.callbacks[fixtures.callbacks.length - 1];
    act(() => { invalidateNativeReadBinding(); old(); });
    await screen.findByText('Lock Screen settings are locked');
    expect(screen.queryByText('Deactivate PIN')).toBeNull();
    expect(fixtures.clearPin).not.toHaveBeenCalled();
  });

  it('shows PIN-write failure without opening the options or clearing the record', async () => {
    fixtures.setPin.mockRejectedValueOnce(new Error('Native write failed'));
    render(<SecurityPage onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create PIN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit PIN' }));
    await screen.findByText('Confirm your PIN');
    fireEvent.click(screen.getByRole('button', { name: 'Submit PIN' }));
    await screen.findByText('Lock Screen settings are locked');
    expect(fixtures.setPin).toHaveBeenCalledExactlyOnceWith('123456');
    expect(fixtures.clearPin).not.toHaveBeenCalled();
    expect(screen.queryByText('Deactivate PIN')).toBeNull();
  });

  it('does not enable biometrics when its OS ceremony finishes after backgrounding', async () => {
    fixtures.pin.mockResolvedValue(true);
    const pending = deferred<void>();
    fixtures.authenticate.mockReturnValueOnce(pending.promise);
    render(<SecurityPage onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock settings' }));
    const toggles = screen.getAllByRole('switch');
    fireEvent.click(toggles[toggles.length - 1]);
    await waitFor(() => expect(fixtures.authenticate).toHaveBeenCalledOnce());
    act(() => { visibility('hidden'); visibility('visible'); });
    await act(async () => { pending.resolve(); });
    await screen.findByText('Lock Screen settings are locked');
    expect(fixtures.setGate).not.toHaveBeenCalled();
  });
});
