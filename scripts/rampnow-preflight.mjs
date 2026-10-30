/** Account capability inspection only. No customers/orders/payments are created.
 * Inject RAMPNOW_ENVIRONMENT, RAMPNOW_API_KEY and RAMPNOW_API_SECRET securely.
 * Optional non-binding quotes: --quote-buy 1000 --quote-sell 0.0001
 */
import { createRampnowClient, RampnowError } from '../server/rampnow.mjs';

const allowed = new Set(['--fiat', '--country', '--quote-buy', '--quote-sell']);
const args = process.argv.slice(2);
const options = {};
try {
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) {
      throw new RampnowError('RAMPNOW_ARGUMENTS_INVALID');
    }
    options[args[i]] = args[i + 1];
  }
  const fiat = options['--fiat'] ?? 'INR';
  const country = options['--country'] ?? 'IN';
  if (!/^[A-Z]{3}$/.test(fiat) || !/^[A-Z]{2}$/.test(country)) throw new RampnowError('RAMPNOW_ARGUMENTS_INVALID');
  const environment = process.env.RAMPNOW_ENVIRONMENT;
  const client = createRampnowClient({ environment, apiKey: process.env.RAMPNOW_API_KEY, apiSecret: process.env.RAMPNOW_API_SECRET });
  const [assetResult, blockedResult] = await Promise.allSettled([
    client.getBitcoinAsset(fiat), client.getBlockedCurrencies(country),
  ]);
  const asset = assetResult.status === 'fulfilled' ? assetResult.value : null;
  const countryRule = blockedResult.status === 'fulfilled'
    ? blockedResult.value.countries?.find(item => item.country === country) : null;
  const countryKnown = Array.isArray(countryRule?.blockedCurrencies);
  const route = asset?.currency === 'BTC' && asset.chain === 'bitcoin' && asset.orderCurrency === fiat
    && asset.status === 'active' && countryKnown && !countryRule.blockedCurrencies.includes('BTC');
  const candidates = {
    buy: !!(route && asset.buyOrderRange?.status === 'active' && asset.payinModes?.length),
    sell: !!(route && asset.sellOrderRange?.status === 'active' && asset.payoutModes?.length),
  };
  const report = {
    environment, fiat, country, assetFound: !!asset, countryRuleKnown: countryKnown,
    routeCandidates: candidates,
    providerLimits: asset ? { buy: asset.buyOrderRange, sell: asset.sellOrderRange } : null,
    providerModes: asset ? { buy: asset.payinModes, sell: asset.payoutModes } : null,
    errors: [assetResult, blockedResult].filter(item => item.status === 'rejected')
      .map(item => item.reason instanceof RampnowError ? item.reason.code : 'RAMPNOW_PREFLIGHT_FAILED'),
    productionReady: false,
    remaining: ['provider-approved BTC test route', 'durable checkout intent and webhook store',
      'verified GYS deposit/withdrawal integration', 'sandbox outcomes and controlled production acceptance'],
    quotes: {},
  };
  for (const orderType of ['buy', 'sell']) {
    const srcAmount = options['--quote-' + orderType];
    if (srcAmount === undefined) continue;
    if (!candidates[orderType]) { report.quotes[orderType] = { skipped: 'ROUTE_NOT_CONFIRMED' }; continue; }
    const quote = await client.getBitcoinQuote({ orderType, fiatCurrency: fiat, srcAmount });
    report.quotes[orderType] = {
      srcAmount: quote.srcAmount, dstAmount: quote.dstAmount, paymentMode: quote.paymentMode,
      feeDetails: quote.feeDetails.map(({ type, fee, currency, isInclusive }) => ({ type, fee, currency, isInclusive })),
      nonBinding: true,
    };
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.errors.length || !candidates.buy || !candidates.sell) process.exitCode = 2;
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error instanceof RampnowError ? error.code : 'RAMPNOW_PREFLIGHT_FAILED', productionReady: false }) + '\n');
  process.exitCode = 1;
}
