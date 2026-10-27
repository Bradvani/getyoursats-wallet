import type {ReactNode} from 'react';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Seed} from '@breeztech/breez-sdk-spark';
import type {WalletSetupController} from './hooks/useWalletSetup';

const harness = vi.hoisted(() => ({
  native: false,
  snapshot: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  connect: vi.fn<(...args: unknown[]) => Promise<object | null>>(),
  retrieveSeed: vi.fn<() => Promise<Seed>>(),
  storeSeed: vi.fn<(...args: unknown[]) => Promise<void>>(),
  generateMnemonic: vi.fn(() => 'synthetic native seed fixture'),
  formatPaymentAmount: vi.fn(() => ''),
  showToast: vi.fn(),
  PassThrough: ({children}: {children: ReactNode}) => children,
  phrase: 'synthetic phrase fixture, not a recovery phrase',
  mockSeed: {type: 'mnemonic', mnemonic: 'synthetic passkey seed fixture'} as Seed,
}));

vi.mock('./hooks/useBreezSdk', async () => {
  const {useSyncExternalStore} = await import('react');
  const subscribe = (listener: () => void) => {
    harness.listeners.add(listener);
    return () => { harness.listeners.delete(listener); };
  };
  return {useBreezSdk: () => useSyncExternalStore(subscribe, () => harness.snapshot)};
});
vi.mock('@capacitor/core', () => ({Capacitor: {isNativePlatform: () => harness.native}}));
vi.mock('bip39', async importOriginal => ({
  ...await importOriginal<typeof import('bip39')>(), generateMnemonic: harness.generateMnemonic,
}));
vi.mock('./services/secureStorage', () => ({
  deviceOnlyStorage: {isSupported: () => true, retrieveSeed: harness.retrieveSeed, storeSeed: harness.storeSeed},
  SecureStorageError: class extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
vi.mock('./getyoursats/walletReadiness', () => ({isWalletServiceConfigured: () => true}));
// Keep real local metadata cleanup; no SDK initialization or PRF operation runs.
vi.mock('./services/sdkReady', () => ({sdkReady: vi.fn()}));
vi.mock('./services/passkeyService', async importOriginal => {
  const actual = await importOriginal<typeof import('./services/passkeyService')>();
  return {
    ...actual,
    prfAvailability: vi.fn(async () => true),
    clearPasskeyMode: vi.fn(actual.clearPasskeyMode),
    clearKnownCredentials: vi.fn(),
    clearPasskeyHistory: vi.fn(),
  };
});
vi.mock('./contexts/WalletContext', () => ({
  WalletProvider: harness.PassThrough, WalletInfoProvider: harness.PassThrough, WalletStatusProvider: harness.PassThrough,
}));
vi.mock('./contexts/ToastContext', () => ({ToastProvider: harness.PassThrough, useToast: () => ({showToast: harness.showToast})}));
vi.mock('./contexts/FiatDataContext', () => ({FiatDataProvider: harness.PassThrough}));
vi.mock('./contexts/StableBalanceContext', () => ({
  StableBalanceProvider: harness.PassThrough,
  useStableBalance: () => ({formatPaymentAmount: harness.formatPaymentAmount}),
}));
vi.mock('./contexts/ContactsContext', () => ({ContactsProvider: harness.PassThrough}));
vi.mock('./components/StagingGate', () => ({default: harness.PassThrough}));
vi.mock('./components/layout/AppShell', () => ({default: harness.PassThrough}));
vi.mock('./hooks/useAppLock', () => ({useAppLock: () => ({locked: false})}));
vi.mock('./features/unilateral-exit/hooks/useUnilateralExitEngineLifecycle', () => ({useUnilateralExitEngineLifecycle: vi.fn()}));
vi.mock('./hooks/useIOSViewportFix', () => ({useIOSViewportFix: vi.fn()}));
vi.mock('./hooks/useStatusBarColor', () => ({useStatusBarColor: vi.fn()}));
vi.mock('./utils/statusBarManager', () => ({STATUS_BAR_LOADING: ''}));
vi.mock('./hooks/useBackButton', () => ({useBackButton: vi.fn()}));
vi.mock('./components/LoadingSpinner', () => ({default: () => null}));
vi.mock('./components/BrandIntro', () => ({default: () => null}));
vi.mock('./components/PaymentCelebration', () => ({default: () => null}));
// Incoming-event ownership is exercised in IncomingPaymentNotice.test.tsx.
vi.mock('./components/IncomingPaymentNotice', () => ({default: () => null}));
vi.mock('./components/OfflineBanner', () => ({default: () => null}));
vi.mock('./components/LockScreen', () => ({default: () => null}));
vi.mock('./getyoursats/DcaPage', () => ({default: () => null}));
vi.mock('./getyoursats/SetupOptionsPage', () => ({default: () => null}));
vi.mock('./pages/EmailVerificationPage', () => ({default: () => null}));
vi.mock('./pages/GetRefundPage', () => ({default: () => null}));
vi.mock('./pages/BackupPage', () => ({default: () => null}));
vi.mock('./pages/SecurityPage', () => ({default: () => null}));
vi.mock('./pages/SettingsPage', () => ({default: () => null}));
vi.mock('./pages/FiatCurrenciesPage', () => ({default: () => null}));
vi.mock('./pages/BuyProvidersPage', () => ({default: () => null}));
vi.mock('./pages/UnlockPage', () => ({default: () => null}));
vi.mock('./pages/UnlockingPage', () => ({default: () => null}));
vi.mock('./pages/HomePage', () => ({default: (props: {
  onCreatePasskey: () => void; onCreateManualWallet: () => void;
  onRestoreWallet: () => void; onCreateNewWallet: () => void;
  setupIssue: string | null;
}) => <>
  {props.setupIssue && <p role="alert">{props.setupIssue}</p>}
  <button onClick={props.onCreatePasskey}>Create Passkey</button>
  <button onClick={props.onCreateManualWallet}>Create Phrase Wallet</button>
  <button onClick={props.onRestoreWallet}>Restore Phrase Wallet</button>
  <button onClick={props.onCreateNewWallet}>Start Wallet</button>
</>}));
vi.mock('./pages/GeneratePage', () => ({default: ({onMnemonicConfirmed}: {
  onMnemonicConfirmed: (phrase: string) => Promise<void>;
}) => <button onClick={() => { void onMnemonicConfirmed(harness.phrase).catch(() => {}); }}>Confirm Written Backup</button>}));
vi.mock('./pages/RestorePage', () => ({default: ({onConnect}: {
  onConnect: (phrase: string) => Promise<void>;
}) => <button onClick={() => { void onConnect(harness.phrase).catch(() => {}); }}>Restore Phrase</button>}));
vi.mock('./pages/PasskeyPage', () => ({default: (props: {
  onWalletReady: (seed: Seed, label: string, isNew: boolean) => Promise<void>;
  onFlowComplete: () => void; onUseRecoveryPhrase: () => void; sdkConnected: boolean;
}) => <>
  <button onClick={() => {
    // The actual page sets this before its SDK connection callback resolves.
    localStorage.setItem('passkeyLabel', 'Test Wallet');
    void props.onWalletReady(harness.mockSeed, 'Test Wallet', true);
  }}>Connect New Passkey</button>
  <button onClick={() => { void props.onWalletReady(harness.mockSeed, 'Test Wallet', false); }}>Connect Existing Passkey</button>
  <button disabled={!props.sdkConnected} onClick={props.onFlowComplete}>Finish Passkey</button>
  <button onClick={props.onUseRecoveryPhrase}>Use Recovery Phrase</button>
</>}));
vi.mock('./pages/WalletPage', () => ({default: ({walletSetup, recoveryMethod}: {
  walletSetup: WalletSetupController; recoveryMethod: string;
}) => <>
  <output aria-label="Recovery method">{recoveryMethod}</output>
  <output aria-label="Tour status">{walletSetup.progress.tourStatus}</output>
  <output aria-label="Recovery status">{walletSetup.progress.recoveryStatus}</output>
</>}));

import App from './App';
import {clearKnownCredentials, clearPasskeyHistory, clearPasskeyMode, setPasskeyMode} from './services/passkeyService';
import {LocalStorageCredentialRegistry} from './services/localStorageCredentialRegistry';
import {SecureStorageError} from './services/secureStorage';
import {clearWalletSetupMemory, readWalletSetup, walletSetupScope} from './getyoursats/walletSetupState';

const identity = `02${'a'.repeat(64)}`;
const scope = walletSetupScope(identity, 'mainnet');
const client = {testClient: true};
const registry = new LocalStorageCredentialRegistry();
const credential = new Uint8Array([4, 5, 6]);
const relyingParty = 'test.example';

function publishWallet() {
  harness.snapshot = {
    ...harness.snapshot, sdk: client, isConnected: true,
    walletInfo: {identityPubkey: identity}, config: {network: 'mainnet'},
  };
  harness.listeners.forEach(listener => listener());
}

async function expectRegistryPreserved() {
  expect(await registry.read(relyingParty)).toEqual([credential]);
  expect(localStorage.getItem('passkeyRegistered')).toBe('1');
  expect(localStorage.getItem('passkeyRpId')).toBe(relyingParty);
  expect(clearKnownCredentials).not.toHaveBeenCalled();
  expect(clearPasskeyHistory).not.toHaveBeenCalled();
}

async function expectWallet(method: string, tour: string, recovery: string) {
  await waitFor(() => {
    expect(screen.getByLabelText('Recovery method')).toHaveTextContent(method);
    expect(screen.getByLabelText('Tour status')).toHaveTextContent(tour);
    expect(screen.getByLabelText('Recovery status')).toHaveTextContent(recovery);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  clearWalletSetupMemory();
  harness.native = false;
  harness.retrieveSeed.mockReset();
  harness.storeSeed.mockReset().mockResolvedValue();
  harness.connect.mockReset().mockImplementation(async () => { publishWallet(); return client; });
  harness.snapshot = {
    sdk: null, isConnected: false, walletInfo: null, config: null, isLoading: false,
    startupState: 'no-wallet', prfAvailable: true, needsPasskeyMigration: false,
    celebrationPayment: null, connectWallet: harness.connect,
  };
  await registry.add(relyingParty, credential);
  setPasskeyMode('Earlier Wallet', relyingParty);
  localStorage.setItem('passkeyActiveCredentialId', 'BAUG');
  localStorage.setItem('passkeyActiveCredentialRpId', relyingParty);
});

afterEach(() => {
  cleanup();
  clearWalletSetupMemory();
});

describe('App wallet setup enrollment and recovery mode', () => {
  it('enrolls a fresh passkey without claiming a verified backup or clearing its mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Create Passkey'));
    await user.click(screen.getByText('Connect New Passkey'));
    await user.click(screen.getByText('Finish Passkey'));
    await expectWallet('passkey', 'active', 'pending');
    expect(harness.connect).toHaveBeenCalledWith(harness.mockSeed, false, 'Test Wallet');
    expect(clearPasskeyMode).not.toHaveBeenCalled();
    await expectRegistryPreserved();
  });

  it('does not automatically enroll an existing passkey wallet', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Create Passkey'));
    await user.click(screen.getByText('Connect Existing Passkey'));
    await user.click(screen.getByText('Finish Passkey'));
    await expectWallet('passkey', 'not-started', 'pending');
    expect(harness.connect).toHaveBeenCalledWith(harness.mockSeed, true, 'Test Wallet');
    expect(clearPasskeyMode).not.toHaveBeenCalled();
  });

  it('clears stale mode and enrolls verified phrase creation only after a successful connection', async () => {
    const user = userEvent.setup();
    let finish!: (value: object) => void;
    harness.connect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<App />);
    await user.click(screen.getByText('Create Phrase Wallet'));
    await user.click(screen.getByText('Confirm Written Backup'));
    expect(clearPasskeyMode).not.toHaveBeenCalled();
    expect(localStorage.getItem('passkeyLabel')).toBe('Earlier Wallet');
    expect(readWalletSetup(scope).tourStatus).toBe('not-started');
    await act(async () => { publishWallet(); finish(client); });
    await expectWallet('phrase', 'active', 'phrase-verified');
    expect(harness.connect).toHaveBeenCalledWith({type: 'mnemonic', mnemonic: harness.phrase}, false);
    expect(clearPasskeyMode).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('passkeyActiveCredentialId')).toBeNull();
    expect(localStorage.getItem('passkeyActiveCredentialRpId')).toBeNull();
    await expectRegistryPreserved();
  });

  it('clears stale mode on successful phrase restore without enrolling or claiming a backup', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Restore Phrase Wallet'));
    await user.click(screen.getByText('Restore Phrase'));
    await expectWallet('phrase', 'not-started', 'pending');
    expect(harness.connect).toHaveBeenCalledWith({type: 'mnemonic', mnemonic: harness.phrase}, true);
    expect(clearPasskeyMode).toHaveBeenCalledTimes(1);
    await expectRegistryPreserved();
  });

  it('recovers from failed passkey creation into phrase setup without deleting the credential registry', async () => {
    const user = userEvent.setup();
    harness.connect.mockRejectedValueOnce(new Error('Synthetic connection failure'));
    render(<App />);
    await user.click(screen.getByText('Create Passkey'));
    await user.click(screen.getByText('Connect New Passkey'));
    expect(screen.getByText('Finish Passkey')).toBeDisabled();
    expect(localStorage.getItem('passkeyLabel')).toBe('Test Wallet');
    expect(clearPasskeyMode).not.toHaveBeenCalled();
    expect(readWalletSetup(scope).tourStatus).toBe('not-started');
    await user.click(screen.getByText('Use Recovery Phrase'));
    await user.click(screen.getByText('Confirm Written Backup'));
    await expectWallet('phrase', 'active', 'phrase-verified');
    expect(clearPasskeyMode).toHaveBeenCalledTimes(1);
    await expectRegistryPreserved();
  });

  it('preserves recovery metadata after a failed explicit phrase connection', async () => {
    const user = userEvent.setup();
    harness.connect.mockRejectedValueOnce(new Error('Synthetic connection failure'));
    render(<App />);
    await user.click(screen.getByText('Restore Phrase Wallet'));
    await user.click(screen.getByText('Restore Phrase'));
    expect(clearPasskeyMode).not.toHaveBeenCalled();
    expect(localStorage.getItem('passkeyLabel')).toBe('Earlier Wallet');
    expect(localStorage.getItem('passkeyActiveCredentialId')).toBe('BAUG');
    expect(readWalletSetup(scope).tourStatus).toBe('not-started');
    await expectRegistryPreserved();
  });

  it('does not clear mode or enroll when an already-connected client returns null', async () => {
    const user = userEvent.setup();
    harness.connect.mockImplementationOnce(async () => { publishWallet(); return null; });
    render(<App />);
    await user.click(screen.getByText('Create Phrase Wallet'));
    await user.click(screen.getByText('Confirm Written Backup'));
    await expectWallet('passkey', 'not-started', 'pending');
    expect(clearPasskeyMode).not.toHaveBeenCalled();
    await expectRegistryPreserved();
  });

  it('preserves passkey mode when reopening an existing native vault', async () => {
    const user = userEvent.setup();
    harness.native = true;
    harness.retrieveSeed.mockResolvedValue(harness.mockSeed);
    render(<App />);
    await user.click(screen.getByText('Start Wallet'));
    await expectWallet('passkey', 'not-started', 'pending');
    expect(harness.connect).toHaveBeenCalledWith(harness.mockSeed, false, undefined, 'secureStorage');
    expect(harness.storeSeed).not.toHaveBeenCalled();
    expect(harness.generateMnemonic).not.toHaveBeenCalled();
    expect(clearPasskeyMode).not.toHaveBeenCalled();
    await expectRegistryPreserved();
  });

  it('clears stale mode for a new native vault after its read-back and connection succeed', async () => {
    const user = userEvent.setup();
    const mockNativeSeed: Seed = {type: 'mnemonic', mnemonic: 'synthetic native seed fixture'};
    harness.native = true;
    harness.retrieveSeed
      .mockRejectedValueOnce(new SecureStorageError('NO_STORED_SEED', 'Synthetic empty vault'))
      .mockResolvedValueOnce(mockNativeSeed);
    render(<App />);
    await user.click(screen.getByText('Start Wallet'));
    await expectWallet('device', 'active', 'pending');
    expect(harness.storeSeed).toHaveBeenCalledWith(mockNativeSeed);
    expect(harness.retrieveSeed).toHaveBeenCalledTimes(2);
    expect(harness.connect).toHaveBeenCalledWith(mockNativeSeed, false, undefined, 'secureStorage');
    expect(clearPasskeyMode).toHaveBeenCalledTimes(1);
    await expectRegistryPreserved();
  });

  it.each(['read-back', 'connection'])('preserves recovery metadata when native %s fails', async stage => {
    const user = userEvent.setup();
    harness.native = true;
    harness.retrieveSeed
      .mockRejectedValueOnce(new SecureStorageError('NO_STORED_SEED', 'Synthetic empty vault'))
      .mockResolvedValueOnce({type: 'mnemonic', mnemonic: stage === 'read-back'
        ? 'different synthetic fixture' : 'synthetic native seed fixture'});
    harness.connect.mockRejectedValueOnce(new Error('Synthetic connection failure'));
    render(<App />);
    await user.click(screen.getByText('Start Wallet'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not secure wallet keys');
    expect(clearPasskeyMode).not.toHaveBeenCalled();
    expect(localStorage.getItem('passkeyLabel')).toBe('Earlier Wallet');
    expect(readWalletSetup(scope).tourStatus).toBe('not-started');
    expect(harness.connect).toHaveBeenCalledTimes(stage === 'read-back' ? 0 : 1);
    await expectRegistryPreserved();
  });
});
