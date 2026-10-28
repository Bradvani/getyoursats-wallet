/** Build-time sandbox check. Provider calls are read-only; storage probes use
 * synthetic records that are removed after verification.
 * Emits only fixed labels/booleans to private build logs, never provider bodies.
 */
import { pathToFileURL } from 'node:url';
import { createRampnowClient, RampnowError } from '../server/rampnow.mjs';
import { checkRampnowStorage } from '../server/rampnowStorageCheck.mjs';
import { checkRampnowWebhook } from '../server/rampnowWebhookCheck.mjs';
import { checkRampnowWebhookDelivery } from '../server/rampnowWebhookDeliveryCheck.mjs';

export async function checkRampnowPreview(env = process.env, clientFactory = createRampnowClient,
  {storageCheck = checkRampnowStorage, webhookCheck = checkRampnowWebhook,
    deliveryCheck = checkRampnowWebhookDelivery} = {}) {
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
  if (report.storage.status === 'sandbox_storage_verified') {
    report.webhookSelfTest = await webhookCheck(env);
    report.webhookDelivery = await deliveryCheck(env);
  }
  try {
    const client = clientFactory({ environment: 'sandbox', apiKey: env.RAMPNOW_API_KEY, apiSecret: env.RAMPNOW_API_SECRET });
    await client.getConfig();
    report.authentication = true;
    try {
      const network = await client.getBitcoinNetwork();
      report.bitcoinNetwork = network.networkClassification;
      report.networkStatus = 'provider_metadata_read';
    } catch (error) {
      report.networkStatus = 'bitcoin_network_confirmation_required';
      report.networkFailure = error instanceof RampnowError
        && ['RAMPNOW_BITCOIN_NETWORK_INVALID', 'RAMPNOW_UPSTREAM_UNAVAILABLE', 'RAMPNOW_RESPONSE_INVALID',
          'RAMPNOW_RESPONSE_TOO_LARGE'].includes(error.code) ? error.code : 'unavailable';
      report.networkHttpStatus = error instanceof RampnowError && Number.isInteger(error.httpStatus)
        && error.httpStatus >= 400 && error.httpStatus <= 599 ? error.httpStatus : null;
      if (error instanceof RampnowError && error.code === 'RAMPNOW_BITCOIN_NETWORK_INVALID') {
        report.networkReason = ['chains_missing', 'chains_count', 'chains_entries', 'bitcoin_absent',
          'bitcoin_ambiguous', 'ledger_model', 'node_protocol', 'native_token', 'testnet_flag',
          'address_type', 'supported_assets'].includes(error.reason) ? error.reason : 'unavailable';
        if (Number.isInteger(error.bitcoinMatchCount) && error.bitcoinMatchCount >= 0 && error.bitcoinMatchCount <= 512) {
          report.bitcoinMatchCount = error.bitcoinMatchCount;
        }
        const facts = error.networkFacts;
        if (facts && typeof facts === 'object' && !Array.isArray(facts)) {
          report.bitcoinNetworkFacts = {
            nodeProtocol: ['btc', 'bitcoin', 'bitcoind', 'utxo', 'evm', 'svm', 'missing', 'other'].includes(facts.nodeProtocol)
              ? facts.nodeProtocol : 'other',
            testnetFlag: typeof facts.testnetFlag === 'boolean' ? facts.testnetFlag : null,
            nativeAsset: ['BTC', 'BTC:bitcoin', 'missing', 'other'].includes(facts.nativeAsset) ? facts.nativeAsset : 'other',
            addressTypePresent: facts.addressTypePresent === true,
            addressTypeValid: facts.addressTypeValid === true,
            btcAssetSupported: facts.btcAssetSupported === true,
          };
        }
      }
    }
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
