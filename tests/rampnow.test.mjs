import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRampnowOrderEvent, bitcoinQuoteRequest, createRampnowClient, decimalAmount,
  rampnowSignature, verifyRampnowWebhook, validateBitcoinQuote, rampnowOrderState } from '../server/rampnow.mjs';

const secret = 'test-secret-key';
const timestamp = '1772080882';
const quoteBody = '{"orderType":"buy","srcAmount":"100","srcCurrency":"EUR","srcChain":"fiat","dstCurrency":"ETH","dstChain":"ethereum"}';
test('matches official API authentication vector byte-for-byte', () => {
  assert.equal(rampnowSignature(secret, timestamp, 'POST', '/api/partner/v1/ext/ramp_order/quote', quoteBody),
    '369afe98d71b99e4121f88643b38956d6bc8c23376426fb2c80b7ba2e6961243');
});

const webhookBody = Buffer.from('{"createdAt":"2026-10-01T12:00:02Z","eventUid":"853d470c-db91-4c6e-9724-acfccd138306","eventType":"ramp_order.status_change","payload":{"orderUid":"5de57551-3272-4af5-86a4-5eeae6ccc37f","createTime":"2026-10-01T11:58:40Z","updateTime":"2026-10-01T12:00:00Z","externalOrderUid":"your-order-1001","orderType":"buy","orderStatus":"created","paymentStatus":"created","paymentMode":"card","srcCurrency":"EUR","srcChain":"fiat","srcAmount":"250","dstCurrency":"ETH","dstChain":"ethereum","dstAmount":"0.0812","dstFillAmount":"0","walletAddress":"0x535ebf73d0E20db0A72509207599C816510e11C9","walletAddressTag":"","feeDetails":[{"type":"platform","fee":"4.5","currency":"EUR","isInclusive":true},{"type":"network","fee":"0.8","currency":"EUR","isInclusive":true},{"type":"partner","fee":"2.5","currency":"EUR","isInclusive":true}],"partnerFee":"2.71","partnerCurrency":"USDC","cryptoAccountDetail":{"custodyType":"unhosted","address":"0x535ebf73d0E20db0A72509207599C816510e11C9"}}}');
const hookArgs = { secret, timestamp, rawBody: webhookBody, path: '/rampnow/webhook', now: Number(timestamp) * 1000,
  signature: '79ae56d41cc58a6bf20b45405eec78115944831dcd2f37a061a30754b4aead9f' };
test('matches official webhook vector and verifies hex signature', () => {
  assert.equal(rampnowSignature(secret, timestamp, 'POST', hookArgs.path, webhookBody), hookArgs.signature);
  assert.equal(verifyRampnowWebhook(hookArgs), true);
  assert.equal(verifyRampnowWebhook({ ...hookArgs, signature: hookArgs.signature.toUpperCase() }), true);
});
for (const [label, changes] of [
  ['modified bytes', { rawBody: Buffer.concat([webhookBody, Buffer.from(' ')]) }],
  ['wrong path', { path: '/wrong/path' }], ['wrong secret', { secret: 'other-secret' }],
  ['old timestamp', { now: hookArgs.now + 301000 }], ['future timestamp', { now: hookArgs.now - 301000 }],
  ['missing timestamp', { timestamp: undefined }], ['non-hex signature', { signature: 'g'.repeat(64) }],
  ['short signature', { signature: '00' }], ['parsed/reserialized body', { rawBody: webhookBody.toString() }],
  ['oversized body', { rawBody: Buffer.alloc(65537) }], ['invalid clock', { now: NaN }],
]) test('rejects webhook ' + label, () => assert.equal(verifyRampnowWebhook({ ...hookArgs, ...changes }), false));

