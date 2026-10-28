import test from 'node:test';
import assert from 'node:assert/strict';
import {bech32} from '@scure/base';
import {createRampnowService} from '../server/rampnowService.mjs';
import {normalizeRampnowBuyInput} from '../server/rampnowCheckout.mjs';
import {hashRampnowPayload} from '../server/rampnowAuth.mjs';
import {applyRampnowOrderEvent, RampnowError} from '../server/rampnow.mjs';
import {RAMPNOW_STORE_PREFIX} from '../server/rampnowStore.mjs';

const clone = value => structuredClone(value);
const owner = '02' + '1'.repeat(64);
const otherOwner = '03' + '2'.repeat(64);
const address = byte => bech32.encode('tb', [0, ...bech32.toWords(new Uint8Array(20).fill(byte))]);
const input = {srcAmount: '1000.00', destination: address(1), network: 'signet',
  user: {email: 'private-service-fixture@example.com', firstName: 'PrivateFixture', lastName: 'Tester',
    phone: '+919876543210', dateOfBirth: '1990-02-28', gender: 'unknown', country: 'IN'}};
const route = {orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin'};
const scope = {VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: 'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa',
  VERCEL_GIT_COMMIT_REF: 'feat/rampnow-integration-20261028', RAMPNOW_ENVIRONMENT: 'sandbox',
  RAMPNOW_CHECKOUT_ENABLED: 'true', RAMPNOW_BITCOIN_TEST_NETWORK: 'signet'};
const errorCode = code => error => error?.code === code && error.message === code && !error.cause;

/** Atomic fake models the ledger's one-way reservation, not its Redis script.
 * Real Redis CAS behavior is independently covered by rampnow-intent-store tests.
 */
function fixture(envChanges = {}) {
  let clock = Date.parse('2026-10-28T12:00:00Z');
  const intents = new Map(); const states = new Map();
  const calls = {prepare: [], reserve: [], bind: [], uncertain: [], quote: [], post: [], find: [], ingest: [], redis: []};
  const provider = {
    chain: {chain: 'bitcoin', isTestnet: true, networkClassification: 'testnet_unspecified'},
    asset: {currency: 'BTC', chain: 'bitcoin', orderCurrency: 'INR', status: 'active', payinModes: ['upi', 'card'],
      buyOrderRange: {status: 'active', currency: 'INR', minAmount: '100', maxAmount: '10000'}},
    countries: {countries: [{country: 'IN', blockedCurrencies: []}]},
    quote: {...route, srcAmount: '1000.00', dstAmount: '0.00010000', paymentMode: 'upi',
      feeDetails: [{type: 'platform', fee: '25.50', currency: 'INR', isInclusive: true},
        {type: 'network', fee: '0.00000100', currency: 'BTC', isInclusive: false}]},
    orders: [],
  };
  const h = {env: {...scope, ...envChanges}, calls, provider, intents, states,
    advance: milliseconds => {clock += milliseconds;}, now: () => clock,
    afterReserve: null, quoteHook: null, createHook: null, failBind: false, failUncertain: false};
  function owned(id, pub, hash) {
    const record = intents.get(id);
    if (!record || record.walletPubkey !== pub) throw new RampnowError('RAMPNOW_INTENT_NOT_FOUND');
    if (hash !== undefined && hash !== record.requestHash) throw new RampnowError('RAMPNOW_INTENT_CONFLICT');
    return record;
  }
  h.store = {
    async prepare(record) {
      calls.prepare.push(clone(record));
      if (clock >= record.expiresAt) throw new RampnowError('RAMPNOW_INTENT_EXPIRED');
      assert.equal(intents.has(record.externalOrderUid), false);
      const candidate = {...clone(record), phase: 'prepared', updatedAt: clock};
      intents.set(record.externalOrderUid, candidate); return clone(candidate);
    },
    async get(id, pub) {const record = intents.get(id); return record?.walletPubkey === pub ? clone(record) : null;},
    async reserve(id, pub, hash) {
      calls.reserve.push({id, pub, hash});
      const record = owned(id, pub, hash);
      if (record.phase !== 'prepared') return {reserved: false, intent: clone(record)};
      if (clock >= record.expiresAt) throw new RampnowError('RAMPNOW_INTENT_EXPIRED');
      record.phase = 'submitting'; record.updatedAt = clock;
      if (h.afterReserve) h.afterReserve();
      return {reserved: true, intent: clone(record)};
    },
    async markUncertain(id, pub, hash) {
      calls.uncertain.push({id, pub, hash});
      if (h.failUncertain) throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');
      const record = owned(id, pub, hash);
      if (record.phase === 'submitting') {record.phase = 'uncertain'; record.updatedAt = clock;}
      return clone(record);
    },
    async bind(id, pub, hash, binding) {
      calls.bind.push({id, pub, hash, binding: clone(binding)});
      if (h.failBind) throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');
      const record = owned(id, pub, hash);
      assert.ok(['submitting', 'uncertain', 'bound'].includes(record.phase));
      if (record.phase === 'bound') assert.equal(record.orderUid, binding.orderUid);
      record.phase = 'bound'; record.orderUid = binding.orderUid;
      record.checkoutUrl = record.checkoutUrl ?? binding.checkoutUrl;
      record.updatedAt = clock; return clone(record);
    },
    async redis(...args) {
      calls.redis.push(args); assert.equal(args[0], 'GET');
      return states.has(args[1]) ? JSON.stringify(states.get(args[1])) : null;
    },
  };
  const client = {
    async getBitcoinNetwork() {return clone(provider.chain);},
    async getBitcoinAsset(currency) {assert.equal(currency, 'INR'); return clone(provider.asset);},
    async getBlockedCurrencies(country) {assert.equal(country, 'IN'); return clone(provider.countries);},
    async getBitcoinQuote(request) {calls.quote.push(clone(request)); if (h.quoteHook) await h.quoteHook(); return clone(provider.quote);},
    async findOrders(id) {calls.find.push(id); return clone(provider.orders);},
  };
  const checkout = {async createBuyOrder(request) {
    calls.post.push(clone(request));
    if (h.createHook) return await h.createHook(request);
    return {orderUid: 'provider-order-1', userUid: 'provider-user-1',
      redirectUrl: 'https://app.sandbox.rampnow.io/checkout?orderUid=provider-order-1'};
  }};
  const webhookStore = {async ingest(event) {
    calls.ingest.push(clone(event));
    const intent = intents.get(event.payload.externalOrderUid);
    assert.equal(intent.phase, 'bound');
    const key = RAMPNOW_STORE_PREFIX + 'state:' + intent.externalOrderUid;
    states.set(key, applyRampnowOrderEvent(states.get(key) ?? null, event, intent));
    return 'ACCEPTED';
  }};
  h.service = createRampnowService({env: h.env, store: h.store, now: h.now, client, checkout, webhookStore});
  h.prepare = () => h.service.prepare(owner, clone(input));
  h.payload = review => ({externalOrderUid: review.externalOrderUid, quoteHash: review.quoteHash, input: clone(input)});
  h.consume = async review => {
    const record = intents.get(review.externalOrderUid);
    await h.store.reserve(record.externalOrderUid, owner, record.requestHash);
    await h.store.markUncertain(record.externalOrderUid, owner, record.requestHash);
  };
  h.order = (changes = {}) => ({uid: 'provider-order-1', ...route, srcAmount: '1000.00',
    walletAddress: input.destination, status: 'completed', dstFillAmount: '0.00009500',
    updatedAt: '2026-10-28T12:00:05Z', ...changes});
  return h;
}

test('service exists only on the exact sandbox integration project and preview branch', () => {
  for (const changes of [{VERCEL_ENV: 'production'}, {VERCEL_ENV: 'development'},
    {VERCEL_PROJECT_ID: 'other-project'}, {VERCEL_GIT_COMMIT_REF: 'main'},
    {RAMPNOW_ENVIRONMENT: 'production'}, {RAMPNOW_ENVIRONMENT: undefined}]) {
    assert.throws(() => fixture(changes), errorCode('RAMPNOW_SANDBOX_ONLY'));
  }
});

test('disabled or unconfirmed network prevents preparation and checkout dispatch', async () => {
  for (const [changes, code] of [[{RAMPNOW_CHECKOUT_ENABLED: 'false'}, 'RAMPNOW_CHECKOUT_DISABLED'],
    [{RAMPNOW_CHECKOUT_ENABLED: undefined}, 'RAMPNOW_CHECKOUT_DISABLED'],
    [{RAMPNOW_BITCOIN_TEST_NETWORK: undefined}, 'RAMPNOW_NETWORK_CONFIRMATION_REQUIRED'],
    [{RAMPNOW_BITCOIN_TEST_NETWORK: 'mainnet'}, 'RAMPNOW_NETWORK_CONFIRMATION_REQUIRED'],
    [{RAMPNOW_BITCOIN_TEST_NETWORK: 'testnet'}, 'RAMPNOW_NETWORK_MISMATCH']]) {
    const h = fixture(changes);
    await assert.rejects(h.prepare(), errorCode(code));
    assert.equal(h.calls.post.length, 0); assert.equal(h.calls.prepare.length, 0);
  }
});

test('provider must explicitly declare a Bitcoin testnet and eligible India buy route', async () => {
  for (const changes of [{isTestnet: false}, {isTestnet: undefined}, {chain: 'ethereum'},
    {networkClassification: 'mainnet'}]) {
    const h = fixture(); Object.assign(h.provider.chain, changes);
    await assert.rejects(h.prepare(), errorCode('RAMPNOW_NETWORK_CONFIRMATION_REQUIRED'));
    assert.equal(h.calls.post.length, 0);
  }
  for (const mutate of [h => {h.provider.asset.currency = 'ETH';}, h => {h.provider.asset.status = 'inactive';},
    h => {h.provider.asset.buyOrderRange.currency = 'BTC';}, h => {h.provider.asset.payinModes = [];},
    h => {h.provider.countries.countries = [];}, h => {h.provider.countries.countries[0].blockedCurrencies = ['BTC'];}]) {
    const h = fixture(); mutate(h);
    await assert.rejects(h.prepare(), errorCode('RAMPNOW_ROUTE_UNAVAILABLE'));
    assert.equal(h.calls.prepare.length, 0); assert.equal(h.calls.post.length, 0);
  }
});

test('INR limits enforce both bounds and accept a zero unbounded maximum', async () => {
  for (const range of [{minAmount: '1000.01'}, {maxAmount: '999.99'}]) {
    const h = fixture(); Object.assign(h.provider.asset.buyOrderRange, range);
    await assert.rejects(h.prepare(), errorCode('RAMPNOW_AMOUNT_OUT_OF_RANGE'));
    assert.equal(h.calls.quote.length, 0);
  }
  const h = fixture(); Object.assign(h.provider.asset.buyOrderRange, {minAmount: '0', maxAmount: '0'});
  await h.prepare(); assert.equal(h.calls.prepare.length, 1);
});

test('preparation persists hashes and route only while preserving the reviewed destination, amount and fees', async () => {
  const h = fixture(); const review = await h.prepare();
  const normalized = normalizeRampnowBuyInput(input);
  assert.equal(review.destination, input.destination); assert.equal(review.network, 'signet');
  assert.deepEqual(review.quote, {...route, srcAmount: '1000', dstAmount: '0.0001', paymentMode: 'upi', feeDetails: [
    {type: 'platform', fee: '25.5', currency: 'INR', isInclusive: true},
    {type: 'network', fee: '0.000001', currency: 'BTC', isInclusive: false}]});
  const [record] = h.calls.prepare;
  assert.equal(record.requestHash, hashRampnowPayload(normalized));
  assert.equal(record.destinationHash, hashRampnowPayload(input.destination));
  assert.equal(record.quoteHash, hashRampnowPayload(review.quote));
  assert.equal(record.expiresAt - record.createdAt, 120000);
  assert.equal(record.sourceAmount, '1000');
  const stored = JSON.stringify(record);
  for (const value of [...Object.values(input.user), input.destination]) {
    // IN is an approved route constant, not a retained profile field.
    if (value === 'IN') continue;
    assert.equal(stored.includes(value), false);
  }
  assert.equal(Object.hasOwn(record, 'user'), false);
  assert.equal(Object.hasOwn(record, 'destination'), false);
  assert.equal(h.calls.post.length, 0);
});

test('changing reviewed address, amount, profile, network or quote hash cannot submit', async () => {
  const h = fixture(); const review = await h.prepare();
  for (const change of [{destination: address(2)}, {srcAmount: '1001'}, {network: 'testnet'},
    {user: {...input.user, email: 'different@example.com'}}, {user: {...input.user, firstName: 'ChangedName'}}]) {
    await assert.rejects(h.service.submit(owner, {...h.payload(review), input: {...clone(input), ...change}}), errorCode('RAMPNOW_INTENT_CONFLICT'));
  }
  await assert.rejects(h.service.submit(owner, {...h.payload(review), quoteHash: 'a'.repeat(64)}), errorCode('RAMPNOW_INTENT_CONFLICT'));
  assert.equal(h.calls.reserve.length, 0); assert.equal(h.calls.post.length, 0);
});

test('fresh quote changes require a new review before reservation', async () => {
  for (const mutate of [quote => {quote.dstAmount = '0.00009';}, quote => {quote.feeDetails[0].fee = '26';},
    quote => {quote.paymentMode = 'card';}, quote => {quote.feeDetails[0].isInclusive = false;}]) {
    const h = fixture(); const review = await h.prepare(); mutate(h.provider.quote);
    await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_QUOTE_CHANGED'));
    assert.equal(h.calls.reserve.length, 0); assert.equal(h.calls.post.length, 0);
  }
});

test('flag or wallet network changes after review still block submit before reservation', async () => {
  for (const [changes, code] of [[{RAMPNOW_CHECKOUT_ENABLED: 'false'}, 'RAMPNOW_CHECKOUT_DISABLED'],
    [{RAMPNOW_BITCOIN_TEST_NETWORK: undefined}, 'RAMPNOW_NETWORK_CONFIRMATION_REQUIRED'],
    [{RAMPNOW_BITCOIN_TEST_NETWORK: 'testnet'}, 'RAMPNOW_NETWORK_MISMATCH']]) {
    const h = fixture(); const review = await h.prepare(); Object.assign(h.env, changes);
    await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode(code));
    assert.equal(h.calls.reserve.length, 0); assert.equal(h.calls.post.length, 0);
  }
});

