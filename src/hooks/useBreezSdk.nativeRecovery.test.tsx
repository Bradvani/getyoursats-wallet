import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { useBreezSdk } from './useBreezSdk';
import { SecureStorageError } from '../services/secureStorage';
import { resetNativeSeedSelection } from '../services/nativeSeedSelection';
import { clearSignerIdentity, rememberSignerIdentity } from '../security/spendApproval';
import { readWalletSeed } from '../features/unilateral-exit/funding';
import { invalidatePasskey, pinActivePasskeyCredentialId, setPendingSwitchFromCredentialId } from '../services/passkeyService';

const fixtures = vi.hoisted(() => ({
  boundRecord: null as string | null,
  deviceRecord: null as string | null,
  device: { isSupported: vi.fn(), hasStoredSeed: vi.fn(), retrieveSeed: vi.fn(), clearSeed: vi.fn(), storeSeed: vi.fn() },
  bound: { isSupported: vi.fn(), hasStoredSeed: vi.fn(), retrieveSeed: vi.fn(), clearSeed: vi.fn() },
  connect: vi.fn(), ready: vi.fn(), factory: vi.fn(), passkey: vi.fn(), passkeyMode: vi.fn(),
  getMnemonic: vi.fn(), clearMnemonic: vi.fn(), wipe: vi.fn(), clearPin: vi.fn(),
  addListener: vi.fn(), hideSplash: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: fixtures.addListener } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }));
vi.mock('@breeztech/breez-sdk-spark', () => ({ initLogging: vi.fn(), defaultExternalSignersFromSeed: fixtures.factory }));
vi.mock('../services/sdkReady', () => ({ sdkReady: fixtures.ready }));
vi.mock('../services/sdkConnect', () => ({
  selectedNetwork: 'regtest', buildConnectConfig: () => ({ network: 'regtest' }), connectSdk: fixtures.connect,
}));
vi.mock('../services/secureStorage', () => ({
  deviceOnlyStorage: fixtures.device, secureStorage: fixtures.bound, resetSecureStorageInit: vi.fn(),
  SecureStorageError: class extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  },
}));
vi.mock('../services/logger', () => ({
  LogCategory: {}, logSdkMessage: vi.fn(),
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    initSession: vi.fn(async () => {}), endSession: vi.fn(async () => {}), clear: vi.fn(),
    sdkInitialized: vi.fn(), authSuccess: vi.fn(), authFailure: vi.fn(),
    time: <T,>(_label: string, run: () => Promise<T>) => run(),
  },
}));
vi.mock('../main', () => ({ hideSplash: fixtures.hideSplash }));
vi.mock('../services/passkeyService', () => ({
  prfAvailability: vi.fn(async () => false), isPasskeyMode: fixtures.passkeyMode,
  setPasskeyMode: vi.fn(), clearPasskeyMode: vi.fn(), clearKnownCredentials: vi.fn(),
  getKnownCredentialIdsBase64: vi.fn(async () => []), hasPasskeyHistory: vi.fn(() => false),
  markLabelUsed: vi.fn(), invalidatePasskey: vi.fn(), pinActivePasskeyCredentialId: vi.fn(),
  signInPinnedToActiveCredential: fixtures.passkey, getPasskeyLabel: vi.fn(() => 'Default'),
  setPendingSwitchFromCredentialId: vi.fn(), getPasskeyRpId: vi.fn(), setPasskeyRpId: vi.fn(),
  isMigrationInProgress: vi.fn(() => false), isPasskeyMigrated: vi.fn(() => false),
}));
vi.mock('../services/passkeyPrfProvider', () => ({ LEGACY_RP_ID: 'example.invalid', SHARED_RP_ID: null, rpId: 'example.invalid' }));
vi.mock('../services/legacyMnemonicMigration', () => ({
  getSavedMnemonic: fixtures.getMnemonic, clearMnemonic: fixtures.clearMnemonic,
  migrateLegacyMnemonicIfNeeded: vi.fn(async () => {}),
}));
vi.mock('../services/settings', () => ({
  setCachedStableTicker: vi.fn(), clearNetworkOverride: vi.fn(), clearStableRestorePrompted: vi.fn(),
  ensureSparkPrivateMode: vi.fn(async () => {}),
}));
vi.mock('../services/accountDeletion', () => ({ wipeAllLocalData: fixtures.wipe }));
vi.mock('../services/appLock', () => ({ clearPin: fixtures.clearPin, isAppLockSupported: () => true }));
vi.mock('../utils/externalLink', () => ({ isStandalonePwa: () => false, openExternalUrl: vi.fn() }));
vi.mock('../contexts/WalletContext', () => ({ hasConversionInFlight: () => false }));
vi.mock('../security/browserSdkLifetime', () => ({ stopBrowserSdk: vi.fn() }));
vi.mock('../security/operationGateway', () => ({ getOperationReconciliation: vi.fn() }));
vi.mock('../services/nativeLightningSession', () => ({ assertNativeLightningAddress: vi.fn(), withNativeLightningSession: vi.fn() }));
vi.mock('../getyoursats/featureAvailability', () => ({ featureAvailability: { nativeLightningAddress: false } }));

