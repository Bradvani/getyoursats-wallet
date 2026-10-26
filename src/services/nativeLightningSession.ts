import {connect, defaultServerConfig, type BreezSdk, type LightningAddressInfo, type Seed} from '@breeztech/breez-sdk-spark';
import {sdkReady} from './sdkReady';
import {assertNativeLightningAddress, NATIVE_LIGHTNING_DOMAIN} from './nativeLightningAddress';

export {assertNativeLightningAddress, NATIVE_LIGHTNING_DOMAIN} from './nativeLightningAddress';

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
  use: (session: {sdk: BreezSdk; identityPubkey: string; address: LightningAddressInfo | null}) => Promise<T>;
}): Promise<T> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    throw new Error('This browser cannot set up a Lightning name. Please try an updated browser.');
  }
  await sdkReady();
  options.ensureActive?.();
  const directory = `getyoursats-lnurl-session-${crypto.randomUUID()}`;
  const config = defaultServerConfig('mainnet');
  config.apiKey = options.apiKey;
  config.lnurlDomain = NATIVE_LIGHTNING_DOMAIN;
  let sdk: BreezSdk | undefined;
  try {
    sdk = await connect({config, seed: options.seed, storageDir: directory});
    options.ensureActive?.();
    const proof = await sdk.signMessage({message: 'gys-native-lnurl-session-v1', compact: true});
    options.ensureActive?.();
    if (!/^(02|03)[a-f0-9]{64}$/i.test(proof.pubkey)
      || proof.pubkey.toLowerCase() !== options.expectedIdentityPubkey.toLowerCase()) {
      throw new Error('The selected passkey belongs to a different wallet. Please use this wallet’s passkey.');
    }
    const address = await sdk.getLightningAddress() ?? null;
    options.ensureActive?.();
    if (address) assertNativeLightningAddress(address);
    return await options.use({sdk, identityPubkey: proof.pubkey, address});
  } finally {
    if (sdk) {
      try {await sdk.disconnect();} catch { /* Cleanup must not hide a confirmed registration. */ }
      try {sdk.free();} catch { /* The temporary signer must not outlive its completed operation. */ }
    }
    try {await clearTemporaryStorage(directory);} catch { /* Only this random session's databases are eligible for cleanup. */ }
  }
}
