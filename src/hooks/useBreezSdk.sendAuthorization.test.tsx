import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {BreezSdk, Seed} from '@breeztech/breez-sdk-spark';
import {useBreezSdk} from './useBreezSdk';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(), guard: vi.fn(), cancel: vi.fn(), passkeyMode: vi.fn(), label: vi.fn(), rpId: vi.fn(),
  credential: vi.fn(), migrationCredential: vi.fn(), derive: vi.fn(), setMode: vi.fn(),
  native: vi.fn(), deviceSupported: vi.fn(), secureSupported: vi.fn(),
  deviceStore: vi.fn(), secureStore: vi.fn(), savedMnemonic: vi.fn(),
  saveMnemonic: vi.fn(), clearMnemonic: vi.fn(), revokePush: vi.fn(),
}));

vi.mock('@breeztech/breez-sdk-spark', () => ({initLogging: vi.fn()}));
vi.mock('@capacitor/core', () => ({Capacitor: {isNativePlatform: mocks.native}}));
vi.mock('@capacitor/app', () => ({App: {addListener: vi.fn(async () => ({remove: vi.fn()}))}}));
vi.mock('@/services/sdkReady', () => ({sdkReady: vi.fn(async () => {})}));
vi.mock('../main', () => ({hideSplash: vi.fn(async () => {})}));
vi.mock('../services/sdkConnect', () => ({
  connectSdk: mocks.connect,
  buildConnectConfig: vi.fn(() => ({network: 'mainnet', apiKey: 'public-test-key'})),
}));
vi.mock('../services/sendAuthorization', () => ({withPasskeySendAuthorization: mocks.guard, cancelSendAuthorization: mocks.cancel}));
vi.mock('../services/logger', () => ({
  LogCategory: {}, logSdkMessage: vi.fn(),
  logger: {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), clear: vi.fn(),
    sdkInitialized: vi.fn(), authSuccess: vi.fn(), authFailure: vi.fn(),
    initSession: vi.fn(async () => {}), endSession: vi.fn(async () => {}),
    time: vi.fn((_label: string, task: () => Promise<unknown>) => task()),
  },
}));
vi.mock('../services/passkeyService', () => ({
  prfAvailability: vi.fn(async () => true), isPasskeyMode: mocks.passkeyMode,
  getPasskeyLabel: mocks.label, getPasskeyRpId: mocks.rpId,
  getActivePasskeyCredentialIdBytes: mocks.credential,
  getMigrationSharedCredentialIdBytes: mocks.migrationCredential,
  setPasskeyMode: mocks.setMode, clearPasskeyMode: vi.fn(), clearKnownCredentials: vi.fn(async () => {}),
  getKnownCredentialIdsBase64: vi.fn(async () => []), hasPasskeyHistory: vi.fn(() => false),
  markLabelUsed: vi.fn(), invalidatePasskey: vi.fn(), pinActivePasskeyCredentialId: vi.fn(),
  signInPinnedToActiveCredential: mocks.derive, setPendingSwitchFromCredentialId: vi.fn(),
  setPasskeyRpId: vi.fn(), isMigrationInProgress: vi.fn(() => false), isPasskeyMigrated: vi.fn(() => false),
}));
vi.mock('../services/passkeyPrfProvider', () => ({
  LEGACY_RP_ID: 'wallet.getyoursats.com', SHARED_RP_ID: 'getyoursats.com', rpId: 'getyoursats.com',
}));
vi.mock('../services/secureStorage', () => ({
  SecureStorageError: class extends Error {}, resetSecureStorageInit: vi.fn(),
  secureStorage: {
    isSupported: mocks.secureSupported, hasStoredSeed: vi.fn(async () => false),
    storeSeed: mocks.secureStore, retrieveSeed: vi.fn(), clearSeed: vi.fn(async () => {}),
  },
  deviceOnlyStorage: {
    isSupported: mocks.deviceSupported, hasStoredSeed: vi.fn(async () => false),
    storeSeed: mocks.deviceStore, retrieveSeed: vi.fn(), clearSeed: vi.fn(async () => {}),
  },
}));
vi.mock('../services/legacyMnemonicMigration', () => ({
  saveMnemonic: mocks.saveMnemonic, clearMnemonic: mocks.clearMnemonic,
  getSavedMnemonic: mocks.savedMnemonic, migrateLegacyMnemonicIfNeeded: vi.fn(async () => {}),
}));
vi.mock('../services/settings', () => ({
  setCachedStableTicker: vi.fn(), clearNetworkOverride: vi.fn(), clearStableRestorePrompted: vi.fn(),
  ensureSparkPrivateMode: vi.fn(async () => {}),
}));
vi.mock('../services/accountDeletion', () => ({wipeAllLocalData: vi.fn(async () => {})}));
vi.mock('../services/pushLifecycle', () => ({revokeBrowserPushOnLogout: mocks.revokePush}));
vi.mock('../services/appLock', () => ({clearPin: vi.fn(), isAppLockSupported: vi.fn(() => false)}));
vi.mock('../contexts/WalletContext', () => ({hasConversionInFlight: vi.fn(() => false)}));
vi.mock('../getyoursats/featureAvailability', () => ({featureAvailability: {nativeLightningAddress: false}}));
vi.mock('../services/nativeLightningSession', () => ({assertNativeLightningAddress: vi.fn(), withNativeLightningSession: vi.fn()}));