const SEED = { type: 'mnemonic' as const, mnemonic: Array(11).fill('abandon').concat('about').join(' ') };
const IDENTITY = `02${'11'.repeat(32)}`;
const RECOVERY_RECORDS = {
  'recovery-plan:public-fixture': 'retained exit receipt',
  'gys:payment-journal:v1:public-fixture:operation': 'retained payment receipt',
};

beforeEach(() => {
  resetNativeSeedSelection();
  clearSignerIdentity();
  fixtures.boundRecord = null;
  fixtures.deviceRecord = null;
  localStorage.clear();
  for (const [key, value] of Object.entries(RECOVERY_RECORDS)) localStorage.setItem(key, value);
  fixtures.device.isSupported.mockReset().mockReturnValue(true);
  fixtures.bound.isSupported.mockReset().mockReturnValue(true);
  fixtures.device.hasStoredSeed.mockReset().mockImplementation(async () => fixtures.deviceRecord !== null);
  fixtures.bound.hasStoredSeed.mockReset().mockImplementation(async () => fixtures.boundRecord !== null);
  fixtures.device.retrieveSeed.mockReset().mockRejectedValue(new SecureStorageError('KEY_INVALIDATED', 'Synthetic OS key invalidation'));
  fixtures.bound.retrieveSeed.mockReset().mockRejectedValue(new SecureStorageError('KEY_INVALIDATED', 'Synthetic OS key invalidation'));
  fixtures.device.clearSeed.mockReset().mockImplementation(async () => { fixtures.deviceRecord = null; });
  fixtures.bound.clearSeed.mockReset().mockImplementation(async () => { fixtures.boundRecord = null; });
  fixtures.device.storeSeed.mockReset().mockImplementation(async () => { fixtures.deviceRecord = 'replacement'; });
  fixtures.passkeyMode.mockReset().mockReturnValue(false);
  fixtures.getMnemonic.mockReset().mockReturnValue(null);
  fixtures.passkey.mockReset().mockRejectedValue(new Error('Unexpected passkey fallback'));
  fixtures.connect.mockReset().mockRejectedValue(new Error('Unexpected SDK connection'));
  fixtures.ready.mockReset().mockResolvedValue(undefined);
  fixtures.factory.mockReset().mockReturnValue({
    breezSigner: { free: vi.fn() },
    sparkSigner: { getIdentityPublicKey: vi.fn(async () => ({ bytes: [2, ...Array(32).fill(17)] })), free: vi.fn() },
    free: vi.fn(),
  });
  fixtures.addListener.mockReset().mockResolvedValue({ remove: vi.fn() });
  fixtures.hideSplash.mockReset().mockResolvedValue(undefined);
});