test('concurrent submissions reserve once and issue exactly one provider POST', async () => {
  const h = fixture(); const review = await h.prepare();
  const results = await Promise.allSettled(Array.from({length: 12}, () => h.service.submit(owner, h.payload(review))));
  assert.equal(h.calls.post.length, 1);
  assert.equal(h.calls.bind.length, 1);
  assert.ok(results.some(result => result.status === 'fulfilled' && result.value.phase === 'bound'));
  const [submitted] = h.calls.post;
  assert.equal(submitted.externalOrderUid, review.externalOrderUid);
  assert.equal(submitted.paymentMode, 'upi');
  assert.deepEqual(submitted.input, normalizeRampnowBuyInput(input));
  assert.equal(new URL(submitted.returnUrl).searchParams.get('intent'), review.externalOrderUid);
  const again = await h.service.submit(owner, h.payload(review));
  assert.equal(again.phase, 'bound'); assert.equal(again.walletReceiptVerified, false);
  assert.equal(h.calls.post.length, 1);
});

test('timeout leaves an uncertain consumed intent and never retries creation', async () => {
  const h = fixture(); const review = await h.prepare();
  h.createHook = async () => {throw Error('private-upstream-timeout');};
  await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_RECONCILIATION_REQUIRED'));
  assert.equal(h.intents.get(review.externalOrderUid).phase, 'uncertain');
  await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_RECONCILIATION_REQUIRED'));
  assert.equal(h.calls.post.length, 1); assert.equal(h.calls.bind.length, 0);
});

