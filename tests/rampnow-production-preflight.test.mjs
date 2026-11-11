import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRampnowProduction, productionPreflightArguments} from '../scripts/rampnow-production-preflight.mjs';
import {createRampnowClient} from '../server/rampnow.mjs';

const env = {RAMPNOW_PRODUCTION_PREFLIGHT_ENABLED: 'true', RAMPNOW_ENVIRONMENT: 'production',
  RAMPNOW_PRODUCTION_API_KEY: 'private-production-key', RAMPNOW_PRODUCTION_API_SECRET: 'private-production-secret',
  RAMPNOW_API_KEY: 'private-sandbox-key', RAMPNOW_API_SECRET: 'private-sandbox-secret',
  RAMPNOW_PARTNER_PCT_FEE: '0.25', RAMPNOW_PARTNER_FIXED_FEE: '0.10', RAMPNOW_PARTNER_FEE_BASE_CURRENCY: 'USD',
  RAMPNOW_CONFIRMED_ACCOUNT_FEE_BASE_CURRENCY: 'USD'};
const input = {fiatCurrency: 'INR', country: 'IN', srcAmount: '1000', paymentMode: 'upi', addressType: 'bech32'};
const route = {orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin'};
const root = '/api/partner/v1/ext/ramp_order';

function fixture(changes = {}) {
  const bodies = {
    config: {privateAccount: 'private-account-body'},
    network: {chains: [{code: 'bitcoin', type: 'utxo', nodeType: 'btc', nativeToken: 'BTC', isTestnet: false,
      addressType: 'bech32', supportedAssets: ['BTC:bitcoin']}]},
    asset: {currency: 'BTC', chain: 'bitcoin', orderCurrency: 'INR', status: 'active', payinModes: ['upi', 'card'],
      buyOrderRange: {status: 'active', currency: 'INR', minAmount: '100', maxAmount: '10000'}},
    country: {countries: [{country: 'IN', blockedCurrencies: []}]},
    quote: {...route, srcAmount: '1000.00', dstAmount: '0.00010000', paymentMode: 'upi',
      feeDetails: [{type: 'platform', fee: '5.00', currency: 'INR', isInclusive: true},
        {type: 'network', fee: '0.000001', currency: 'BTC', isInclusive: false}],
      message: 'private-free-text', privateCredential: 'private-provider-secret'},
    ...changes,
  };
  const calls = [];
  const clientFactory = options => {
    assert.equal(options.environment, 'production');
    assert.equal(options.apiKey, env.RAMPNOW_PRODUCTION_API_KEY);
    assert.equal(options.apiSecret, env.RAMPNOW_PRODUCTION_API_SECRET);
    return createRampnowClient({...options, fetchImpl: async (url, options) => {
      const target = new URL(url);
      assert.equal(target.origin, 'https://api.rampnow.io');
      assert.equal(options.headers['X-RAMPNOW-API-KEY'], env.RAMPNOW_PRODUCTION_API_KEY);
      assert.equal(options.redirect, 'error');
      const path = target.pathname + target.search;
      calls.push({path, method: options.method, body: options.body && JSON.parse(options.body)});
      const mapping = {[root + '/config']: 'config', [root + '/chain_config']: 'network',
        [root + '/asset_config?currency=BTC&chain=bitcoin&orderCurrency=INR']: 'asset',
        [root + '/blocked_currencies?country=IN']: 'country', [root + '/quote']: 'quote'};
      assert.ok(Object.hasOwn(mapping, path), 'only read-only endpoints may be requested');
      assert.equal(options.method, mapping[path] === 'quote' ? 'POST' : 'GET');
      const body = bodies[mapping[path]];
      if (body instanceof Error) throw body;
      if (body instanceof Response) return body;
      return new Response(JSON.stringify({code: 0, data: body}), {status: 200});
    }});
  };
  return {calls, bodies, run: (overrides = {}) => checkRampnowProduction({env: {...env}, input: {...input}, clientFactory, ...overrides})};
}

test('dedicated production authentication and non-binding quote never claim launch or delivery readiness', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, 'read_only_quote_verified_acceptance_still_required');
  for (const key of ['authentication', 'mainnetMetadataVerified', 'advertisedAddressTypeMatches', 'routeEligible',
    'amountWithinLimits', 'feePolicyConfigured', 'feeBaseCurrencyAttested', 'nonBindingQuoteVerified']) assert.equal(result[key], true);
  assert.equal(result.productionReady, false); assert.equal(result.createsOrders, false);
  assert.equal(result.lightningSettlementVerified, false);
  assert.deepEqual(result.requestedRoute, {country: 'IN', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC',
    dstChain: 'bitcoin', srcAmount: '1000', paymentMode: 'upi', expectedAddressType: 'bech32'});
  assert.deepEqual(result.partnerFeePolicy, {partnerPctFee: 0.25, partnerFixedFee: 0.1,
    baseCurrency: 'USD', currencyEvidence: 'operator_recorded_provider_attestation'});
  assert.deepEqual(result.validatedBuyLimits, {currency: 'INR', minAmount: '100', maxAmount: '10000', zeroMaximumMeansUnbounded: true});
  const posts = f.calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 1); assert.equal(posts[0].path, root + '/quote');
  assert.deepEqual(posts[0].body, {...route, srcAmount: '1000', paymentMode: 'upi', partnerPctFee: 0.25, partnerFixedFee: 0.1});
  assert.deepEqual(result.quote, {...route, srcAmount: '1000', dstAmount: '0.0001', paymentMode: 'upi', nonBinding: true,
    feeDetails: [{type: 'platform', fee: '5', currency: 'INR', isInclusive: true},
      {type: 'network', fee: '0.000001', currency: 'BTC', isInclusive: false}]});
  assert.doesNotMatch(JSON.stringify(result), /private|customer|userUid|orderUid/i);
});