afterEach(() => { cleanup(); resetNativeSeedSelection(); clearSignerIdentity(); });

function expectRecordsPreserved() {
  expect(fixtures.device.clearSeed).not.toHaveBeenCalled();
  expect(fixtures.bound.clearSeed).not.toHaveBeenCalled();
  expect(fixtures.device.storeSeed).not.toHaveBeenCalled();
  expect(fixtures.wipe).not.toHaveBeenCalled();
  expect(fixtures.clearPin).not.toHaveBeenCalled();
  expect(fixtures.clearMnemonic).not.toHaveBeenCalled();
  for (const [key, value] of Object.entries(RECOVERY_RECORDS)) expect(localStorage.getItem(key)).toBe(value);
}

describe('native startup and retry preserve selected wallet records', () => {
  it.each(['device', 'bound'] as const)('retains a %s wallet after startup and retry report OS key invalidation', async tier => {
    if (tier === 'device') fixtures.deviceRecord = 'original device ciphertext';
    else fixtures.boundRecord = 'original bound ciphertext';
    fixtures.passkeyMode.mockReturnValue(true);
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.startupState).toBe('native-locked');
    expect(result.current.error).toMatch(/recover|restore/i);
    await act(() => result.current.retryUnlock());
    expect(result.current.startupState).toBe('native-locked');
    expect(fixtures[tier].retrieveSeed).toHaveBeenCalledTimes(2);
    expect(fixtures.connect).not.toHaveBeenCalled();
    expect(fixtures.passkey).not.toHaveBeenCalled();
    expectRecordsPreserved();
  });

  it('retains both records and keeps device-only selection after it fails or disappears', async () => {
    fixtures.deviceRecord = 'active device ciphertext';
    fixtures.boundRecord = 'other bound ciphertext';
    fixtures.bound.retrieveSeed.mockResolvedValue({ ...SEED, passphrase: 'different wallet' });
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.startupState).toBe('native-locked');
    fixtures.device.hasStoredSeed.mockResolvedValue(false);
    fixtures.device.retrieveSeed.mockRejectedValue(new SecureStorageError('NO_STORED_SEED', 'Selected record disappeared'));
    await act(() => result.current.retryUnlock());
    expect(result.current.startupState).toBe('native-locked');
    expect(fixtures.bound.retrieveSeed).not.toHaveBeenCalled();
    expect(fixtures.connect).not.toHaveBeenCalled();
    expect(fixtures.deviceRecord).toBe('active device ciphertext');
    expect(fixtures.boundRecord).toBe('other bound ciphertext');
    await expect(readWalletSeed()).rejects.toThrow(/connection/);
    expect(fixtures.factory).not.toHaveBeenCalled();
    expect(fixtures.bound.retrieveSeed).not.toHaveBeenCalled();
    expectRecordsPreserved();
  });

  it('does not treat a failed presence probe as permission to use another identity', async () => {
    fixtures.deviceRecord = 'unreadable device ciphertext';
    fixtures.boundRecord = 'other bound ciphertext';
    fixtures.device.hasStoredSeed.mockRejectedValue(new SecureStorageError('KEY_INVALIDATED', 'Presence check failed'));
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.startupState).toBe('native-locked');
    expect(fixtures.bound.retrieveSeed).not.toHaveBeenCalled();
    expect(fixtures.connect).not.toHaveBeenCalled();
    expectRecordsPreserved();
  });

  it('retries an unconfirmed device probe and opens the retained bound wallet only after device absence is confirmed', async () => {
    fixtures.boundRecord = 'retained bound ciphertext';
    fixtures.device.hasStoredSeed.mockRejectedValueOnce(new SecureStorageError('UNKNOWN', 'Temporary presence failure')).mockResolvedValue(false);
    fixtures.bound.retrieveSeed.mockResolvedValue(SEED);
    const sdk = {
      getInfo: vi.fn(async () => ({ identityPubkey: IDENTITY })),
      listPayments: vi.fn(async () => ({ payments: [] })),
      listUnclaimedDeposits: vi.fn(async () => ({ deposits: [] })),
      addEventListener: vi.fn(async () => 'fixture-listener'), removeEventListener: vi.fn(async () => {}),
    } as unknown as BreezSdk;
    fixtures.connect.mockImplementation(async () => { await rememberSignerIdentity(SEED); return sdk; });
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.startupState).toBe('native-locked'));
    expect(fixtures.bound.retrieveSeed).not.toHaveBeenCalled();
    await act(() => result.current.retryUnlock());
    expect(result.current.startupState).toBe('connected');
    expect(fixtures.device.hasStoredSeed).toHaveBeenCalledTimes(2);
    expect(fixtures.device.retrieveSeed).not.toHaveBeenCalled();
    expect(fixtures.bound.retrieveSeed).toHaveBeenCalledOnce();
    expectRecordsPreserved();
  });

  it.each(['device', 'bound'] as const)('connects the selected %s seed and funding keeps that identity when both records exist', async tier => {
    fixtures.boundRecord = 'retained bound ciphertext';
    if (tier === 'device') fixtures.deviceRecord = 'active device ciphertext';
    fixtures[tier].retrieveSeed.mockResolvedValue(SEED);
    const sdk = {
      getInfo: vi.fn(async () => ({ identityPubkey: IDENTITY })),
      listPayments: vi.fn(async () => ({ payments: [] })),
      listUnclaimedDeposits: vi.fn(async () => ({ deposits: [] })),
      addEventListener: vi.fn(async () => 'fixture-listener'), removeEventListener: vi.fn(async () => {}),
    } as unknown as BreezSdk;
    fixtures.connect.mockImplementation(async () => { await rememberSignerIdentity(SEED); return sdk; });
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.startupState).toBe('connected'));
    expect(fixtures.connect).toHaveBeenCalledWith(expect.objectContaining({ seed: SEED }));
    // A newly appearing tier must not retarget an already connected bound wallet.
    if (tier === 'bound') fixtures.deviceRecord = 'other device ciphertext';
    await expect(readWalletSeed({ interactive: true })).resolves.toEqual(SEED);
    expect(fixtures.factory).toHaveBeenCalledWith(SEED, 'regtest', undefined);
    expect(fixtures[tier === 'device' ? 'bound' : 'device'].retrieveSeed).not.toHaveBeenCalled();
    expect(fixtures.boundRecord).toBe('retained bound ciphertext');
    expectRecordsPreserved();
  });

  it('still reaches onboarding when both presence checks prove no saved native wallet', async () => {
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.startupState).toBe('no-wallet'));
    expect(fixtures.connect).not.toHaveBeenCalled();
    expect(fixtures.passkey).not.toHaveBeenCalled();
    expectRecordsPreserved();
  });

  it('revokes native seed reads before waiting for failed-connection cleanup', async () => {
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.startupState).toBe('no-wallet'));
    fixtures.device.retrieveSeed.mockResolvedValue(SEED);
    const storageError = new Error('Native persistence failed');
    fixtures.device.storeSeed.mockImplementation(async () => {
      // The OS write may commit before its acknowledgement is lost.
      fixtures.deviceRecord = 'unacknowledged device ciphertext';
      throw storageError;
    });
    let finishDisconnect!: () => void;
    const sdk = {
      getInfo: vi.fn(async () => ({ identityPubkey: IDENTITY })),
      disconnect: vi.fn(() => new Promise<void>(resolve => { finishDisconnect = resolve; })),
    } as unknown as BreezSdk;
    fixtures.connect.mockImplementation(async () => { await rememberSignerIdentity(SEED); return sdk; });
    let connecting!: Promise<BreezSdk | null>;
    act(() => { connecting = result.current.connectWallet(SEED, false); });
    await waitFor(() => expect(sdk.disconnect).toHaveBeenCalledOnce());
    await expect(readWalletSeed({ interactive: true })).rejects.toThrow(/connection/);
    expect(fixtures.factory).not.toHaveBeenCalled();
    expect(fixtures.deviceRecord).toBe('unacknowledged device ciphertext');
    await act(async () => {
      finishDisconnect();
      await expect(connecting).rejects.toBe(storageError);
    });
    expect(fixtures.device.clearSeed).not.toHaveBeenCalled();
    expect(fixtures.bound.clearSeed).not.toHaveBeenCalled();
  });
});