test('bind failure keeps reservation consumed even when marking uncertain also fails', async () => {
  for (const failUncertain of [false, true]) {
    const h = fixture(); const review = await h.prepare(); h.failBind = true; h.failUncertain = failUncertain;
    await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_RECONCILIATION_REQUIRED'));
    assert.equal(h.intents.get(review.externalOrderUid).phase, failUncertain ? 'submitting' : 'uncertain');
    await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_RECONCILIATION_REQUIRED'));
    assert.equal(h.calls.post.length, 1);
  }
});

test('another wallet cannot read, submit or reconcile an intent', async () => {
  const h = fixture(); const review = await h.prepare();
  await assert.rejects(h.service.status(otherOwner, review.externalOrderUid), errorCode('RAMPNOW_INTENT_NOT_FOUND'));
  await assert.rejects(h.service.submit(otherOwner, h.payload(review)), errorCode('RAMPNOW_INTENT_NOT_FOUND'));
  await assert.rejects(h.service.reconcile(otherOwner, review.externalOrderUid), errorCode('RAMPNOW_INTENT_NOT_FOUND'));
  assert.equal(h.calls.find.length, 0); assert.equal(h.calls.post.length, 0);
});

test('a prepared intent is not looked up or rebound', async () => {
  const h = fixture(); const review = await h.prepare();
  assert.equal((await h.service.reconcile(owner, review.externalOrderUid)).reconciliation, 'not_submitted');
  assert.equal(h.calls.find.length, 0); assert.equal(h.calls.bind.length, 0);
});

