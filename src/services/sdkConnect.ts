import {prepareOwnedWalletStorage} from '../security/storageMigration/ownedStorage';
import {hex} from '../security/storageMigration/database';
import {isConfiguredSdkKey} from '../getyoursats/walletReadiness';
import {
  Config,
  Network,
  SdkBuilder,
  SparkConfig,
  connect,
  defaultConfig,
  defaultExternalSignersFromSeed,
  type BreezSdk,
  type Seed,
} from '@breeztech/breez-sdk-spark';
import { getSettings } from './settings';
import {createOperationGateway} from '../security/operationGateway';
import {rememberSignerIdentity,assertCurrentSession,getSpendingSessionEpoch} from '../security/spendApproval';
import {createBrowserSdkLifetime,registerBrowserSdkLifetime,waitForBrowserSdkShutdowns,SdkLifecycleError} from '../security/browserSdkLifetime';
import {guardExternalSigners} from '../security/guardedExternalSigners';
import {Capacitor} from '@capacitor/core';
import { logger, LogCategory } from './logger';
import { formatError } from '../utils/formatError';
import { USDB_TOKEN_IDENTIFIER, USDB_TICKER } from '../constants/stableBalance';
import {assertNoUnfencedPopulatedLegacyStorage} from './emptyLegacyFence';

function localCluster(): SparkConfig | null {
  const raw = import.meta.env.VITE_SPARK_LOCAL_CONFIG;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SparkConfig;
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Ignoring unparseable local cluster config', {
      error: formatError(e),
    });
    return null;
  }
}

/**
 * Points the config at a locally-run cluster when one is configured, and
 * reports whether it took over. A local cluster runs no Breez services, so the
 * hosted endpoints have to be cleared or connect fails reaching them. Leaf
 * optimization is turned off so leaves are not split or merged behind a test's
 * back.
 */
function applyLocalCluster(config: Config, network: Network): boolean {
  const cluster = network === 'regtest' ? localCluster() : null;
  if (!cluster) return false;
  config.sparkConfig = cluster;
  config.apiKey = undefined;
  config.lnurlDomain = undefined;
  config.realTimeSyncServerUrl = undefined;
  config.leafOptimizationConfig.autoEnabled = false;
  return true;
}

/** The network this session connects on. Settings switches it by reloading with
 *  the parameter set, so the URL is what the SDK is connected to. */
export function selectedNetwork(): Network {
  return (new URLSearchParams(window.location.search).get('network') ?? 'mainnet') as Network;
}

/**
 * Build a Breez SDK Config from environment and persisted user settings.
 * Pure function — no side effects beyond reading env vars and localStorage.
 */
export function buildConnectConfig(overrideNetwork?: Network): Config {
  const network = overrideNetwork ?? selectedNetwork();
  const config: Config = defaultConfig(network);
  const configuredKey = import.meta.env.VITE_BREEZ_API_KEY?.trim();
  config.apiKey = configuredKey;

  // Reject tutorial/example placeholders. This value is shipped to every
  // browser in Vite bundles, so use only a provider-approved client SDK key.
  const keyUnconfigured = !isConfiguredSdkKey(configuredKey);

  if (!applyLocalCluster(config, network) && keyUnconfigured) {
    throw new Error('Breez wallet connectivity is not configured. Set a valid provider-approved VITE_BREEZ_API_KEY in the deployment settings.');
  }

  // The stable balance token and cross-chain sends are mainnet-only: the SDK
  // rejects either config on any other network at connect time, which aborts
  // the whole connection.
  if (network === 'mainnet') {
    config.stableBalanceConfig = {
      tokens: [{ label: USDB_TICKER, tokenIdentifier: USDB_TOKEN_IDENTIFIER }],
    };
    config.crossChainConfig = {};
  }

  try {
    const s = getSettings();
    if (s.depositMaxFee) {
      config.maxDepositClaimFee = { onchain: s.depositMaxFee };
    }
    if (s.syncIntervalSecs != null) {
      config.syncIntervalSecs = s.syncIntervalSecs;
    }
    if (s.preferSparkOverLightning != null) {
      config.preferSparkOverLightning = s.preferSparkOverLightning;
    }
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to apply user settings to config', {
      error: formatError(e),
    });
  }

  // Branded addresses use isolated server-mode sessions with this identity.
  // Keep the payment SDK on its default domain so existing anonymous
  // addresses and wallet storage remain independent of the optional feature.
  return config;
}

function snapshotConnectionSeed(seed: Seed): Seed {
  if (seed?.type === 'mnemonic' && typeof seed.mnemonic === 'string'
    && (seed.passphrase == null || typeof seed.passphrase === 'string')) {
    return Object.freeze({type:'mnemonic', mnemonic:seed.mnemonic, passphrase:seed.passphrase});
  }
  if (seed?.type === 'entropy' && Array.isArray(seed)) {
    const bytes = Array.from(seed);
    if (bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
      return Object.freeze(Object.assign(bytes, {type:'entropy' as const})) as Seed;
    }
  }
  throw new Error('Wallet seed is invalid');
}