describe('native wallet switches preserve the current connection and stored keys', () => {
  it.each(['label', 'rp', 'credential'] as const)('blocks a %s switch before changing an existing wallet', async action => {
    fixtures.deviceRecord = 'original device ciphertext';
    fixtures.boundRecord = 'other retained bound ciphertext';
    fixtures.device.retrieveSeed.mockResolvedValue(SEED);
    const sdk = {
      getInfo: vi.fn(async () => ({ identityPubkey: IDENTITY })),
      listPayments: vi.fn(async () => ({ payments: [] })),
      listUnclaimedDeposits: vi.fn(async () => ({ deposits: [] })),
      addEventListener: vi.fn(async () => 'fixture-listener'), removeEventListener: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    } as unknown as BreezSdk;
    fixtures.connect.mockImplementation(async () => { await rememberSignerIdentity(SEED); return sdk; });
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.startupState).toBe('connected'));
    localStorage.setItem('passkeyActiveCredentialId', 'original-credential');
    localStorage.setItem('passkeyLabel', 'original-label');
    const pinned = vi.fn();
    const invoke = () => action === 'label'
      ? result.current.switchPasskeyLabel('another-label')
      : action === 'rp'
        ? result.current.switchPasskeyRp('another.example.invalid')
        : result.current.prepareSwitchPasskeyCredential('another-credential', pinned);
    await act(async () => { await expect(invoke()).rejects.toThrow(/saved wallet records/); });
    expect(result.current.sdk).toBe(sdk);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(sdk.disconnect).not.toHaveBeenCalled();
    expect(fixtures.connect).toHaveBeenCalledOnce();
    expect(fixtures.passkey).not.toHaveBeenCalled();
    expect(invalidatePasskey).not.toHaveBeenCalled();
    expect(pinActivePasskeyCredentialId).not.toHaveBeenCalled();
    expect(setPendingSwitchFromCredentialId).not.toHaveBeenCalled();
    expect(pinned).not.toHaveBeenCalled();
    expect(localStorage.getItem('passkeyActiveCredentialId')).toBe('original-credential');
    expect(localStorage.getItem('passkeyLabel')).toBe('original-label');
    expect(fixtures.deviceRecord).toBe('original device ciphertext');
    expect(fixtures.boundRecord).toBe('other retained bound ciphertext');
    // The failed switch must not revoke the retained connection's read binding.
    await expect(readWalletSeed({ interactive: true })).resolves.toEqual(SEED);
    expectRecordsPreserved();
  });

  it.each(['device', 'bound'] as const)('blocks onboarding over a newly discovered %s record before SDK connection', async tier => {
    const { result } = renderHook(() => useBreezSdk(vi.fn()));
    await waitFor(() => expect(result.current.startupState).toBe('no-wallet'));
    if (tier === 'device') fixtures.deviceRecord = 'retained device ciphertext';
    else fixtures.boundRecord = 'retained bound ciphertext';
    await act(async () => {
      await expect(result.current.connectWallet(SEED, false, 'new-label')).rejects.toThrow(/saved wallet records/);
    });
    expect(fixtures.connect).not.toHaveBeenCalled();
    expect(fixtures.passkey).not.toHaveBeenCalled();
    expect(localStorage.getItem('passkeyLabel')).toBeNull();
    expectRecordsPreserved();
  });
});
