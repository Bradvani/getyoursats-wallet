/** Build-time sandbox check. Provider calls are read-only; storage probes use
 * synthetic records that are removed after verification.
 * Emits only fixed labels/booleans to private build logs, never provider bodies.
 */
import { pathToFileURL } from 'node:url';
import { createRampnowClient, RampnowError } from '../server/rampnow.mjs';
import { checkRampnowStorage } from '../server/rampnowStorageCheck.mjs';
import { checkRampnowWebhook } from '../server/rampnowWebhookCheck.mjs';

export async function checkRampnowPreview(env = process.env, clientFactory = createRampnowClient,
  {storageCheck = checkRampnowStorage, webhookCheck = checkRampnowWebhook} = {}) {
  const report = { check: 'rampnow_sandbox', authentication: false, btcBuyCandidate: false,
    btcSellCandidate: false, bitcoinNetwork: 'unverified', networkStatus: 'not_checked',
    webhookStorageConfigured: false, providerDeliveryVerified: false, productionReady: false };
  if (env.VERCEL_ENV !== 'preview'
    || env.VERCEL_GIT_COMMIT_REF !== 'feat/rampnow-integration-20261028') {
    return { ...report, status: 'skipped_outside_integration_preview' };
  }
  if (env.RAMPNOW_ENVIRONMENT !== 'sandbox' || !env.RAMPNOW_API_KEY || !env.RAMPNOW_API_SECRET) {
    return { ...report, status: 'sandbox_configuration_required' };
  }
  // Storage and capability failures are independent and remain separately visible.
  report.storage = await storageCheck(env);
  report.webhookStorageConfigured = report.storage.configured === true;
  if (report.storage.status === 'sandbox_storage_verified') report.webhookSelfTest = await webhookCheck(env);
  try {
    const client = clientFactory({ environment: 'sandbox', apiKey: env.RAMPNOW_API_KEY, apiSecret: env.RAMPNOW_API_SECRET });
    await client.getConfig();
    report.authentication = true;
    try {
      const network = await client.getBitcoinNetwork();
      report.bitcoinNetwork = network.networkClassification;
      report.networkStatus = 'provider_metadata_read';
    } catch { report.networkStatus = 'bitcoin_network_confirmation_required'; }
    const [asset, countries] = await Promise.all([client.getBitcoinAsset('INR'), client.getBlockedCurrencies('IN')]);
    const rule = Array.isArray(countries.countries) ? countries.countries.find(item => item?.country === 'IN') : null;
    const route = asset.currency === 'BTC' && asset.chain === 'bitcoin' && asset.orderCurrency === 'INR'
      && asset.status === 'active' && Array.isArray(rule?.blockedCurrencies) && !rule.blockedCurrencies.includes('BTC');
    report.btcBuyCandidate = !!(route && asset.buyOrderRange?.status === 'active'
      && Array.isArray(asset.payinModes) && asset.payinModes.length);
    report.btcSellCandidate = !!(route && asset.sellOrderRange?.status === 'active'
      && Array.isArray(asset.payoutModes) && asset.payoutModes.length);
    return { ...report, status: report.btcBuyCandidate && report.btcSellCandidate ? 'capabilities_read' : 'btc_route_confirmation_required' };
  } catch (error) {
    // A provider exception can contain credentials. Never log it or its cause.
    const httpStatus = error instanceof RampnowError && Number.isInteger(error.httpStatus)
      && error.httpStatus >= 400 && error.httpStatus <= 599 ? error.httpStatus : null;
    return { ...report, status: report.authentication ? 'capability_check_failed' : 'authentication_check_failed', httpStatus };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await checkRampnowPreview()));
}