test('missing opt-in, environment, separate credentials or matching fee-currency attestation makes no request', async () => {
  const cases = [
    [{RAMPNOW_PRODUCTION_PREFLIGHT_ENABLED: undefined}, 'explicit_production_inspection_required'],
    [{RAMPNOW_ENVIRONMENT: 'sandbox'}, 'explicit_production_inspection_required'],
    [{RAMPNOW_PRODUCTION_API_KEY: undefined}, 'dedicated_production_credentials_required'],
    [{RAMPNOW_PRODUCTION_API_SECRET: ''}, 'dedicated_production_credentials_required'],
    [{RAMPNOW_PRODUCTION_API_SECRET: 'private bad secret'}, 'dedicated_production_credentials_required'],
    [{RAMPNOW_PRODUCTION_API_KEY: env.RAMPNOW_API_KEY}, 'production_credentials_must_be_separate'],
    [{RAMPNOW_SANDBOX_API_SECRET: env.RAMPNOW_PRODUCTION_API_SECRET}, 'production_credentials_must_be_separate'],
    [{RAMPNOW_PARTNER_PCT_FEE: undefined}, 'fee_policy_invalid'],
    [{RAMPNOW_PARTNER_FIXED_FEE: '-0.1'}, 'fee_policy_invalid'],
    [{RAMPNOW_CONFIRMED_ACCOUNT_FEE_BASE_CURRENCY: undefined}, 'fee_base_currency_attestation_required'],
    [{RAMPNOW_CONFIRMED_ACCOUNT_FEE_BASE_CURRENCY: 'EUR'}, 'fee_base_currency_attestation_required'],
  ];
  for (const [override, status] of cases) {
    let clients = 0;
    const result = await checkRampnowProduction({env: {...env, ...override}, input,
      clientFactory: () => {clients++; throw Error('must-not-connect');}});
    assert.equal(result.status, status); assert.equal(clients, 0); assert.equal(result.authentication, false);
    assert.equal(result.partnerFeePolicy, undefined); assert.equal(result.validatedBuyLimits, undefined);
  }
  const absent = {...env};
  for (const key of ['RAMPNOW_PARTNER_PCT_FEE', 'RAMPNOW_PARTNER_FIXED_FEE', 'RAMPNOW_PARTNER_FEE_BASE_CURRENCY']) delete absent[key];
  assert.equal((await checkRampnowProduction({env: absent, input, clientFactory: () => assert.fail()})).status, 'fee_policy_required');
});

