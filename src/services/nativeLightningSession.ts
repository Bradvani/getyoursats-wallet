import {defaultExternalSignersFromSeed, defaultServerConfig, SdkBuilder, type BreezSdk, type LightningAddressInfo, type Seed} from '@breeztech/breez-sdk-spark';
import {sdkReady} from './sdkReady';
import {assertNativeLightningAddress, NATIVE_LIGHTNING_DOMAIN} from './nativeLightningAddress';
import {assertCurrentSession, getSpendingSessionEpoch, isSpendingSessionLocked, matchesSignerIdentity} from '../security/spendApproval';
import {guardExternalSigners} from '../security/guardedExternalSigners';
import {createBrowserSdkLifetime, waitForBrowserSdkShutdowns} from '../security/browserSdkLifetime';

export {assertNativeLightningAddress, NATIVE_LIGHTNING_DOMAIN} from './nativeLightningAddress';
export type NativeLightningCapabilities = Pick<BreezSdk, 'checkLightningAddressAvailable' | 'registerLightningAddress'>;

async function clearTemporaryStorage(directory: string): Promise<void> {
  const databases = await indexedDB.databases();
  await Promise.all(databases.flatMap(database => {
    if (!database.name?.startsWith(`${directory}/`)) return [];
    return [new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(database.name!);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    })];
  }));
}

// The pinned SDK caches one address across domains. A fresh server-mode
// session has no cached address and no concurrent background recovery, so
// getLightningAddress must finish the signed provider lookup before use.
export async function withNativeLightningSession<T>(options: {
  seed: Seed;
  apiKey: string;
  expectedIdentityPubkey: string;
  ensureActive?: () => void;
  use: (session: {sdk: NativeLightningCapabilities; identityPubkey: string; address: LightningAddressInfo | null}) => Promise<T>;
}): Promise<T> {
  const epoch = getSpendingSessionEpoch();
  let closed = false;
  const ensureActive = () => {
    assertCurrentSession(epoch);
    if (closed || isSpendingSessionLocked()) throw new Error('Wallet session is locked or closed');
    options.ensureActive?.();
  };
  ensureActive();
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    throw new Error('This browser cannot set up a Lightning name. Please try an updated browser.');
  }
  await sdkReady();
  await waitForBrowserSdkShutdowns();
  if (!await matchesSignerIdentity(options.seed)) throw new Error('The selected passkey belongs to a different wallet. Please use this wallet’s passkey.');
  ensureActive();
  const directory = `getyoursats-lnurl-session-${crypto.randomUUID()}`;
  const config = defaultServerConfig('mainnet');
  config.apiKey = options.apiKey;
  config.lnurlDomain = NATIVE_LIGHTNING_DOMAIN;
  config.backgroundTasksEnabled = false;
  config.realTimeSyncServerUrl = undefined;
  config.crossChainConfig = undefined;
  config.stableBalanceConfig = undefined;
  config.leafOptimizationConfig = {...config.leafOptimizationConfig, autoEnabled: false};
  config.tokenOptimizationConfig = {...config.tokenOptimizationConfig, autoEnabled: false};
  const signers = guardExternalSigners(defaultExternalSignersFromSeed(options.seed, 'mainnet', undefined));
  const lifetime = createBrowserSdkLifetime(signers);
  try {
    const builder = SdkBuilder.newWithSigner(config, signers.breezSigner, signers.sparkSigner)
      .withPaymentObserver({beforeSend: async () => {throw new Error('Lightning name sessions cannot send payments');}, afterSend: async () => {}});
    const sdk = await lifetime.attach(await (await builder.withDefaultStorage(directory)).build());
    ensureActive();
    const proof = await sdk.signMessage({message: 'gys-native-lnurl-session-v1', compact: true});
    ensureActive();
    if (!/^(02|03)[a-f0-9]{64}$/i.test(proof.pubkey)
      || proof.pubkey.toLowerCase() !== options.expectedIdentityPubkey.toLowerCase()) {
      throw new Error('The selected passkey belongs to a different wallet. Please use this wallet’s passkey.');
    }
    const address = await sdk.getLightningAddress() ?? null;
    ensureActive();
    if (address) assertNativeLightningAddress(address);
    const capabilities: NativeLightningCapabilities = Object.freeze(Object.assign(Object.create(null), {
      checkLightningAddressAvailable: async (request: Parameters<BreezSdk['checkLightningAddressAvailable']>[0]) => {
        ensureActive();
        const result = await sdk.checkLightningAddressAvailable(structuredClone(request));
        ensureActive();
        return result;
      },
      registerLightningAddress: async (request: Parameters<BreezSdk['registerLightningAddress']>[0]) => {
        ensureActive();
        const result = await sdk.registerLightningAddress(structuredClone(request));
        ensureActive();
        assertNativeLightningAddress(result);
        return result;
      },
    }));
    return await options.use({sdk: capabilities, identityPubkey: proof.pubkey, address});
  } finally {
    closed = true;
    await lifetime.stop();
    try {await clearTemporaryStorage(directory);} catch { /* Only this random session's databases are eligible for cleanup. */ }
  }
}
