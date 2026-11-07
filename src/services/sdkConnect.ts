import {isConfiguredSdkKey} from '../getyoursats/walletReadiness';
import {
  Config,
  Network,
  SdkBuilder,
  SparkConfig,
  connect,
  defaultConfig,
  type BreezSdk,
  type Seed,
} from '@breeztech/breez-sdk-spark';
import { getSettings } from './settings';
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

const RAMPNOW_SANDBOX_ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const isNetwork = (value: unknown): value is Network =>
  value === 'mainnet' || value === 'regtest' || value === 'signet';

/** Select the network before creating any wallet configuration. A checkout
 * return must carry its explicit supported sandbox network, never mainnet by
 * default. The URL is navigation context only: it proves neither order
 * ownership nor settlement. Status still requires the wallet-signed challenge.
 */
export function selectedNetwork(overrideNetwork?: Network): Network {
  const {origin, pathname, search, hash} = window.location;
  const params = new URLSearchParams(search);
  const networks = params.getAll('network');
  if (pathname === '/rampnow' || pathname.startsWith('/rampnow/')) {
    const intent = params.get('intent');
    if (origin !== RAMPNOW_SANDBOX_ORIGIN || pathname !== '/rampnow/return' || hash
      || [...params].length !== 2 || params.getAll('intent').length !== 1
      || !intent || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent)
      || networks.length !== 1 || networks[0] !== 'signet'
      || (overrideNetwork !== undefined && overrideNetwork !== 'signet')) {
      throw new Error('Could not verify the sandbox checkout return. Reopen the original wallet preview to check the purchase.');
    }
    return 'signet';
  }
  if (networks.length > 1 || (networks.length === 1 && !isNetwork(networks[0]))
    || (overrideNetwork !== undefined && !isNetwork(overrideNetwork))) {
    throw new Error('The wallet network is unsupported or ambiguous. Reopen the original wallet address.');
  }
  return overrideNetwork ?? (networks[0] as Network | undefined) ?? 'mainnet';
}

/**
 * Build a Breez SDK Config from environment and persisted user settings.
 * Pure function — no side effects beyond reading env vars and localStorage.
 */
export function buildConnectConfig(overrideNetwork?: Network): Config {
  const network = selectedNetwork(overrideNetwork);
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
  const chainApiUrl = import.meta.env.VITE_ESPLORA_BASE_URL;
  if (chainApiUrl && config.apiKey == null && config.sparkConfig) {
    const builder = SdkBuilder.new(config, seed).withRestChainService(chainApiUrl, 'esplora');
    return (await builder.withDefaultStorage(storageDir)).build();
  }
  return connect({ config, seed, storageDir });
}