test('route inputs have no country, payment, amount, fiat or address-type defaults', async () => {
  for (const field of Object.keys(input)) {
    const incomplete = {...input}; delete incomplete[field];
    const result = await checkRampnowProduction({env, input: incomplete, clientFactory: () => assert.fail()});
    assert.equal(result.status, 'explicit_route_inputs_required');
  }
  for (const patch of [{fiatCurrency: 'BTC'}, {fiatCurrency: 'usd'}, {country: 'India'},
    {srcAmount: '0'}, {srcAmount: '1e3'}, {srcAmount: '1.0001'}, {paymentMode: 'unknown'}, {addressType: 'https://private.invalid'}]) {
    assert.equal((await checkRampnowProduction({env, input: {...input, ...patch}, clientFactory: () => assert.fail()})).status,
      'explicit_route_inputs_required');
  }
});

test('testnet, missing or contradictory Bitcoin metadata cannot fall back to a mainnet quote', async () => {
  for (const patch of [{type: 'evm'}, {nodeType: 'other'}, {nodeType: 'bitcoin'}, {nativeToken: 'ETH'},
    {isTestnet: true}, {isTestnet: undefined}, {supportedAssets: ['ETH']}, {addressType: 'private invalid type'}]) {
    const f = fixture(); Object.assign(f.bodies.network.chains[0], patch);
    const result = await f.run(); assert.equal(result.status, 'bitcoin_mainnet_metadata_required');
    assert.equal(result.nonBindingQuoteVerified, false); assert.equal(f.calls.some(call => call.method === 'POST'), false);
  }
  for (const chains of [[], [fixture().bodies.network.chains[0], fixture().bodies.network.chains[0]]]) {
    const f = fixture({network: {chains}}); const result = await f.run();
    assert.equal(result.mainnetMetadataVerified, false); assert.equal(f.calls.length, 2);
  }
  const f = fixture(); const result = await f.run({input: {...input, addressType: 'p2tr'}});
  assert.equal(result.status, 'bitcoin_address_support_confirmation_required'); assert.equal(f.calls.length, 2);
});

test('inactive, blocked, unsupported, duplicate or mismatched route facts never request quotes', async () => {
  const mutations = [f => {f.bodies.asset.currency = 'ETH';}, f => {f.bodies.asset.chain = 'ethereum';},
    f => {f.bodies.asset.orderCurrency = 'USD';}, f => {f.bodies.asset.status = 'inactive';},
    f => {f.bodies.asset.buyOrderRange.status = 'inactive';}, f => {f.bodies.asset.buyOrderRange.currency = 'USD';},
    f => {f.bodies.asset.buyOrderRange.minAmount = '1e2';}, f => {f.bodies.asset.payinModes = ['card'];},
    f => {f.bodies.country.countries = [];}, f => {f.bodies.country.countries.push(f.bodies.country.countries[0]);},
    f => {f.bodies.country.countries[0].blockedCurrencies = ['BTC'];},
    f => {f.bodies.country.countries[0].blockedCurrencies = ['INR'];}];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f); const result = await f.run();
    assert.equal(result.status, 'production_buy_route_unconfirmed'); assert.equal(f.calls.some(call => call.method === 'POST'), false);
  }
});