const expected = { orderUid: 'provider-1', externalOrderUid: 'gys-1', orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin' };
function event(status, second = 0, extra = {}) {
  return { eventUid: 'event-' + status + '-' + second, eventType: 'ramp_order.status_change',
    payload: { ...expected, orderStatus: status, updateTime: `2026-10-28T10:00:${String(second).padStart(2, '0')}Z`,
      dstAmount: '0.001', dstFillAmount: status === 'completed' ? '0.0009' : '0', ...extra } };
}
test('failed is delayed and can progress to completed using actual fill', () => {
  const delayed = applyRampnowOrderEvent(null, event('failed'), expected);
  assert.equal(delayed.phase, 'delayed');
  const completed = applyRampnowOrderEvent(delayed, event('completed', 1), expected);
  assert.equal(completed.phase, 'provider_completed');
  assert.equal(completed.dstFillAmount, '0.0009');
  assert.equal(completed.needsReconciliation, true);
});
for (const status of ['expired', 'payment_failed']) test('keeps observing late payment after ' + status, () => {
  const previous = applyRampnowOrderEvent(null, event(status), expected);
  assert.equal(previous.keepObserving, true);
  assert.equal(applyRampnowOrderEvent(previous, event('processing', 1), expected).phase, 'pending');
});
test('unknown future statuses remain pending', () => assert.equal(rampnowOrderState('new_review_stage').phase, 'pending'));
test('duplicate and older events never regress the displayed order', () => {
  const e = event('completed', 2);
  const previous = applyRampnowOrderEvent(null, e, expected);
  assert.equal(applyRampnowOrderEvent(previous, e, expected), previous);
  assert.equal(applyRampnowOrderEvent(previous, event('processing', 1), expected), previous);
});
test('conflicting equal timestamps require reconciliation without replacement', () => {
  const previous = applyRampnowOrderEvent(null, event('processing', 1), expected);
  assert.equal(applyRampnowOrderEvent(previous, event('completed', 1), expected).status, 'processing');
});
test('event must match the recorded provider order, external ID, direction and asset', () => {
  for (const key of Object.keys(expected)) assert.throws(() => applyRampnowOrderEvent(null,
    event('completed', 0, { [key]: 'other' }), expected), /RAMPNOW_ORDER_MISMATCH/);
  assert.throws(() => applyRampnowOrderEvent(null, event('completed'), {}), /RAMPNOW_BINDING_REQUIRED/);
});
test('completed without a positive whole-sat fill is not accepted', () => {
  for (const amount of ['0', '-1', '1e-8', '0.000000001', undefined]) {
    assert.throws(() => applyRampnowOrderEvent(null, event('completed', 0, { dstFillAmount: amount }), expected), /RAMPNOW_FILL_INVALID/);
  }
});
test('normalized status stores no bank, wallet, email, KYC or payout reference', () => {
  const result = applyRampnowOrderEvent(null, event('completed', 0, { walletAddress: 'private-address',
    bankAccountDetail: { iban: 'private-iban' }, email: 'private-email', transactionHash: ['private-reference'] }), expected);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

const config = { environment: 'sandbox', apiKey: 'dummy-test-key', apiSecret: secret, now: () => Number(timestamp) * 1000 };
const response = data => new Response(JSON.stringify({ code: 0, data }), { headers: { 'content-type': 'application/json' } });
test('signed GET targets only the chosen host and covers the exact query', async () => {
  const calls = [];
  const client = createRampnowClient({ ...config, fetchImpl: async (...args) => { calls.push(args); return response({}); } });
  await client.getBitcoinAsset('INR');
  const [url, init] = calls[0];
  const path = '/api/partner/v1/ext/ramp_order/asset_config?currency=BTC&chain=bitcoin&orderCurrency=INR';
  assert.equal(url, 'https://api.sandbox.rampnow.io' + path);
  assert.equal(init.headers['X-RAMPNOW-SIGN'], rampnowSignature(secret, timestamp, 'GET', path));
  assert.equal(init.redirect, 'error');
  assert.equal(init.body, undefined);
  assert.equal(client.createOrder, undefined);
  assert.equal(client.request, undefined);
});
test('production host requires explicit environment; missing credentials fail closed', () => {
  for (const changes of [{ environment: undefined }, { environment: 'https://attacker.test' }, { apiKey: '' }, { apiSecret: '' }]) {
    assert.throws(() => createRampnowClient({ ...config, ...changes }));
  }
});
test('request errors are sanitized and not automatically retried', async () => {
  let calls = 0;
  const client = createRampnowClient({ ...config, fetchImpl: async () => { calls++; throw new Error('private-key-and-customer-data'); } });
  await assert.rejects(client.getConfig(), error => error.message === 'RAMPNOW_UPSTREAM_UNAVAILABLE' && !error.cause);
  assert.equal(calls, 1);
});
for (const [label, res] of [
  ['application error', () => new Response('{"code":100001,"data":{},"message":"private-key"}')],
  ['HTTP redirect', () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } })],
  ['invalid JSON', () => new Response('private malformed response')],
  ['large response', () => new Response('x'.repeat(2 * 1024 * 1024 + 1))],
]) test('rejects ' + label + ' without exposing provider content', async () => {
  const client = createRampnowClient({ ...config, fetchImpl: async () => res() });
  await assert.rejects(client.getConfig(), error => !error.message.includes('private') && error.code.startsWith('RAMPNOW_'));
});
test('order lookup retains multiple matches rather than choosing or resubmitting', async () => {
  const orders = [{ orderUid: 'a' }, { orderUid: 'b' }];
  const client = createRampnowClient({ ...config, fetchImpl: async () => response({ orderList: orders }) });
  assert.deepEqual(await client.findOrders('gys-1'), orders);
  await assert.rejects(client.findOrders('../checkout?submit=true'), /RAMPNOW_ORDER_ID_INVALID/);
});
test('quote generation binds BTC to Bitcoin and preserves decimal strings', () => {
  const buy = bitcoinQuoteRequest({ orderType: 'buy', fiatCurrency: 'INR', srcAmount: '1000' });
  const sell = bitcoinQuoteRequest({ orderType: 'sell', fiatCurrency: 'INR', srcAmount: '0.00000001' });
  assert.equal(buy.dstCurrency, 'BTC'); assert.equal(buy.dstChain, 'bitcoin');
  assert.equal(sell.srcCurrency, 'BTC'); assert.equal(sell.srcAmount, '0.00000001');
  for (const amount of ['-1', 'NaN', '0', '1e-8', '0.000000001', ' 1', '01', 1]) {
    assert.throws(() => bitcoinQuoteRequest({ orderType: 'sell', fiatCurrency: 'INR', srcAmount: amount }));
  }
  assert.equal(decimalAmount('9007199254740993.12'), true);
});
test('quote validates amount, route, mode and explicit fee breakdown', async () => {
  const request = bitcoinQuoteRequest({ orderType: 'buy', fiatCurrency: 'INR', srcAmount: '1000', paymentMode: 'upi' });
  const quote = { ...request, srcAmount: '1000.00', dstAmount: '0.0001', feeDetails: [{ type: 'platform', fee: '35', currency: 'INR', isInclusive: true }] };
  assert.equal(validateBitcoinQuote(quote, request), quote);
  for (const changes of [{ dstChain: 'ethereum' }, { srcAmount: '10000' }, { feeDetails: undefined },
    { paymentMode: 'card' }, { dstAmount: '0.000000001' },
    { feeDetails: [{ type: 'platform', fee: '-1', currency: 'INR', isInclusive: true }] }]) {
    assert.throws(() => validateBitcoinQuote({ ...quote, ...changes }, request));
  }
  const client = createRampnowClient({ ...config, fetchImpl: async (_url, init) => {
    assert.equal(init.headers['X-RAMPNOW-SIGN'], rampnowSignature(secret, timestamp, 'POST', '/api/partner/v1/ext/ramp_order/quote', init.body));
    assert.equal(JSON.parse(init.body).srcAmount, '1000'); return response(quote);
  } });
  assert.deepEqual(await client.getBitcoinQuote({ orderType: 'buy', fiatCurrency: 'INR', srcAmount: '1000', paymentMode: 'upi' }), quote);
});
