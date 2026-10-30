/** Development fixture: private raw SDK, exact historical receives, no execution API. */
import initSdk, {SdkBuilder, defaultConfig, defaultExternalSignersFromSeed,
  type BreezSdk, type ExternalBreezSigner, type ExternalSparkSigner} from '@breeztech/breez-sdk-spark';
import {unlockWebWallet, clearUnlockedWebMnemonic} from '../../src/security/webWalletVault';
import {OBSERVATION_ORIGIN, OBSERVATION_PLAN, assertObservationConfig, observationSigners,
  readExactSettledTransfers, assertObservationExecutionAllowed} from './settled-incoming-contract';

const password = 'only-valueless-disposable-regtest-wallet';
const marker = 'gys:disposable-acceptance:v1';
let attempted = false;
let alive = true;
let raw: BreezSdk | null = null;
let guarded: ReturnType<typeof observationSigners> | null = null;
function live() {
  if (!alive || document.visibilityState !== 'visible') throw new Error('Observation session is no longer active');
  guarded?.assertActive();
}
function revoke() {alive = false; guarded?.revoke();}
window.addEventListener('pagehide', revoke);
document.addEventListener('visibilitychange', () => {if (document.visibilityState !== 'visible') revoke();});

async function observe(profile: string) {
  assertObservationExecutionAllowed(); // Before SDK init, storage lookup or unlock.
  if (!import.meta.env.DEV || location.origin !== OBSERVATION_ORIGIN
    || location.search !== '?network=regtest' || attempted) throw new Error('Observation is unavailable');
  const plan = OBSERVATION_PLAN.find(item => item.profile === profile);
  if (!plan) throw new Error('Unknown disposable profile');
  attempted = true;
  let failed = false;
  let result: unknown;
  try {
    live();
    const storageDir = localStorage.getItem(marker);
    if (!storageDir || !/^gys-acceptance-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(storageDir))
      throw new Error('Retained disposable identity marker is unavailable');
    await initSdk(); live();
    let mnemonic = await unlockWebWallet(password); live();
    const resources = defaultExternalSignersFromSeed({type: 'mnemonic', mnemonic}, 'regtest', undefined);
    mnemonic = ''; clearUnlockedWebMnemonic();
    guarded = observationSigners(resources, plan.identity);
    // This identity check precedes builder startup and any provider request.
    const identity = Reflect.get(guarded.sparkSigner, 'getIdentityPublicKey') as () => Promise<unknown>;
    await identity(); live();
    const config = defaultConfig('regtest');
    Object.assign(config, {apiKey: undefined, proxy: undefined, maxDepositClaimFee: undefined,
      backgroundTasksEnabled: false, realTimeSyncServerUrl: undefined, stableBalanceConfig: undefined,
      crossChainConfig: undefined, lnurlDomain: undefined, privateEnabledDefault: false, preferSparkOverLightning: false});
    config.leafOptimizationConfig.autoEnabled = false;
    config.tokenOptimizationConfig.autoEnabled = false;
    assertObservationConfig(config as unknown as Record<string, unknown>);
    const signing = guarded;
    const builder = SdkBuilder.newWithSigner(config,
      guarded.breezSigner as ExternalBreezSigner, guarded.sparkSigner as ExternalSparkSigner)
      .withPaymentObserver({beforeSend: async () => {signing.reject();}, afterSend: async () => {signing.reject();}});
    raw = await (await builder.withDefaultStorage(storageDir)).build(); live();
    const receipts = await readExactSettledTransfers(raw, plan, live);
    if (guarded.counts().denied !== 0) throw new Error('A prohibited signing capability was attempted');
    result = {profile, identity: plan.identity, network: 'regtest', receipts, signerCalls: guarded.counts()};
  } catch {
    failed = true; // Do not serialize SDK errors, storage, challenge bytes or keys.
  } finally {
    revoke(); clearUnlockedWebMnemonic();
    try {if (raw) await raw.disconnect();} catch {failed = true;}
    try {raw?.free();} catch {failed = true;}
    raw = null;
    try {await guarded?.dispose();} catch {failed = true;}
    if (guarded && guarded.counts().denied !== 0) failed = true;
    guarded = null;
  }
  if (failed) throw new Error('Exact incoming observation did not complete; no execution or retry is permitted');
  return result;
}

Object.defineProperty(window, 'gysSettledIncomingObservation', {
  configurable: false, writable: false, value: Object.freeze({observe}),
});
declare global {interface Window {gysSettledIncomingObservation: {observe: typeof observe}}}