test('exact decimal limits bind the quote and zero maximum is explicitly unbounded', async () => {
  for (const range of [{minAmount: '1000.001'}, {maxAmount: '999.999'}, {minAmount: '2000', maxAmount: '1000'}]) {
    const f = fixture(); Object.assign(f.bodies.asset.buyOrderRange, range); const result = await f.run();
    assert.equal(result.status, 'requested_amount_outside_confirmed_limits');
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
  }
  const f = fixture(); Object.assign(f.bodies.asset.buyOrderRange, {minAmount: '0', maxAmount: '0'});
  assert.equal((await f.run()).nonBindingQuoteVerified, true);
});

test('quote must match route, amount, payment mode and a bounded explicit fee breakdown', async () => {
  for (const patch of [{dstChain: 'ethereum'}, {dstCurrency: 'ETH'}, {srcAmount: '999'}, {paymentMode: 'card'},
    {dstAmount: '0'}, {dstAmount: '0.000000001'}, {feeDetails: [{type: 'platform', fee: '-1', currency: 'INR', isInclusive: true}]}]) {
    const f = fixture(); Object.assign(f.bodies.quote, patch); const result = await f.run();
    assert.equal(result.status, 'production_quote_unverified'); assert.equal(result.nonBindingQuoteVerified, false);
  }
  for (const fees of [[], Array.from({length: 21}, () => ({type: 'platform', fee: '1', currency: 'INR', isInclusive: true}))]) {
    const f = fixture(); f.bodies.quote.feeDetails = fees;
    assert.equal((await f.run()).status, 'quote_fee_breakdown_unverified');
  }
});

test('provider errors and extra text are never reflected into the protected report', async () => {
  for (const field of ['config', 'network', 'asset', 'country', 'quote']) {
    const f = fixture({[field]: new Error('private-secret-in-cause')}); const result = await f.run();
    assert.doesNotMatch(JSON.stringify(result), /private/); assert.equal(result.productionReady, false);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, field === 'quote' ? 1 : 0);
  }
  const denied = fixture({config: new Response('private-api-body', {status: 403})});
  const result = await denied.run(); assert.equal(result.httpStatus, 403);
  assert.equal(result.status, 'production_authentication_unverified'); assert.doesNotMatch(JSON.stringify(result), /private/);
  const extra = fixture(); extra.bodies.quote.feeDetails.push({type: 'private-type', fee: '1', currency: 'USDT', isInclusive: false});
  assert.equal((await extra.run()).quote.feeDetails.at(-1).type, 'other');
});

test('protected evidence snapshots copy only validated route, limits and attested policy fields', async () => {
  const f = fixture();
  Object.assign(f.bodies.asset.buyOrderRange, {minAmount: '100.00', maxAmount: '10000.000', privateNote: 'private-range-secret'});
  const result = await f.run({input: {...input, srcAmount: '1000.000', destination: 'private-actual-wallet-address',
    apiSecret: 'private-input-secret', partnerPctFee: 99}, env: {...env, RAMPNOW_EXTRA_PRIVATE: 'private-env-value'}});
  assert.equal(result.requestedRoute.srcAmount, '1000');
  assert.deepEqual(result.validatedBuyLimits, {currency: 'INR', minAmount: '100', maxAmount: '10000', zeroMaximumMeansUnbounded: true});
  assert.equal(result.partnerFeePolicy.partnerPctFee, 0.25);
  assert.equal(result.partnerFeePolicy.currencyEvidence, 'operator_recorded_provider_attestation');
  assert.doesNotMatch(JSON.stringify(result), /private|destination|apiSecret|privateNote|RAMPNOW_EXTRA/);
});

test('CLI accepts only all five explicit flags, with no credential or endpoint arguments', () => {
  const valid = ['--fiat', 'INR', '--country', 'IN', '--amount', '1000', '--payment-mode', 'upi', '--address-type', 'bech32'];
  assert.deepEqual(productionPreflightArguments(valid), input);
  for (const args of [[], valid.slice(0, 8), [...valid, '--key', 'private'],
    ['--url', ...valid.slice(1)], ['--country', ...valid.slice(1)], ['toString', ...valid.slice(1)]]) {
    assert.equal(productionPreflightArguments(args), null);
  }
});