test('zero or multiple provider lookup matches never bind or create another order', async () => {
  for (const count of [0, 2]) {
    const h = fixture(); const review = await h.prepare(); await h.consume(review);
    h.provider.orders = Array.from({length: count}, (_, index) => h.order({uid: 'order-' + index}));
    const result = await h.service.reconcile(owner, review.externalOrderUid);
    assert.equal(result.reconciliation, count ? 'ambiguous' : 'not_found');
    assert.equal(result.phase, 'uncertain'); assert.equal(result.walletReceiptVerified, false);
    assert.equal(h.calls.bind.length, 0); assert.equal(h.calls.ingest.length, 0); assert.equal(h.calls.post.length, 0);
  }
});

test('lookup route, destination and source amount must match the wallet-bound intent exactly', async () => {
  for (const changes of [{orderType: 'sell'}, {srcCurrency: 'USD'}, {srcChain: 'bitcoin'},
    {dstCurrency: 'ETH'}, {dstChain: 'ethereum'}, {walletAddress: address(2)},
    {srcAmount: '1001'}, {srcAmount: '1e3'}, {uid: 'private/invalid-id'}]) {
    const h = fixture(); const review = await h.prepare(); await h.consume(review);
    h.provider.orders = [h.order(changes)];
    assert.equal((await h.service.reconcile(owner, review.externalOrderUid)).reconciliation, 'mismatch');
    assert.equal(h.calls.bind.length, 0); assert.equal(h.calls.ingest.length, 0); assert.equal(h.calls.post.length, 0);
  }
});

