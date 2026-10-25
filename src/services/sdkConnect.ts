import {isConfiguredSdkKey} from '../getyoursats/walletReadiness';
import {
  Config,
  Network,
  SdkBuilder,
  SparkConfig,
  connect,
  defaultConfig,
  defaultExternalSigners,
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

  // Identity-linked GetYourSats usernames cannot be claimed safely
  // until the email verification and username entitlement backend exists.
  // Keep the default Breez domain even if a premature Vercel env variable
  // was set. Re-enable only after that integration is completed and tested.
  return config;
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
  const { config, seed, storageDir } = params;
  await rememberSignerIdentity(seed);
  const chainApiUrl = import.meta.env.VITE_ESPLORA_BASE_URL;
  if (!Capacitor.isNativePlatform()) {
    const epoch=getSpendingSessionEpoch();
    await waitForBrowserSdkShutdowns();
    assertCurrentSession(epoch);
    const gateway = createOperationGateway(config.network);
    // The SDK's mnemonic factory keeps the same phrase, passphrase and account.
    // Entropy/passkey wallets need an SDK seed-based external-signer factory;
    // never derive a replacement mnemonic as an application workaround.
    const signers=seed.type==='mnemonic'
      ? guardExternalSigners(defaultExternalSigners(seed.mnemonic,seed.passphrase,config.network,undefined))
      : undefined;
    const lifetime = createBrowserSdkLifetime(signers);
    // No autonomous stable-balance conversions until bounded mandates exist.
    const browserConfig = {...config, stableBalanceConfig:undefined, preferSparkOverLightning:false,
      backgroundTasksEnabled:false,realTimeSyncServerUrl:undefined,crossChainConfig:undefined,
      leafOptimizationConfig:{...config.leafOptimizationConfig,autoEnabled:false},
      tokenOptimizationConfig:{...config.tokenOptimizationConfig,autoEnabled:false},
    };
    try {
      let builder = (signers
        ? SdkBuilder.newWithSigner(browserConfig,signers.breezSigner,signers.sparkSigner)
        : SdkBuilder.new(browserConfig, seed)).withPaymentObserver(gateway.observer);
      if (chainApiUrl && config.apiKey == null && config.sparkConfig)
        builder = builder.withRestChainService(chainApiUrl, 'esplora');
      const raw=await (await builder.withDefaultStorage(storageDir)).build();
      const wallet=gateway.protect(await lifetime.attach(raw));
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
