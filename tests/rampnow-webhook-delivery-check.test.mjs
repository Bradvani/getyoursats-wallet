import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {checkRampnowWebhookDelivery} from '../server/rampnowWebhookDeliveryCheck.mjs';
import {createWebhookHandler} from '../api/rampnow/webhook.js';
import {createRampnowStore, RAMPNOW_STORE_PREFIX, QUARANTINE_SCRIPT} from '../server/rampnowStore.mjs';

const receiver = 'https://gys-rampnow-sandbox-webhook.vercel.app/api/rampnow/webhook';
const env = {VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/rampnow-integration-20261028',
  RAMPNOW_ENVIRONMENT: 'sandbox', RAMPNOW_API_SECRET: 'private-signing-secret', RAMPNOW_STORAGE_SOURCE: 'upstash_sandbox',
  UPSTASH_REDIS_REST_URL: 'https://sandbox-storage.invalid', UPSTASH_REDIS_REST_TOKEN: 'private-token'};
const clock = Date.parse('2026-10-28T12:00:00Z');
const quarantine = RAMPNOW_STORE_PREFIX + 'quarantine';
const quarantineTime = RAMPNOW_STORE_PREFIX + 'quarantine-time';

function harness({remoteOffset = 17000, httpResult = (_i, response) => response,
  redisResult = value => value, beforeCleanup = () => {}} = {}) {
  const records = new Map([['unrelated-event', 'untouched']]);
  const times = new Map([['unrelated-event', String(Math.floor(clock / 1000))]]);
  const commands = []; const deliveries = [];
  const remoteNow = () => clock + remoteOffset;
  const handler = createWebhookHandler({env, now: remoteNow,
    storeFactory: options => createRampnowStore({...options, fetchImpl})});
  async function fetchImpl(url, options) {
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    if (url === receiver) {
      assert.equal(options.headers.Authorization, undefined);
      assert.ok(Buffer.isBuffer(options.body));
      const req = Readable.from([options.body]); req.method = options.method;
      req.headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]));
      const res = {statusCode: 0, body: '', setHeader() {}, end(body) {this.body = body;}};
      await handler(req, res);
      deliveries.push({status: res.statusCode, event: JSON.parse(options.body)});
      return httpResult(deliveries.length, new Response(res.body, {status: res.statusCode}), {records, times, deliveries});
    }
    assert.equal(url, env.UPSTASH_REDIS_REST_URL + '/');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    const args = JSON.parse(options.body); commands.push(args); let result;
    if (args[0] === 'GET') {assert.match(args[1], /:binding:probe-http-/); result = null;}
    else if (args[0] === 'HGET') {assert.equal(args[1], quarantine); result = records.get(args[2]) ?? null;}
    else if (args[0] === 'ZSCORE') {assert.equal(args[1], quarantineTime); result = times.get(args[2]) ?? null;}
    else if (args[0] === 'EVAL' && args[1] === QUARANTINE_SCRIPT) {
      assert.equal(args[2], 3);
      const id = args[9]; const record = args[10]; const timestamp = args[11];
      assert.match(id, /^probe-http-[a-f0-9-]{36}$/);
      const parsed = JSON.parse(record);
      assert.equal(parsed.classification, 'unbound'); assert.equal(parsed.event.payload.dstFillAmount, '0');
      assert.equal(parsed.event.payload.orderStatus, 'created');
      if (records.has(id)) result = 'DUPLICATE';
      else {records.set(id, record); times.set(id, String(timestamp)); result = 'QUARANTINED';}
    } else if (args[0] === 'EVAL' && args[2] === 2) {
      assert.deepEqual(args.slice(3, 5), [quarantine, quarantineTime]);
      assert.match(args[1], /redis\.call\('HGET'/); assert.match(args[1], /redis\.call\('ZSCORE'/);
      assert.match(args[1], /redis\.call\('HDEL'/); assert.match(args[1], /redis\.call\('ZREM'/);
      assert.doesNotMatch(args[1], /redis\.call\('(DEL|UNLINK|FLUSHDB|FLUSHALL)'/);
      const [id, record, score] = args.slice(5); assert.match(id, /^probe-http-[a-f0-9-]{36}$/);
      beforeCleanup({records, times, id});
      if (records.get(id) === record && times.get(id) === score) {records.delete(id); times.delete(id); result = 1;}
      else result = 0;
    } else assert.fail('unexpected storage command');
    return Response.json({result: redisResult(result, args)});
  }
  return {fetchImpl, now: () => clock, records, times, commands, deliveries};
}

function safeFailure(result) {
  assert.equal(result.status, 'sandbox_webhook_delivery_check_failed');
  assert.equal(result.httpDeliveryVerified, false); assert.equal(result.providerDeliveryVerified, false);
  assert.equal(result.productionReady, false);
  assert.doesNotMatch(JSON.stringify(result), /private|https:|probe-http-|EVENT_STORED|untouched/);
  for (const value of Object.values(result)) assert.ok(typeof value === 'boolean' || typeof value === 'number' || value === result.status);
}

test('exact preview branch and sandbox guards skip before all network access', async () => {
  for (const change of [{VERCEL_ENV: 'production'}, {VERCEL_ENV: ''}, {RAMPNOW_ENVIRONMENT: 'production'},
    {VERCEL_GIT_COMMIT_REF: 'main'}, {VERCEL_GIT_COMMIT_REF: ''}, {VERCEL_GIT_COMMIT_REF: 'feat/rampnow-integration-20261028-other'}]) {
    const result = await checkRampnowWebhookDelivery({...env, ...change}, {fetchImpl: () => assert.fail('network forbidden')});
    assert.equal(result.status, 'skipped_outside_sandbox_preview_branch'); assert.equal(result.httpDeliveryVerified, false);
  }
});
test('missing or invalid credentials stop before receiver and Redis requests', async () => {
  for (const change of [{RAMPNOW_API_SECRET: ''}, {UPSTASH_REDIS_REST_TOKEN: ''},
    {RAMPNOW_STORAGE_SOURCE: 'unknown'}, {UPSTASH_REDIS_REST_URL: 'http://sandbox-storage.invalid'}]) {
    const result = await checkRampnowWebhookDelivery({...env, ...change}, {fetchImpl: () => assert.fail('network forbidden')});
    assert.equal(result.status, 'sandbox_webhook_delivery_not_configured');
  }
});
test('signed HTTP probe accepts bounded remote clock skew and removes only its verified event', async () => {
  const storage = harness(); const result = await checkRampnowWebhookDelivery(env, storage);
  assert.deepEqual(result, {tamperRejected: true, signedEventStored: true, duplicateStable: true, cleanupVerified: true,
    httpDeliveryVerified: true, providerDeliveryVerified: false, productionReady: false,
    tamperedHttpStatus: 401, signedHttpStatus: 200, duplicateHttpStatus: 200, status: 'sandbox_webhook_http_delivery_verified'});
  assert.deepEqual([...storage.records], [['unrelated-event', 'untouched']]);
  assert.deepEqual([...storage.times], [['unrelated-event', String(Math.floor(clock / 1000))]]);
  assert.deepEqual(storage.deliveries.map(item => item.status), [401, 200, 200]);
  assert.equal(storage.commands.filter(args => args[0] === 'GET').length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private|https:|probe-http-/);
});
test('HTTP timeout after durable write is an ambiguous failure with exact-record cleanup', async () => {
  const storage = harness({httpResult(index, response) {if (index === 2) throw Error('private-token https://secret.invalid'); return response;}});
  const result = await checkRampnowWebhookDelivery(env, storage); safeFailure(result);
  assert.equal(result.signedHttpStatus, 0); assert.equal(result.cleanupVerified, true);
  assert.deepEqual([...storage.records], [['unrelated-event', 'untouched']]);
});
test('canonical numeric Redis sorted-set scores also verify consistently', async () => {
  const storage = harness({redisResult: (value, args) => args[0] === 'ZSCORE' && value !== null ? Number(value) : value});
  const result = await checkRampnowWebhookDelivery(env, storage);
  assert.equal(result.status, 'sandbox_webhook_http_delivery_verified'); assert.equal(result.cleanupVerified, true);
  assert.equal(storage.records.size, 1);
});
test('an HTTP error after a write fails delivery and still cleans the owned record', async () => {
  const storage = harness({httpResult: (index, response) => index === 2 ? new Response('private error', {status: 503}) : response});
  const result = await checkRampnowWebhookDelivery(env, storage); safeFailure(result);
  assert.equal(result.signedHttpStatus, 503); assert.equal(result.cleanupVerified, true);
  assert.equal(storage.records.size, 1);
});
test('redirected, oversized, and malformed successful HTTP responses never prove delivery', async () => {
  for (const replace of [
    () => new Response('private redirect', {status: 307, headers: {location: 'https://secret.invalid'}}),
    () => {const response = new Response('{"code":"EVENT_STORED"}'); Object.defineProperty(response, 'redirected', {value: true}); return response;},
    () => new Response('x'.repeat(8193)),
    () => new Response('{"code":"OTHER"}'),
  ]) {
    const storage = harness({httpResult: (index, response) => index === 2 ? replace() : response});
    const result = await checkRampnowWebhookDelivery(env, storage); safeFailure(result);
    assert.equal(result.cleanupVerified, true); assert.equal(storage.records.size, 1);
  }
});
test('wrong readback, unexpected fields, and out-of-window remote timestamps are preserved rather than deleted', async () => {
  for (const mutate of [
    record => {record.event.payload.dstFillAmount = '1';},
    record => {record.extra = 'private';},
    record => {record.receivedAt += 1000;},
  ]) {
    const storage = harness({httpResult(index, response, state) {
      if (index === 2) {const id = state.deliveries.at(-1).event.eventUid; const record = JSON.parse(state.records.get(id)); mutate(record); state.records.set(id, JSON.stringify(record));}
      return response;
    }});
    const result = await checkRampnowWebhookDelivery(env, storage); safeFailure(result);
    assert.equal(result.signedEventStored, false); assert.equal(result.cleanupVerified, false);
    assert.equal(storage.records.size, 2);
    assert.equal(storage.commands.filter(args => args[0] === 'EVAL' && args[2] === 2).length, 0);
    assert.equal(storage.records.get('unrelated-event'), 'untouched');
  }
});
test('duplicate record or sorted score changes fail and cannot delete changed data', async () => {
  for (const mutate of [
    (state, id) => state.records.set(id, 'concurrently-changed'),
    (state, id) => state.times.set(id, '1'),
  ]) {
    const storage = harness({httpResult(index, response, state) {if (index === 3) mutate(state, state.deliveries.at(-1).event.eventUid); return response;}});
    const result = await checkRampnowWebhookDelivery(env, storage); safeFailure(result);
    assert.equal(result.signedEventStored, true); assert.equal(result.duplicateStable, false); assert.equal(result.cleanupVerified, false);
    assert.equal(storage.records.size, 2); assert.equal(storage.records.get('unrelated-event'), 'untouched');
  }
});
test('atomic cleanup refuses data changed between readback and deletion', async () => {
  const storage = harness({beforeCleanup({records, id}) {records.set(id, 'concurrently-changed');}});
  const result = await checkRampnowWebhookDelivery(env, storage); safeFailure(result);
  assert.equal(result.duplicateStable, true); assert.equal(result.cleanupVerified, false);
  assert.equal(storage.records.size, 2); assert.equal(storage.records.get('unrelated-event'), 'untouched');
});
test('invalid signature unexpectedly accepted stops subsequent delivery', async () => {
  const storage = harness({httpResult: (index, response) => index === 1 ? new Response('{"code":"EVENT_STORED"}') : response});
  const result = await checkRampnowWebhookDelivery(env, storage); safeFailure(result);
  assert.equal(result.tamperRejected, false); assert.equal(storage.deliveries.length, 1); assert.equal(storage.records.size, 1);
});
test('Redis response failures and malformed clock return only safe status fields', async () => {
  const storage = harness({redisResult: () => {throw Error('private-token https://secret.invalid');}});
  safeFailure(await checkRampnowWebhookDelivery(env, storage));
  safeFailure(await checkRampnowWebhookDelivery(env, {now: () => Number.MAX_SAFE_INTEGER, fetchImpl: () => assert.fail('network forbidden')}));
});
