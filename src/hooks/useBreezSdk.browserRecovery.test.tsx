import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { useBreezSdk } from './useBreezSdk';
import { SecureStorageError } from '../services/secureStorage';
import { resetNativeSeedSelection } from '../services/nativeSeedSelection';
import { confirmNativePinPolicy, getNativePinPolicyRevision, invalidateNativePinPolicy } from '../services/nativeReadLease';
import { clearSignerIdentity, rememberSignerIdentity, lockSpendingSession } from '../security/spendApproval';

const fixtures = vi.hoisted(() => ({
  boundRecord: null as string | null,
  deviceRecord: null as string | null,
  device: { isSupported: vi.fn(), hasStoredSeed: vi.fn(), retrieveSeed: vi.fn(), clearSeed: vi.fn(), storeSeed: vi.fn() },
  bound: { isSupported: vi.fn(), hasStoredSeed: vi.fn(), retrieveSeed: vi.fn(), clearSeed: vi.fn() },
  connect: vi.fn(), ready: vi.fn(), factory: vi.fn(), passkey: vi.fn(), passkeyMode: vi.fn(),
  getMnemonic: vi.fn(), clearMnemonic: vi.fn(), wipe: vi.fn(), clearPin: vi.fn(),
  addListener: vi.fn(), hideSplash: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
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

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  invalidateNativePinPolicy();
  confirmNativePinPolicy(false, getNativePinPolicyRevision());
  resetNativeSeedSelection();
  clearSignerIdentity();
  fixtures.boundRecord = null;
  fixtures.deviceRecord = null;
  localStorage.clear();
  localStorage.setItem('gys:wallet-vault:v1','original encrypted fixture');
  fixtures.device.isSupported.mockReset().mockReturnValue(false);
  fixtures.bound.isSupported.mockReset().mockReturnValue(false);
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


function fakeWallet(){
 return {getInfo:vi.fn(async()=>({identityPubkey:IDENTITY,balanceSats:1000,recoverableFundsSats:0,tokenBalances:new Map()})),
 listPayments:vi.fn(async()=>({payments:[]})),listUnclaimedDeposits:vi.fn(async()=>({deposits:[]})),
 addEventListener:vi.fn(async()=> 'listener'),removeEventListener:vi.fn(async()=>true),disconnect:vi.fn(async()=>{}),free:vi.fn()};
}
async function hookWith(wallet:ReturnType<typeof fakeWallet>){
 fixtures.connect.mockImplementation(async()=>{await rememberSignerIdentity(SEED);return wallet as unknown as BreezSdk;});
 const hook=renderHook(()=>useBreezSdk(vi.fn()));
 await waitFor(()=>expect(hook.result.current.startupState).toBe('web-vault-locked'));
 return hook;
}
describe('integrated browser recovery data readiness',()=>{
 it('rejects an overlapping connection without publishing the first client prematurely',async()=>{
  const wallet=fakeWallet();let finish!:()=>void;
  wallet.listPayments.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({payments:[]});}));
  const {result}=await hookWith(wallet);
  await act(async()=>{
   const first=result.current.connectWallet(SEED,true,undefined,'secureStorage');
   const accepted=expect(first).resolves.toBe(wallet);
   await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
   expect(result.current.sdk).toBeNull();expect(result.current.isConnected).toBe(false);
   await expect(result.current.connectWallet(SEED,true,undefined,'secureStorage')).rejects.toThrow(/already in progress/);
   finish();await accepted;
  });
  expect(fixtures.connect).toHaveBeenCalledTimes(1);expect(result.current.isConnected).toBe(true);
 });
 it('rejects a locked session during initial reads and retains the encrypted wallet',async()=>{
  const wallet=fakeWallet();wallet.listPayments.mockImplementationOnce(async()=>{lockSpendingSession('Synthetic lock during history read');return {payments:[]};});
  const {result}=await hookWith(wallet);
  await act(async()=>{await expect(result.current.connectWallet(SEED,true,undefined,'secureStorage')).rejects.toThrow(/session/);});
  expect(result.current.isConnected).toBe(false);expect(result.current.sdk).toBeNull();
  expect(wallet.disconnect).toHaveBeenCalled();expect(localStorage.getItem('gys:wallet-vault:v1')).toBe('original encrypted fixture');
 });
 it('permits an explicit reconnect after a failed readiness read instead of leaving the connection latch stuck',async()=>{
  const wallet=fakeWallet();wallet.listPayments.mockRejectedValueOnce(new Error('Synthetic first read failure'));
  const {result}=await hookWith(wallet);
  await act(async()=>{await expect(result.current.connectWallet(SEED,true,undefined,'secureStorage')).rejects.toThrow();});
  await act(async()=>{await expect(result.current.connectWallet(SEED,true,undefined,'secureStorage')).resolves.toBe(wallet);});
  expect(result.current.isConnected).toBe(true);expect(fixtures.connect).toHaveBeenCalledTimes(2);
 });

 it.each(['getInfo','listPayments','listUnclaimedDeposits'] as const)('does not declare restoration successful after %s fails',async method=>{
  const wallet=fakeWallet();wallet[method].mockRejectedValue(new Error('Injected read failure'));
  const {result}=await hookWith(wallet);
  await act(async()=>{await expect(result.current.connectWallet(SEED,true,undefined,'secureStorage')).rejects.toThrow();});
  expect(result.current.isConnected).toBe(false);expect(result.current.startupState).not.toBe('connected');
  expect(result.current.sdk).toBeNull();expect(wallet.disconnect).toHaveBeenCalled();
  expect(localStorage.getItem('gys:wallet-vault:v1')).toBe('original encrypted fixture');
  expect(fixtures.wipe).not.toHaveBeenCalled();
 });
 it('rejects changed public identity between readiness reads',async()=>{
  const wallet=fakeWallet();wallet.getInfo.mockResolvedValueOnce({identityPubkey:IDENTITY,balanceSats:1000,recoverableFundsSats:0,tokenBalances:new Map()});
  wallet.getInfo.mockResolvedValue({identityPubkey:`03${'22'.repeat(32)}`,balanceSats:1000,recoverableFundsSats:0,tokenBalances:new Map()});
  const {result}=await hookWith(wallet);
  await act(async()=>{await expect(result.current.connectWallet(SEED,true,undefined,'secureStorage')).rejects.toThrow();});
  expect(result.current.isConnected).toBe(false);expect(wallet.disconnect).toHaveBeenCalled();
 });
 it('preserves damaged pending-operation records instead of publishing an apparently recovered wallet',async()=>{
  localStorage.setItem('gys:payment-journal:v1:damaged','original damaged record');
  const wallet=fakeWallet(),{result}=await hookWith(wallet);
  await act(async()=>{await expect(result.current.connectWallet(SEED,true,undefined,'secureStorage')).rejects.toThrow();});
  expect(result.current.isConnected).toBe(false);
  expect(localStorage.getItem('gys:payment-journal:v1:damaged')).toBe('original damaged record');
 });
 it('publishes readable local balance/history without claiming operator settlement',async()=>{
  const wallet=fakeWallet(),{result}=await hookWith(wallet);
  await act(async()=>{await result.current.connectWallet(SEED,true,undefined,'secureStorage');});
  expect(result.current.isConnected).toBe(true);expect(result.current.walletInfo?.balanceSats).toBe(1000);
  expect(wallet.getInfo).toHaveBeenCalledWith({ensureSynced:false});
  expect(localStorage.getItem('gys:wallet-vault:v1')).toBe('original encrypted fixture');
 });
});
