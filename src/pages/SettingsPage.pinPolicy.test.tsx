import type { ReactNode } from 'react';
import type { Config } from '@breeztech/breez-sdk-spark';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';
import {
  confirmNativePinPolicy, getNativePinPolicyRevision, invalidateNativePinPolicy,
  invalidateNativeReadBinding, lockNativeReadAccess,
} from '@/services/nativeReadLease';

const fixtures = vi.hoisted(() => ({
  pin: vi.fn(), getInfo: vi.fn(), exportDb: vi.fn(),
  callbacks: [] as Array<() => void>, confirms: [] as Array<() => void>,
  wallet: null as unknown,
}));
vi.mock('@/contexts/WalletContext', () => ({ useWallet: () => fixtures.wallet }));
vi.mock('@/services/appLock', () => ({
  isAppLockSupported: () => true, isPinEnabled: fixtures.pin,
  PIN_RECORD_UNAVAILABLE_MESSAGE: 'PIN settings could not be verified. Your wallet is preserved.',
}));
vi.mock('@/services/logExport', () => ({ exportDatabaseState: fixtures.exportDb, shareOrDownloadLogs: vi.fn() }));
vi.mock('@/hooks/useSecretTap', () => ({
  useSecretTap: () => ({ handleTap: vi.fn(), activated: true, tapCount: 0, threshold: 5 }),
}));
vi.mock('@/services/passkeyService', () => ({ isPasskeyMode: () => false }));
vi.mock('../components/layout/SlideInPage', () => ({
  default: ({ children, footer, onClose }: { children: ReactNode; footer: ReactNode; onClose: () => void }) =>
    <main><button onClick={onClose}>Close settings</button>{children}{footer}</main>,
}));
vi.mock('../components/PinEntry', () => ({
  PinGate: ({ onUnlocked }: { onUnlocked: () => void }) => {
    fixtures.callbacks.push(onUnlocked);
    return <button onClick={onUnlocked}>Unlock export</button>;
  },
}));
vi.mock('../components/ui', async () => ({
  ...(await vi.importActual('../components/ui')),
  ConfirmDialog: ({ isOpen, onConfirm, onCancel }: { isOpen: boolean; onConfirm: () => void; onCancel: () => void }) => {
    if (!isOpen) return null;
    fixtures.confirms.push(onConfirm);
    return <section aria-label="Export confirmation"><button onClick={onConfirm}>Export now</button><button onClick={onCancel}>Cancel export</button></section>;
  },
}));
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function visibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}
const props = {
  onBack: vi.fn(), onOpenFiatCurrencies: vi.fn(), onOpenBuyProviders: vi.fn(),
  onOpenPasskeySettings: vi.fn(), onOpenSecurity: vi.fn(), onOpenBackup: vi.fn(),
  onOpenEmail: vi.fn(), onOpenUnilateralExit: vi.fn(),
};
const page = (network = 'regtest') => <SettingsPage {...props} config={{ network } as Config} />;

beforeEach(() => {
  visibility('visible');
  invalidateNativePinPolicy();
  confirmNativePinPolicy(false, getNativePinPolicyRevision());
  fixtures.pin.mockReset().mockResolvedValue(false);
  fixtures.getInfo.mockReset().mockResolvedValue({ identityPubkey: 'synthetic-public-wallet-identity' });
  fixtures.exportDb.mockReset().mockResolvedValue(undefined);
  fixtures.wallet = { getInfo: fixtures.getInfo };
  fixtures.callbacks.length = 0;
  fixtures.confirms.length = 0;
});
afterEach(() => { cleanup(); visibility('visible'); });