/**
 * Connects a wallet. A config built for a local cluster is pointed at that
 * cluster's own indexer, since the hosted one knows nothing about its chain.
 */
export async function connectSdk(params: {
  config: Config;
  seed: Seed;
  storageDir: string;
}): Promise<BreezSdk> {
  const { storageDir } = params;
  // Preserve the entry seed and network across all connection awaits. This is
  // a representation-preserving copy, not seed conversion or key derivation.
  const seed = snapshotConnectionSeed(params.seed);
  const config = {...params.config};
  const isNative = Capacitor.isNativePlatform();
  if (!isNative) {
    const epoch = getSpendingSessionEpoch();
    await assertNoUnfencedPopulatedLegacyStorage(storageDir, config.network,()=>assertCurrentSession(epoch));
    assertCurrentSession(epoch);
  }
  await rememberSignerIdentity(seed);
  const chainApiUrl = import.meta.env.VITE_ESPLORA_BASE_URL;
  if (!isNative) {
    const epoch=getSpendingSessionEpoch();
    await waitForBrowserSdkShutdowns();
    assertCurrentSession(epoch);
    const gateway = createOperationGateway(config.network);
    // Preserve the literal Seed representation and SDK account default for
    // both imported phrases and existing passkey-derived raw BIP32 seeds.
    // Do not convert raw seed bytes into new BIP39 words or fall back to an
    // internal signer that cannot be revoked through this session boundary.
    const signers=guardExternalSigners(
      defaultExternalSignersFromSeed(seed,config.network,undefined),
    );
    const lifetime = createBrowserSdkLifetime(signers);
    // No autonomous stable-balance conversions until bounded mandates exist.
    const browserConfig = {...config, stableBalanceConfig:undefined, preferSparkOverLightning:false,
      backgroundTasksEnabled:false,realTimeSyncServerUrl:undefined,crossChainConfig:undefined,
      leafOptimizationConfig:{...config.leafOptimizationConfig,autoEnabled:false},
      tokenOptimizationConfig:{...config.tokenOptimizationConfig,autoEnabled:false},
    };
    try {
      const identityBytes=(await signers.sparkSigner.getIdentityPublicKey()).bytes;
      if(!Array.isArray(identityBytes)||identityBytes.length!==33
        ||![2,3].includes(identityBytes[0])||identityBytes.some(b=>!Number.isInteger(b)||b<0||b>255))
        throw new Error('Wallet signer did not provide a valid public storage identity');
      const identity=hex(Uint8Array.from(identityBytes));
      assertCurrentSession(epoch);
      const ownedDirectory=await prepareOwnedWalletStorage({root:storageDir,network:config.network,identity,
        assertCurrent:()=>assertCurrentSession(epoch)});
      assertCurrentSession(epoch);
      // Bind EVERY subsequent SDK identity read, not just the preflight read.
      const identityPinnedSigner=new Proxy(signers.sparkSigner,{
        get:(target,key)=>key==='getIdentityPublicKey'?async()=>{
          const result=await target.getIdentityPublicKey();
          if(!Array.isArray(result.bytes)||result.bytes.length!==33
            ||result.bytes.some(b=>!Number.isInteger(b)||b<0||b>255)
            ||hex(Uint8Array.from(result.bytes))!==identity)
            throw new Error('Wallet signer identity changed after storage was selected');
          return {bytes:[...result.bytes]};
        }:Reflect.get(target,key),
      });
      let builder = SdkBuilder.newWithSigner(browserConfig,signers.breezSigner,identityPinnedSigner)
        .withPaymentObserver(gateway.observer);
      if (chainApiUrl && config.apiKey == null && config.sparkConfig)
        builder = builder.withRestChainService(chainApiUrl, 'esplora');
      const raw=await (await builder.withDefaultStorage(ownedDirectory)).build();
      const attached=await lifetime.attach(raw);
      // Readiness must establish that storage, signer and the built SDK all
      // refer to the same wallet. Consistency between two cached SDK reads
      // alone cannot establish this binding. This read never requests sync.
      const builtInfo=await attached.getInfo({ensureSynced:false});
      assertCurrentSession(epoch);
      if(typeof builtInfo?.identityPubkey!=='string'
        ||builtInfo.identityPubkey.toLowerCase()!==identity)
        throw new Error('Restored wallet identity does not match its signing and storage identity. Your saved records have been preserved.');
      const wallet=gateway.protect(attached);
      registerBrowserSdkLifetime(wallet,lifetime);
      return wallet;
    }catch(error){
      try{await lifetime.stop();}catch(cleanupError){
        throw new SdkLifecycleError('SDK connection failed and cleanup did not complete',{cause:error,additionalErrors:[cleanupError]});
      }
      throw error;
    }
  }
  if (chainApiUrl && config.apiKey == null && config.sparkConfig) {
    const builder = SdkBuilder.new(config, seed).withRestChainService(chainApiUrl, 'esplora');
    return (await builder.withDefaultStorage(storageDir)).build();
  }
  return connect({config,seed,storageDir});
}
