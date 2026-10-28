/** Build-time, read-only sandbox check. Credentials never leave server-side code.
 * Emits only fixed labels/booleans to private build logs, never provider bodies.
 */
import { pathToFileURL } from 'node:url';
import { createRampnowClient, RampnowError } from '../server/rampnow.mjs';

export async function checkRampnowPreview(env = process.env, clientFactory = createRampnowClient) {
  const report = { check: 'rampnow_sandbox', authentication: false, btcBuyCandidate: false,
    btcSellCandidate: false, webhookStorageConfigured: false, productionReady: false };
  if (env.VERCEL_ENV !== 'preview'
    || env.VERCEL_GIT_COMMIT_REF !== 'feat/rampnow-integration-20261028') {
    return { ...report, status: 'skipped_outside_integration_preview' };
  }
  if (env.RAMPNOW_ENVIRONMENT !== 'sandbox' || !env.RAMPNOW_API_KEY || !env.RAMPNOW_API_SECRET) {
    return { ...report, status: 'sandbox_configuration_required' };
  }
  report.webhookStorageConfigured = !!(env.RAMPNOW_REDIS_REST_URL && env.RAMPNOW_REDIS_REST_TOKEN);
  try {
    const client = clientFactory({ environment: 'sandbox', apiKey: env.RAMPNOW_API_KEY, apiSecret: env.RAMPNOW_API_SECRET });
    await client.getConfig();
    report.authentication = true;
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