const seed: Seed = {type: 'mnemonic', mnemonic: 'test wallet identity, never funded'};
const nextSeed: Seed = {type: 'mnemonic', mnemonic: 'another test wallet identity, never funded'};
type GuardPolicy = {
  seed: Seed; label: string; rpId: string; credentialId?: Uint8Array | null; isActive: () => boolean;
};
function client(): BreezSdk {
  return {
    getInfo: vi.fn(async () => ({identityPubkey: 'test-identity'})),
    listPayments: vi.fn(async () => ({payments: []})),
    listUnclaimedDeposits: vi.fn(async () => ({deposits: []})),
    disconnect: vi.fn(async () => {}),
    addEventListener: vi.fn(async () => 'listener'), removeEventListener: vi.fn(async () => {}),
  } as unknown as BreezSdk;
}
async function mount() {
  const hook = renderHook(() => useBreezSdk(vi.fn()));
  await waitFor(() => expect(hook.result.current.startupState).toBe('no-wallet'));
  return hook;
}
function policy(index = 0): GuardPolicy { return mocks.guard.mock.calls[index][1] as GuardPolicy; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

beforeEach(() => {
  mocks.connect.mockReset().mockImplementation(async () => client());
  mocks.guard.mockReset().mockImplementation(async (sdk: BreezSdk) => new Proxy(sdk, {}));
  mocks.passkeyMode.mockReset().mockReturnValue(false);
  mocks.label.mockReset().mockReturnValue('Personal');
  mocks.rpId.mockReset().mockReturnValue('wallet.getyoursats.com');
  mocks.credential.mockReset().mockReturnValue(new Uint8Array([1, 2, 3]));
  mocks.migrationCredential.mockReset().mockReturnValue(new Uint8Array([4, 5, 6]));
  mocks.derive.mockReset();
  mocks.native.mockReset().mockReturnValue(false);
  mocks.deviceSupported.mockReset().mockReturnValue(false);
  mocks.secureSupported.mockReset().mockReturnValue(false);
  mocks.savedMnemonic.mockReset().mockReturnValue(null);
  mocks.revokePush.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('send authorization at wallet connection boundaries', () => {
  it('publishes the guarded client and exact passkey identity on initial connection', async () => {
    const {result} = await mount();
    await act(async () => { await result.current.connectWallet(seed, false, 'Personal'); });
    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(policy()).toMatchObject({seed, label: 'Personal', rpId: 'wallet.getyoursats.com', credentialId: new Uint8Array([1, 2, 3])});
    expect(policy().isActive()).toBe(true);
    expect(result.current.sdk).toBe(await mocks.guard.mock.results[0].value);
    expect(result.current.sdk).not.toBe(await mocks.connect.mock.results[0].value);
    expect(mocks.saveMnemonic).not.toHaveBeenCalled();
  });

  it('does not attach another wallet passkey to a phrase restore even with stale passkey metadata', async () => {
    const {result} = await mount();
    mocks.passkeyMode.mockReturnValue(true);
    await act(async () => { await result.current.connectWallet(seed, true); });
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.saveMnemonic).toHaveBeenCalledWith(seed.mnemonic);
  });

  it.each([true, false])('preserves native vault reconnect storage for passkey mode %s', async (passkeyMode) => {
    const {result} = await mount();
    mocks.native.mockReturnValue(true);
    mocks.deviceSupported.mockReturnValue(true);
    mocks.passkeyMode.mockReturnValue(passkeyMode);
    await act(async () => { await result.current.connectWallet(seed, false, undefined, 'secureStorage'); });
    expect(mocks.guard).toHaveBeenCalledTimes(passkeyMode ? 1 : 0);
    if (passkeyMode) expect(policy()).toMatchObject({seed, label: 'Personal', rpId: 'wallet.getyoursats.com'});
    expect(mocks.deviceStore).not.toHaveBeenCalled();
    expect(mocks.secureStore).not.toHaveBeenCalled();
    expect(mocks.saveMnemonic).not.toHaveBeenCalled();
  });

  it('rebinds authorization to a newly selected label and revokes the previous session', async () => {
    const {result} = await mount();
    await act(async () => { await result.current.connectWallet(seed, false, 'Personal'); });
    mocks.derive.mockResolvedValue({wallet: {seed: nextSeed, label: 'Savings'}});
    await act(async () => { await result.current.switchPasskeyLabel('Savings'); });
    expect(policy(1)).toMatchObject({seed: nextSeed, label: 'Savings', rpId: 'wallet.getyoursats.com'});
    expect(policy(0).isActive()).toBe(false);
    expect(policy(1).isActive()).toBe(true);
  });

  it('pins authorization to the explicitly selected RP when reconnecting', async () => {
    const {result} = await mount();
    await act(async () => { await result.current.connectWallet(seed, false, 'Personal'); });
    mocks.derive.mockResolvedValue({wallet: {seed: nextSeed, label: 'Personal'}});
    await act(async () => { await result.current.switchPasskeyRp('getyoursats.com'); });
    expect(policy(1)).toMatchObject({seed: nextSeed, label: 'Personal', rpId: 'getyoursats.com'});
    expect(mocks.credential).toHaveBeenLastCalledWith('getyoursats.com');
    expect(policy(0).isActive()).toBe(false);
    expect(policy(1).isActive()).toBe(true);
  });

  it('disconnects an initial SDK if its passkey send guard cannot be created', async () => {
    const {result} = await mount();
    const raw = client();
    mocks.connect.mockResolvedValueOnce(raw);
    mocks.guard.mockRejectedValueOnce(new Error('Authorization unavailable'));
    await act(async () => {
      await expect(result.current.connectWallet(seed, false, 'Personal')).rejects.toThrow('Authorization unavailable');
    });
    expect(raw.disconnect).toHaveBeenCalledOnce();
    expect(result.current.sdk).toBeNull();
    expect(result.current.isConnected).toBe(false);
    expect(mocks.saveMnemonic).not.toHaveBeenCalled();
    expect(mocks.deviceStore).not.toHaveBeenCalled();
  });

  it('keeps the current wallet send policy usable when a label switch is cancelled', async () => {
    const {result} = await mount();
    await act(async () => { await result.current.connectWallet(seed, false, 'Personal'); });
    const original = result.current.sdk;
    mocks.derive.mockRejectedValue(new DOMException('Cancelled', 'NotAllowedError'));
    await act(async () => { await expect(result.current.switchPasskeyLabel('Savings')).rejects.toThrow('Cancelled'); });
    expect(result.current.sdk).toBe(original);
    expect(original!.disconnect).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledWith(original);
    expect(policy(0).isActive()).toBe(true);
  });

  it('binds migration adoption to the derived shared-RP seed and migration credential', async () => {
    const {result} = await mount();
    const migrated = client();
    await act(async () => { await result.current.adoptMigratedSdk(migrated, 'Personal', nextSeed); });
    expect(policy()).toMatchObject({seed: nextSeed, label: 'Personal', rpId: 'getyoursats.com', credentialId: new Uint8Array([4, 5, 6])});
    expect(result.current.sdk).toBe(await mocks.guard.mock.results[0].value);
    expect(mocks.setMode).toHaveBeenCalledWith('Personal', 'getyoursats.com');
  });

  it('retains the old session if migration authorization setup fails before handoff', async () => {
    const {result} = await mount();
    await act(async () => { await result.current.connectWallet(seed, false, 'Personal'); });
    const original = result.current.sdk;
    mocks.guard.mockRejectedValueOnce(new Error('Digest unavailable'));
    await act(async () => { await expect(result.current.adoptMigratedSdk(client(), 'Personal', nextSeed)).rejects.toThrow('Digest unavailable'); });
    expect(result.current.sdk).toBe(original);
    expect(original!.disconnect).not.toHaveBeenCalled();
    expect(policy(0).isActive()).toBe(true);
  });

  it('does not publish a late passkey connection after logout', async () => {
    const {result} = await mount();
    const pendingGuard = deferred<BreezSdk>();
    mocks.guard.mockImplementationOnce(() => pendingGuard.promise);
    let outcome!: Promise<string>;
    await act(async () => {
      outcome = result.current.connectWallet(seed, false, 'Personal').then(() => 'connected', () => 'refused');
    });
    await waitFor(() => expect(mocks.guard).toHaveBeenCalledOnce());
    await act(async () => { await result.current.handleLogout(); });
    await act(async () => { pendingGuard.resolve(client()); await outcome; });
    expect(await outcome).toBe('refused');
    expect(result.current.sdk).toBeNull();
    expect(result.current.isConnected).toBe(false);
  });

  it('revokes send approval as logout starts even while push cleanup is pending', async () => {
    const {result} = await mount();
    await act(async () => { await result.current.connectWallet(seed, false, 'Personal'); });
    const original = result.current.sdk;
    const cleanup = deferred<void>();
    mocks.revokePush.mockImplementationOnce(() => cleanup.promise);
    let logout!: Promise<void>;
    await act(async () => { logout = result.current.handleLogout(); });
    expect(policy().isActive()).toBe(false);
    expect(mocks.cancel).toHaveBeenCalledWith(original);
    await act(async () => { cleanup.resolve(); await logout; });
  });

  it('does not complete migration handoff after logout during legacy disconnect', async () => {
    const {result} = await mount();
    await act(async () => { await result.current.connectWallet(seed, false, 'Personal'); });
    const original = result.current.sdk!;
    const disconnect = deferred<void>();
    vi.mocked(original.disconnect).mockImplementationOnce(() => disconnect.promise);
    let outcome!: Promise<string>;
    await act(async () => {
      outcome = result.current.adoptMigratedSdk(client(), 'Personal', nextSeed).then(() => 'adopted', () => 'refused');
    });
    await waitFor(() => expect(original.disconnect).toHaveBeenCalledOnce());
    await act(async () => { await result.current.handleLogout(); });
    await act(async () => { disconnect.resolve(); await outcome; });
    expect(await outcome).toBe('refused');
    expect(result.current.sdk).toBeNull();
    expect(result.current.isConnected).toBe(false);
  });
});
