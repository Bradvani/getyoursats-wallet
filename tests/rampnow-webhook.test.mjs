import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createWebhookHandler, config} from '../api/rampnow/webhook.js';
import {rampnowSignature} from '../server/rampnow.mjs';
import {createRampnowStore, normalizeRampnowEvent, sandboxRampnowConfig} from '../server/rampnowStore.mjs';

const env = {VERCEL_ENV: 'preview', RAMPNOW_ENVIRONMENT: 'sandbox', RAMPNOW_API_SECRET: 'test-only-secret',
  RAMPNOW_REDIS_REST_URL: 'https://sandbox-storage.invalid', RAMPNOW_REDIS_REST_TOKEN: 'test-only-token'};
const now = () => Date.parse('2026-10-28T12:00:00Z');

test('alternate sandbox credentials require explicit source and never mix pairs or fall back', () => {
  const alternate = {VERCEL_ENV: 'preview', RAMPNOW_ENVIRONMENT: 'sandbox',
    UPSTASH_REDIS_REST_URL: 'https://dedicated-test.invalid', UPSTASH_REDIS_REST_TOKEN: 'test-token'};
  assert.throws(() => sandboxRampnowConfig(alternate), /STORE_UNAVAILABLE/);
  assert.deepEqual(sandboxRampnowConfig({...alternate, RAMPNOW_STORAGE_SOURCE: 'upstash_sandbox'}),
    {url: 'https://dedicated-test.invalid/', token: 'test-token'});
  for (const patch of [{RAMPNOW_STORAGE_SOURCE: 'unknown'}, {UPSTASH_REDIS_REST_TOKEN: undefined},
    {VERCEL_ENV: 'production'}, {RAMPNOW_ENVIRONMENT: 'production'}]) {
    assert.throws(() => sandboxRampnowConfig({...env, ...alternate, RAMPNOW_STORAGE_SOURCE: 'upstash_sandbox', ...patch}));
  }
});
const event = () => ({eventUid: 'event-1', eventType: 'ramp_order.status_change', payload: {
  orderUid: 'order-1', externalOrderUid: 'intent-1', orderType: 'buy', orderStatus: 'created',
  srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin',
  dstFillAmount: '0', updateTime: '2026-10-28T12:00:00Z', walletAddress: 'private-address',
  email: 'private@example.invalid', cryptoAccountDetail: {identity: 'private-identity'}, transactionHash: 'private-reference',
}});
function request(body = Buffer.from(JSON.stringify(event())), overrides = {}) {
  const req = Readable.from([body.subarray(0, 7), body.subarray(7)]);
  const ts = String(now() / 1000);
  return Object.assign(req, {method: 'POST', headers: {'content-length': String(body.length),
    'x-rampnow-timestamp': ts, 'x-rampnow-sign': rampnowSignature(env.RAMPNOW_API_SECRET, ts, 'POST', '/api/rampnow/webhook', body)}, ...overrides});
}
function response() {
  return {headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); }};
}
async function call(req, options = {}) {
  let stored = 0;
  const handler = createWebhookHandler({env, now, storeFactory: () => ({async ingest(value) {
    normalizeRampnowEvent(value); stored++; return 'QUARANTINED';
  }}), ...options});
  const res = response(); await handler(req, res); return {...res, stored};
}

