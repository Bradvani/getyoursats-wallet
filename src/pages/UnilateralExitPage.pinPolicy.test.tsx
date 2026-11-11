import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnilateralExitFlow } from '@/features/unilateral-exit/hooks/useUnilateralExitFlow';
import UnilateralExitPage from './UnilateralExitPage';
import {
  confirmNativePinPolicy, getNativePinPolicyRevision, invalidateNativePinPolicy,
  invalidateNativeReadBinding, lockNativeReadAccess,
} from '@/services/nativeReadLease';

const fixtures = vi.hoisted(() => ({
  pin: vi.fn(), unlock: vi.fn(), callbacks: [] as Array<() => void>,
  flow: null as unknown as UnilateralExitFlow,
}));
vi.mock('@/features/unilateral-exit/hooks/useUnilateralExitFlow', () => ({
  useUnilateralExitFlow: () => fixtures.flow, canContinueFromQuote: () => false,
}));
vi.mock('@/services/appLock', () => ({
  isAppLockSupported: () => true, isPinEnabled: fixtures.pin,
  PIN_RECORD_UNAVAILABLE_MESSAGE: 'PIN settings could not be verified. Your wallet is preserved.',
}));
vi.mock('@/components/PinEntry', () => ({
  PinGate: ({ onUnlocked }: { onUnlocked: () => void }) => {
    fixtures.callbacks.push(onUnlocked);
    return <button onClick={onUnlocked}>Unlock exit</button>;
  },
}));
vi.mock('@/components/QrScannerDialog', () => ({ default: () => null }));
vi.mock('@/hooks/useBackButton', () => ({ useBackButton: vi.fn() }));
vi.mock('@/features/unilateral-exit/steps/IntroStep', () => ({ IntroStep: () => <div>Exit introduction</div> }));
vi.mock('@/features/unilateral-exit/steps/QuoteStep', () => ({ QuoteStep: () => <div>Exit quote</div> }));
vi.mock('@/components/ui', async () => ({
  ...(await vi.importActual('@/components/ui')),
  BottomSheetContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  BottomSheetCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogHeader: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Close exit</button>,
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
const page = (network = 'regtest') => <UnilateralExitPage network={network} onBack={vi.fn()} onFinished={vi.fn()} />;

beforeEach(() => {
  visibility('visible');
  invalidateNativePinPolicy();
  confirmNativePinPolicy(false, getNativePinPolicyRevision());
  fixtures.pin.mockReset().mockResolvedValue(false);
  fixtures.unlock.mockReset().mockResolvedValue(undefined);
  fixtures.callbacks.length = 0;
  fixtures.flow = {
    phase: 'unlock', unlock: fixtures.unlock, unlockError: null,
    engine: { plan: null, pending: null, archive: [] },
    canGoBack: true, back: vi.fn(), goTo: vi.fn(),
  } as unknown as UnilateralExitFlow;
});
afterEach(() => { cleanup(); visibility('visible'); });

describe('unilateral exit PIN-policy gate', () => {
  it('does not unlock on unreadable policy and requires a fresh retry', async () => {
    fixtures.pin.mockRejectedValueOnce(new Error('Retained PIN cannot be decoded')).mockResolvedValue(true);
    render(page());
    await screen.findByText('Wallet access is locked');
    expect(screen.getByText(/Your wallet is preserved/)).toBeVisible();
    expect(fixtures.unlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry wallet access' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock exit' }));
    await waitFor(() => expect(fixtures.unlock).toHaveBeenCalledOnce());
    expect(fixtures.pin).toHaveBeenCalledTimes(2);
  });

  it('does not check PIN policy while native read access is locked', async () => {
    lockNativeReadAccess();
    render(page());
    await screen.findByText('Wallet access is locked');
    expect(fixtures.pin).not.toHaveBeenCalled();
    expect(fixtures.unlock).not.toHaveBeenCalled();
  });

  it('unlocks once after a current confirmed no-PIN response', async () => {
    const view = render(page());
    await waitFor(() => expect(fixtures.unlock).toHaveBeenCalledOnce());
    view.rerender(page());
    expect(fixtures.unlock).toHaveBeenCalledOnce();
    expect(fixtures.unlock).toHaveBeenCalledWith(expect.any(Function));
  });

  it('revokes the assertion passed into an already-started funding read when the phase changes', async () => {
    const pending = deferred<void>();
    const publish = vi.fn();
    fixtures.unlock.mockImplementationOnce(async (assertCurrent: () => void) => {
      await pending.promise;
      assertCurrent();
      publish();
    });
    const view = render(page());
    await waitFor(() => expect(fixtures.unlock).toHaveBeenCalledOnce());
    fixtures.flow = { ...fixtures.flow, phase: 'intro' };
    view.rerender(page());
    await act(async () => { pending.resolve(); });
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByText('Exit introduction')).toBeVisible();
  });

  it.each(['policy', 'binding', 'background'] as const)('rejects an old no-PIN response after %s changes', async change => {
    const pending = deferred<boolean>();
    fixtures.pin.mockReturnValueOnce(pending.promise);
    render(page());
    await waitFor(() => expect(fixtures.pin).toHaveBeenCalledOnce());
    act(() => {
      if (change === 'policy') invalidateNativePinPolicy();
      if (change === 'binding') invalidateNativeReadBinding();
      if (change === 'background') { visibility('hidden'); visibility('visible'); }
    });
    await act(async () => { pending.resolve(false); });
    await screen.findByText('Wallet access is locked');
    expect(fixtures.unlock).not.toHaveBeenCalled();
  });

  it.each(['phase', 'network', 'unmount'] as const)('ignores a pending policy read when the %s changes', async change => {
    const pending = deferred<boolean>();
    fixtures.pin.mockReturnValueOnce(pending.promise).mockResolvedValue(true);
    const view = render(page());
    await waitFor(() => expect(fixtures.pin).toHaveBeenCalledOnce());
    if (change === 'phase') {
      fixtures.flow = { ...fixtures.flow, phase: 'intro' };
      view.rerender(page());
    }
    if (change === 'network') view.rerender(page('mainnet'));
    if (change === 'unmount') view.unmount();
    await act(async () => { pending.resolve(false); });
    expect(fixtures.unlock).not.toHaveBeenCalled();
    if (change === 'network') expect(await screen.findByRole('button', { name: 'Unlock exit' })).toBeVisible();
  });

  it('does not accept an old successful PIN callback after a binding change', async () => {
    fixtures.pin.mockResolvedValue(true);
    render(page());
    await screen.findByRole('button', { name: 'Unlock exit' });
    const stale = fixtures.callbacks[fixtures.callbacks.length - 1];
    act(() => { invalidateNativeReadBinding(); stale(); });
    await screen.findByText('Wallet access is locked');
    expect(fixtures.unlock).not.toHaveBeenCalled();
  });

  it('does not accept a successful PIN callback after the page unmounts', async () => {
    fixtures.pin.mockResolvedValue(true);
    const view = render(page());
    await screen.findByRole('button', { name: 'Unlock exit' });
    const stale = fixtures.callbacks[fixtures.callbacks.length - 1];
    view.unmount();
    await act(async () => { stale(); });
    expect(fixtures.unlock).not.toHaveBeenCalled();
  });

  it('handles a rejected unlock without an unhandled rejection or automatic retry', async () => {
    fixtures.unlock.mockRejectedValueOnce(new Error('Native seed read unavailable'));
    render(page());
    await screen.findByText('Wallet access is locked');
    expect(fixtures.unlock).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Retry wallet access' })).toBeVisible();
  });
});