describe('database export policy authorization', () => {
  it('keeps both export gates closed when PIN policy is unreadable and permits a fresh retry', async () => {
    fixtures.pin.mockRejectedValueOnce(new Error('PIN record unavailable'));
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Your wallet is preserved');
    expect(screen.queryByRole('button', { name: 'Unlock export' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export now' })).toBeNull();
    expect(fixtures.getInfo).not.toHaveBeenCalled();
    expect(fixtures.exportDb).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    await screen.findByRole('button', { name: 'Export now' });
    expect(fixtures.pin).toHaveBeenCalledTimes(2);
  });

  it('does not read PIN policy while the native read lease is locked', async () => {
    lockNativeReadAccess();
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    await screen.findByRole('alert');
    expect(fixtures.pin).not.toHaveBeenCalled();
    expect(fixtures.getInfo).not.toHaveBeenCalled();
    expect(fixtures.exportDb).not.toHaveBeenCalled();
  });

  it.each(['policy', 'binding', 'background'] as const)('rejects a delayed no-PIN result after %s changes', async change => {
    const pending = deferred<boolean>();
    fixtures.pin.mockReturnValueOnce(pending.promise);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    await waitFor(() => expect(fixtures.pin).toHaveBeenCalledOnce());
    act(() => {
      if (change === 'policy') invalidateNativePinPolicy();
      if (change === 'binding') invalidateNativeReadBinding();
      if (change === 'background') { visibility('hidden'); visibility('visible'); }
    });
    await act(async () => { pending.resolve(false); });
    expect(screen.queryByRole('button', { name: 'Export now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unlock export' })).toBeNull();
    expect(fixtures.getInfo).not.toHaveBeenCalled();
    expect(fixtures.exportDb).not.toHaveBeenCalled();
  });

  it('ignores a pending policy result after unmounting', async () => {
    const pending = deferred<boolean>();
    fixtures.pin.mockReturnValueOnce(pending.promise);
    const { unmount } = render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    await waitFor(() => expect(fixtures.pin).toHaveBeenCalledOnce());
    unmount();
    await act(async () => { pending.resolve(false); });
    expect(fixtures.getInfo).not.toHaveBeenCalled();
    expect(fixtures.exportDb).not.toHaveBeenCalled();
  });

  it('a cancelled PIN callback cannot authorize a newer no-PIN confirmation', async () => {
    fixtures.pin.mockResolvedValueOnce(true);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    await screen.findByRole('button', { name: 'Unlock export' });
    const stale = fixtures.callbacks[fixtures.callbacks.length - 1];
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    await screen.findByRole('button', { name: 'Export now' });
    await act(async () => { stale(); });
    expect(fixtures.getInfo).not.toHaveBeenCalled();
    expect(fixtures.exportDb).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Export now' })).toBeVisible();
  });

  it('exports once after the current confirmation and binds the selected identity and network', async () => {
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    await screen.findByRole('button', { name: 'Export now' });
    const confirm = fixtures.confirms[fixtures.confirms.length - 1];
    await act(async () => { confirm(); confirm(); });
    await waitFor(() => expect(fixtures.exportDb).toHaveBeenCalledOnce());
    expect(fixtures.getInfo).toHaveBeenCalledOnce();
    expect(fixtures.exportDb).toHaveBeenCalledWith('synthetic-public-wallet-identity', 'regtest', expect.any(Function));
  });

  it.each(['policy', 'binding', 'background', 'unmount', 'network'] as const)('does not export a delayed identity read after %s changes', async change => {
    const pending = deferred<{ identityPubkey: string }>();
    fixtures.getInfo.mockReturnValueOnce(pending.promise);
    const view = render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Export now' }));
    await waitFor(() => expect(fixtures.getInfo).toHaveBeenCalledOnce());
    act(() => {
      if (change === 'policy') invalidateNativePinPolicy();
      if (change === 'binding') invalidateNativeReadBinding();
      if (change === 'background') { visibility('hidden'); visibility('visible'); }
      if (change === 'unmount') view.unmount();
      if (change === 'network') view.rerender(page('mainnet'));
    });
    await act(async () => { pending.resolve({ identityPubkey: 'old-wallet' }); });
    expect(fixtures.exportDb).not.toHaveBeenCalled();
  });

  it('shows export failure and permits retry without an unhandled rejection', async () => {
    fixtures.exportDb.mockRejectedValueOnce(new Error('Database not available'));
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Export Database' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Export now' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not export your database');
    expect(screen.getByRole('button', { name: 'Export Database' })).toBeEnabled();
  });
});