test('webhook accepts exact signed stream only after durable storage without exposing settlement', async () => {
  assert.equal(config.api.bodyParser, false);
  const result = await call(request());
  assert.equal(result.statusCode, 200); assert.equal(result.stored, 1);
  assert.deepEqual(result.body, {code: 'EVENT_STORED'});
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('webhook rejects production, missing environment and missing dedicated store without ingest', async () => {
  for (const patch of [{VERCEL_ENV: 'production'}, {RAMPNOW_ENVIRONMENT: 'production'}, {RAMPNOW_ENVIRONMENT: undefined},
    {RAMPNOW_REDIS_REST_TOKEN: undefined, KV_REST_API_TOKEN: 'do-not-use'}, {RAMPNOW_API_SECRET: ''}]) {
    const result = await call(request(), {env: {...env, ...patch}});
    assert.equal(result.statusCode, 503); assert.equal(result.stored, 0);
  }
  for (const endpoint of ['http://storage.invalid', 'https://user:password@storage.invalid', 'https://storage.invalid/path', 'https://storage.invalid/?token=private']) {
    assert.throws(() => sandboxRampnowConfig({...env, RAMPNOW_REDIS_REST_URL: endpoint}), /STORE_UNAVAILABLE/);
  }
});

test('webhook verifies signature and replay window before parsing JSON', async () => {
  for (const patch of [{'x-rampnow-sign': '0'.repeat(64)}, {'x-rampnow-timestamp': String(now() / 1000 - 301)},
    {'x-rampnow-sign': ['a'.repeat(64)]}]) {
    const req = request(Buffer.from('{invalid-json')); Object.assign(req.headers, patch);
    const result = await call(req); assert.equal(result.statusCode, 401); assert.equal(result.stored, 0);
  }
  const altered = request(Buffer.from(JSON.stringify({...event(), eventUid: 'tampered'})));
  altered.headers['x-rampnow-sign'] = request().headers['x-rampnow-sign'];
  assert.equal((await call(altered)).statusCode, 401);
});

test('signature uses configured endpoint path, not proxy-rewritten request URL', async () => {
  const req = request(); req.url = '/rewritten?attacker=1';
  assert.equal((await call(req)).statusCode, 200);
});

test('signed malformed JSON and invalid event do not reach successful acknowledgement', async () => {
  for (const body of [Buffer.from('{invalid-json'), Buffer.from('{"eventType":"another_event"}'), Buffer.from([0xff, 0xfe])]) {
    const result = await call(request(body)); assert.equal(result.statusCode, 400); assert.equal(result.stored, 0);
  }
});

test('body limit applies to declared and streaming bytes; parsed body is never used', async () => {
  const huge = Buffer.alloc(65537, 0x61);
  for (const req of [request(huge), request(huge, {headers: {}}), {method: 'POST', headers: {}, body: event()}]) {
    const result = await call(req); assert.ok([400, 413].includes(result.statusCode)); assert.equal(result.stored, 0);
  }
  const req = request();
  Object.defineProperty(req, 'body', {get() { assert.fail('Vercel lazy JSON parser must never be accessed'); }});
  assert.equal((await call(req)).statusCode, 200);
});

test('method rejection and persistence failure never produce 2xx or private error output', async () => {
  assert.equal((await call(request(undefined, {method: 'GET'}))).statusCode, 405);
  const result = await call(request(), {storeFactory: () => ({async ingest() { throw new Error('private redis token and body'); }})});
  assert.equal(result.statusCode, 503); assert.deepEqual(result.body, {code: 'WEBHOOK_UNAVAILABLE'});
});

test('quarantine normalization excludes every address, identity and payout field', () => {
  const normalized = normalizeRampnowEvent(event());
  const text = JSON.stringify(normalized);
  for (const privateValue of ['private-address', 'private@example.invalid', 'private-identity', 'private-reference', 'walletAddress']) assert.equal(text.includes(privateValue), false);
  assert.equal(normalized.payload.orderStatus, 'created');
  assert.equal(Object.hasOwn(normalized, 'phase'), false);
});

test('malformed event IDs, timestamps, route strings and fill amounts fail validation', () => {
  for (const patch of [{externalOrderUid: '../other'}, {orderType: 'payout'}, {updateTime: '2026-10-28'},
    {srcChain: 'https://malicious.invalid'}, {dstFillAmount: '-1'}, {orderStatus: 'completed', dstFillAmount: '0'}]) {
    const input = event(); Object.assign(input.payload, patch);
    assert.throws(() => normalizeRampnowEvent(input), /EVENT_INVALID/);
  }
});

test('store sanitizes failed HTTP, malformed, oversized and network responses without retries', async () => {
  for (const fetchResult of [() => new Response('private upstream body', {status: 500}),
    () => new Response('{'), () => Response.json({error: 'private redis error'}),
    () => Response.json({result: 'x'.repeat(70000)}), () => { throw new Error('private network details'); }]) {
    let count = 0;
    const store = createRampnowStore({env, now, fetchImpl: async (url, options) => {
      count++; assert.equal(url, 'https://sandbox-storage.invalid/'); assert.equal(options.redirect, 'error');
      return fetchResult();
    }});
    await assert.rejects(store.ingest(event()), error => error.message === 'RAMPNOW_STORE_UNAVAILABLE');
    assert.equal(count, 1);
  }
});
