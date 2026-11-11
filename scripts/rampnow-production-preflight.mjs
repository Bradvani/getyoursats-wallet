/** Opt-in, read-only production merchant inspection. Never imported by a build
 * hook. Run only in a protected operator runtime; keep its report private.
 * The only POST is a non-binding quote. No order, customer or wallet is created.
 */
import {pathToFileURL} from 'node:url';
import {bitcoinQuoteRequest, createRampnowClient, decimalAmount, RampnowError, validateBitcoinQuote} from '../server/rampnow.mjs';
import {configuredRampnowPartnerFees} from '../server/rampnowFees.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const code = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value) && value !== 'BTC';
const mode = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value) && value !== 'unknown';
const addressType = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value);
const canonical = value => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
const units = value => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
};
const credential = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s]/.test(value);
const networkReasons = new Set(['chains_missing', 'chains_count', 'chains_entries', 'bitcoin_absent',
  'bitcoin_ambiguous', 'ledger_model', 'node_protocol', 'native_token', 'testnet_flag', 'address_type', 'supported_assets']);

export async function checkRampnowProduction({env = process.env, input, clientFactory = createRampnowClient} = {}) {
  const report = {check: 'rampnow_production_btc_read_only', authentication: false,
    mainnetMetadataVerified: false, advertisedAddressTypeMatches: false, routeEligible: false,
    amountWithinLimits: false, feePolicyConfigured: false, feeBaseCurrencyAttested: false,
    nonBindingQuoteVerified: false, lightningSettlementVerified: false,
    createsOrders: false, productionReady: false};
  const stop = status => ({...report, status});
  if (env.RAMPNOW_PRODUCTION_PREFLIGHT_ENABLED !== 'true' || env.RAMPNOW_ENVIRONMENT !== 'production') {
    return stop('explicit_production_inspection_required');
  }
  if (!object(input) || !code(input.fiatCurrency) || typeof input.country !== 'string' || !/^[A-Z]{2}$/.test(input.country)
    || !decimalAmount(input.srcAmount, true, 3) || !mode(input.paymentMode) || !addressType(input.addressType)) {
    return stop('explicit_route_inputs_required');
  }
  report.requestedRoute = {country: input.country, srcCurrency: input.fiatCurrency, srcChain: 'fiat',
    dstCurrency: 'BTC', dstChain: 'bitcoin', srcAmount: canonical(input.srcAmount),
    paymentMode: input.paymentMode, expectedAddressType: input.addressType};
  const apiKey = env.RAMPNOW_PRODUCTION_API_KEY, apiSecret = env.RAMPNOW_PRODUCTION_API_SECRET;
  if (!credential(apiKey) || !credential(apiSecret)) return stop('dedicated_production_credentials_required');
  // There is deliberately no generic/sandbox credential fallback. When those
  // are present, reject either reused value before making any request.
  if (apiKey === env.RAMPNOW_API_KEY || apiSecret === env.RAMPNOW_API_SECRET
    || apiKey === env.RAMPNOW_SANDBOX_API_KEY || apiSecret === env.RAMPNOW_SANDBOX_API_SECRET) {
    return stop('production_credentials_must_be_separate');
  }
  let policy;
  try {policy = configuredRampnowPartnerFees(env);} catch {return stop('fee_policy_invalid');}
  if (!policy) return stop('fee_policy_required');
  report.feePolicyConfigured = true;
  // This is a provider/operator attestation, not information verified by the
  // quote API. Do not populate it from a dashboard reporting currency/default.
  if (env.RAMPNOW_CONFIRMED_ACCOUNT_FEE_BASE_CURRENCY !== policy.baseCurrency) {
    return stop('fee_base_currency_attestation_required');
  }
  report.feeBaseCurrencyAttested = true;
  report.partnerFeePolicy = {partnerPctFee: policy.partnerPctFee, partnerFixedFee: policy.partnerFixedFee,
    baseCurrency: policy.baseCurrency, currencyEvidence: 'operator_recorded_provider_attestation'};
  let stage = 'authentication';
  try {
    const client = clientFactory({environment: 'production', apiKey, apiSecret});
    await client.getConfig();
    report.authentication = true;
    stage = 'network';
    // The actual client additionally validates exact bitcoin/utxo/btc/BTC
    // metadata and advertised BTC support. Never infer the network from syntax.
    const network = await client.getBitcoinNetwork();
    if (network.chain !== 'bitcoin' || network.nativeToken !== 'BTC' || network.isTestnet !== false
      || network.networkClassification !== 'mainnet') return stop('bitcoin_mainnet_metadata_required');
    report.mainnetMetadataVerified = true;
    if (network.addressType !== input.addressType) return stop('bitcoin_address_support_confirmation_required');
    report.advertisedAddressTypeMatches = true;
    stage = 'capability';
    const [asset, countries] = await Promise.all([
      client.getBitcoinAsset(input.fiatCurrency), client.getBlockedCurrencies(input.country),
    ]);
    const rules = object(countries) && Array.isArray(countries.countries) && countries.countries.length <= 512
      ? countries.countries.filter(item => object(item) && item.country === input.country) : [];
    const rule = rules.length === 1 ? rules[0] : null;
    const range = object(asset) && asset.buyOrderRange;
    if (!object(asset) || asset.currency !== 'BTC' || asset.chain !== 'bitcoin'
      || asset.orderCurrency !== input.fiatCurrency || asset.status !== 'active'
      || !object(range) || range.status !== 'active' || range.currency !== input.fiatCurrency
      || !decimalAmount(range.minAmount, false) || !decimalAmount(range.maxAmount, false)
      || !Array.isArray(asset.payinModes) || asset.payinModes.length > 64 || !asset.payinModes.every(mode)
      || !asset.payinModes.includes(input.paymentMode) || !rule || !Array.isArray(rule.blockedCurrencies)
      || rule.blockedCurrencies.length > 512 || !rule.blockedCurrencies.every(value => typeof value === 'string' && /^[A-Z]{3,6}$/.test(value))
      || rule.blockedCurrencies.includes('BTC') || rule.blockedCurrencies.includes(input.fiatCurrency)) {
      return stop('production_buy_route_unconfirmed');
    }
    report.routeEligible = true;
    report.validatedBuyLimits = {currency: input.fiatCurrency, minAmount: canonical(range.minAmount),
      maxAmount: canonical(range.maxAmount), zeroMaximumMeansUnbounded: true};
    const minimum = units(range.minAmount), maximum = units(range.maxAmount), source = units(input.srcAmount);
    if ((maximum !== 0n && minimum > maximum) || source < minimum || (maximum !== 0n && source > maximum)) {
      return stop('requested_amount_outside_confirmed_limits');
    }
    report.amountWithinLimits = true;
    stage = 'quote';
    const quoteInput = {orderType: 'buy', fiatCurrency: input.fiatCurrency, srcAmount: input.srcAmount,
      paymentMode: input.paymentMode, partnerFees: policy};
    const quote = validateBitcoinQuote(await client.getBitcoinQuote(quoteInput), bitcoinQuoteRequest(quoteInput));
    if (quote.feeDetails.length > 20 || !quote.feeDetails.some(fee => fee.type === 'platform')) return stop('quote_fee_breakdown_unverified');
    // No provider free text, exception, credential, destination or raw config
    // appears in the report. The numeric quote is private commercial evidence.
    const feeTypes = new Set(['platform', 'network', 'partner', 'exchange']);
    report.quote = {orderType: 'buy', srcCurrency: input.fiatCurrency, srcChain: 'fiat',
      dstCurrency: 'BTC', dstChain: 'bitcoin', srcAmount: canonical(quote.srcAmount),
      dstAmount: canonical(quote.dstAmount), paymentMode: input.paymentMode, nonBinding: true,
      feeDetails: quote.feeDetails.map(fee => ({type: feeTypes.has(fee.type) ? fee.type : 'other',
        fee: canonical(fee.fee), currency: fee.currency, isInclusive: fee.isInclusive}))};
    report.nonBindingQuoteVerified = true;
    return stop('read_only_quote_verified_acceptance_still_required');
  } catch (error) {
    if (stage === 'network' && error instanceof RampnowError && networkReasons.has(error.reason)) report.networkReason = error.reason;
    if (error instanceof RampnowError && Number.isInteger(error.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 599) {
      report.httpStatus = error.httpStatus;
    }
    return stop(({authentication: 'production_authentication_unverified', network: 'bitcoin_mainnet_metadata_required',
      capability: 'production_buy_route_unconfirmed', quote: 'production_quote_unverified'})[stage]);
  }
}

export function productionPreflightArguments(args) {
  const fields = {'--fiat': 'fiatCurrency', '--country': 'country', '--amount': 'srcAmount',
    '--payment-mode': 'paymentMode', '--address-type': 'addressType'};
  const input = {};
  if (args.length !== 10) return null;
  for (let index = 0; index < args.length; index += 2) {
    if (!Object.hasOwn(fields, args[index])) return null;
    const field = fields[args[index]];
    if (!field || Object.hasOwn(input, field) || typeof args[index + 1] !== 'string') return null;
    input[field] = args[index + 1];
  }
  return input;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await checkRampnowProduction({input: productionPreflightArguments(process.argv.slice(2))});
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.nonBindingQuoteVerified) process.exitCode = 2;
}