test('unique verified lookup binds with no redirect and ingests authoritative status without wallet credit', async () => {
  const h = fixture(); const review = await h.prepare(); await h.consume(review);
  h.provider.orders = [h.order({email: 'private-provider-profile', bankAccountDetail: {iban: 'private-bank'},
    redirectUrl: 'https://untrusted.invalid', transactionHash: ['private-reference']})];
  const result = await h.service.reconcile(owner, review.externalOrderUid);
  assert.equal(result.reconciliation, 'matched'); assert.equal(result.phase, 'bound');
  assert.equal(result.checkoutUrl, null); assert.equal(result.providerStatus, 'completed');
  assert.equal(result.dstFillAmount, '0.00009500');
  assert.equal(result.walletReceiptVerified, false); assert.equal(result.needsReconciliation, true);
  assert.deepEqual(h.calls.bind[0].binding, {orderUid: 'provider-order-1', checkoutUrl: null});
  const event = h.calls.ingest[0];
  assert.deepEqual(event.payload, {orderUid: 'provider-order-1', externalOrderUid: review.externalOrderUid,
    ...route, orderStatus: 'completed', updateTime: '2026-10-28T12:00:05Z', dstFillAmount: '0.00009500'});
  assert.equal(event.eventUid, 'lookup-' + hashRampnowPayload(event.payload));
  assert.doesNotMatch(JSON.stringify(event), /private|iban|email|transactionHash|walletAddress/);
  assert.equal(h.calls.post.length, 0);
});

