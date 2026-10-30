import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRampnowWebhook} from '../server/rampnowWebhookCheck.mjs';
import {RAMPNOW_STORE_PREFIX, QUARANTINE_SCRIPT} from '../server/rampnowStore.mjs';

const env = {VERCEL_ENV: 'preview', RAMPNOW_ENVIRONMENT: 'sandbox', RAMPNOW_API_SECRET: 'private-signing-secret',
  RAMPNOW_REDIS_REST_URL: 'https://sandbox-storage.invalid', RAMPNOW_REDIS_REST_TOKEN: 'private-token'};
const now = () => Date.parse('2026-10-28T12:00:00Z');
function fakeStorage(transform = value => value) {
  const records = new Map([['unrelated-event', 'untouched']]);
  const times = new Map([['unrelated-event', '1']]);
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, env.RAMPNOW_REDIS_REST_URL + '/');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.equal(options.redirect, 'error');
    const args = JSON.parse(options.body); calls.push(args); let result;
    if (args[0] === 'GET') { assert.match(args[1], /:binding:probe-/); result = null; }
    else if (args[0] === 'HGET') { assert.equal(args[1], RAMPNOW_STORE_PREFIX + 'quarantine'); result = records.get(args[2]) ?? null; }
    else if (args[0] === 'ZSCORE') { assert.equal(args[1], RAMPNOW_STORE_PREFIX + 'quarantine-time'); result = times.get(args[2]) ?? null; }
    else if (args[0] === 'EVAL' && args[1] === QUARANTINE_SCRIPT) {
      assert.equal(args[2], 3);
      const id = args[9]; const record = args[10]; const clock = args[11];
      assert.match(id, /^probe-[a-f0-9-]{36}$/);
      const data = JSON.parse(record); assert.equal(data.classification, 'unbound');
      assert.equal(data.event.payload.orderStatus, 'created'); assert.equal(data.event.payload.dstFillAmount, '0');
      if (records.has(id)) result = 'DUPLICATE';
      else { records.set(id, record); times.set(id, String(clock)); result = 'QUARANTINED'; }
    } else if (args[0] === 'EVAL' && args[1].includes("'HDEL'")) {
      assert.equal(args[2], 2); const id = args[5]; const record = args[6];
      assert.match(id, /^probe-[a-f0-9-]{36}$/);
      if (records.get(id) === record) { records.delete(id); times.delete(id); result = 1; } else result = 0;
    } else assert.fail('unexpected command');
    return Response.json({result: transform(result, args)});
  };
  return {records, times, calls, fetchImpl, now};
}

test('self-test skips production and missing sandbox credentials without a request', async () => {
  for (const change of [{VERCEL_ENV: 'production'}, {RAMPNOW_ENVIRONMENT: 'production'},
    {RAMPNOW_REDIS_REST_TOKEN: ''}, {RAMPNOW_API_SECRET: ''}]) {
    const result = await checkRampnowWebhook({...env, ...change}, {fetchImpl: () => assert.fail('request forbidden')});
    assert.equal(result.signedEventStored, false); assert.equal(result.productionReady, false);
  }
});
test('actual handler rejects tampering, persists a signed probe, deduplicates and cleans only that probe', async () => {
  const storage = fakeStorage();
  const result = await checkRampnowWebhook(env, storage);
  assert.deepEqual(result, {tamperRejected: true, signedEventStored: true, duplicateStable: true,
    cleanupVerified: true, providerDeliveryVerified: false, productionReady: false, status: 'sandbox_webhook_selftest_verified'});
  assert.deepEqual([...storage.records], [['unrelated-event', 'untouched']]);
  assert.deepEqual([...storage.times], [['unrelated-event', '1']]);
  assert.equal(storage.calls.filter(args => args[0] === 'GET').length, 2); // No store access for bad signature.
  assert.doesNotMatch(JSON.stringify(result), /private|sandbox-storage|probe-/);
});
test('readback mismatch or unstable duplicate fails verification and compares before cleanup', async () => {
  for (const transform of [
    (result, args) => args[0] === 'HGET' && result !== null ? 'mismatched-record' : result,
    (result, args) => args[0] === 'ZSCORE' && result !== null ? '0' : result,
  ]) {
    const storage = fakeStorage(transform); const result = await checkRampnowWebhook(env, storage);
    assert.equal(result.status, 'sandbox_webhook_check_failed'); assert.equal(result.cleanupVerified, false);
    assert.deepEqual([...storage.records], [['unrelated-event', 'untouched']]);
  }
});
test('failed persistence and unavailable cleanup return sanitized failure with no success claims', async () => {
  for (const fetchImpl of [async () => Response.json({error: 'private-token'}),
    async () => {throw Error('private-token https://sandbox-storage.invalid');},
    async () => new Response('private-signing-secret', {status: 401})]) {
    const result = await checkRampnowWebhook(env, {fetchImpl, now});
    assert.equal(result.tamperRejected, true); assert.equal(result.signedEventStored, false);
    assert.equal(result.status, 'sandbox_webhook_check_failed');
    assert.doesNotMatch(JSON.stringify(result), /private|sandbox-storage|probe-/);
  }
});
test('cleanup must be confirmed and unknown storage records are preserved', async () => {
  const storage = fakeStorage((result, args) => args[0] === 'EVAL' && args[2] === 2 ? 0 : result);
  const result = await checkRampnowWebhook(env, storage);
  assert.equal(result.signedEventStored, true); assert.equal(result.cleanupVerified, false);
  assert.equal(result.status, 'sandbox_webhook_check_failed');
  assert.equal(storage.records.get('unrelated-event'), 'untouched');
});