test('a bound intent rejects a different provider UID and preserves its known checkout URL on matching lookup', async () => {
  const h = fixture(); const review = await h.prepare(); const submitted = await h.service.submit(owner, h.payload(review));
  h.provider.orders = [h.order({uid: 'different-order'})];
  assert.equal((await h.service.reconcile(owner, review.externalOrderUid)).reconciliation, 'mismatch');
  h.provider.orders = [h.order()];
  const reconciled = await h.service.reconcile(owner, review.externalOrderUid);
  assert.equal(reconciled.checkoutUrl, submitted.checkoutUrl); assert.equal(reconciled.walletReceiptVerified, false);
  assert.equal(h.calls.bind.length, 1); assert.equal(h.calls.post.length, 1);
});

test('invalid lookup settlement fields fail before binding or ingestion', async () => {
  for (const changes of [{updatedAt: 'invalid-date'}, {status: undefined}, {dstFillAmount: '0'}, {dstFillAmount: '0.000000001'}]) {
    const h = fixture(); const review = await h.prepare(); await h.consume(review);
    h.provider.orders = [h.order(changes)];
    await assert.rejects(h.service.reconcile(owner, review.externalOrderUid), errorCode('RAMPNOW_RESPONSE_INVALID'));
    assert.equal(h.calls.bind.length, 0); assert.equal(h.calls.ingest.length, 0);
  }
});

test('expired review is rejected before reservation', async () => {
  const h = fixture(); const review = await h.prepare(); h.advance(120000);
  await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_INTENT_EXPIRED'));
  assert.equal(h.calls.reserve.length, 0); assert.equal(h.calls.post.length, 0);
});

test('expiry during fresh quote is stopped by the atomic reservation clock', async () => {
  const h = fixture(); const review = await h.prepare(); h.quoteHook = async () => {h.advance(120000);};
  await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_INTENT_EXPIRED'));
  assert.equal(h.intents.get(review.externalOrderUid).phase, 'prepared'); assert.equal(h.calls.post.length, 0);
});

test('expiry after reservation consumes the intent but never dispatches an expired checkout', async () => {
  const h = fixture(); const review = await h.prepare(); h.afterReserve = () => h.advance(120000);
  await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_RECONCILIATION_REQUIRED'));
  assert.equal(h.intents.get(review.externalOrderUid).phase, 'uncertain'); assert.equal(h.calls.post.length, 0);
  await assert.rejects(h.service.submit(owner, h.payload(review)), errorCode('RAMPNOW_RECONCILIATION_REQUIRED'));
  assert.equal(h.calls.reserve.length, 1); assert.equal(h.calls.post.length, 0);
});
