import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRampnowStorage} from '../server/rampnowStorageCheck.mjs';

const env = {VERCEL_ENV: 'preview', RAMPNOW_ENVIRONMENT: 'sandbox',
  RAMPNOW_REDIS_REST_URL: 'https://sandbox-storage.invalid', RAMPNOW_REDIS_REST_TOKEN: 'private-token'};
function fakeStorage(transform = value => value) {
  const records = new Map(); const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, env.RAMPNOW_REDIS_REST_URL + '/');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    const args = JSON.parse(options.body); calls.push(args);
    let result;
    if (args[0] === 'GET') result = records.get(args[1])?.value ?? null;
    else if (args[0] === 'TTL') result = records.get(args[1])?.ttl ?? -2;
    else if (args[0] === 'EVAL' && args[1].includes("'CREATED'")) {
      const [, , count, key, value, ttl] = args;
      assert.equal(count, 1); assert.equal(ttl, 120);
      assert.match(key, /^gys:rampnow:\{sandbox\}:probe:[a-f0-9]{48}$/);
      assert.match(value, /^[a-f0-9]{48}$/);
      if (records.has(key)) result = records.get(key).value === value ? 'DUPLICATE' : 'COLLISION';
      else { records.set(key, {value, ttl}); result = 'CREATED'; }
    } else if (args[0] === 'EVAL' && args[1].includes("'DEL'")) {
      const [, , count, key, value] = args; assert.equal(count, 1);
      result = records.get(key)?.value === value ? Number(records.delete(key)) : 0;
    } else assert.fail('unexpected command');
    return Response.json({result: transform(result, args, calls.length)});
  };
  return {records, calls, fetchImpl};
}

test('storage probe skips production and refuses missing dedicated configuration without network', async () => {
  for (const change of [{VERCEL_ENV: 'production'}, {RAMPNOW_ENVIRONMENT: 'production'},
    {RAMPNOW_REDIS_REST_TOKEN: ''}, {RAMPNOW_REDIS_REST_URL: 'redis://wrong.invalid'},
    {RAMPNOW_REDIS_REST_URL: 'https://wrong.invalid/path'}, {RAMPNOW_REDIS_REST_URL: 'https://user:password@wrong.invalid'},
    {RAMPNOW_REDIS_REST_URL: undefined, KV_REST_API_URL: 'https://production.invalid', KV_REST_API_TOKEN: 'production'}]) {
    const result = await checkRampnowStorage({...env, ...change}, {fetchImpl: () => {assert.fail('network is forbidden');}});
    assert.equal(result.configured, false);
    assert.equal(result.connected, false);
  }
});
test('probe verifies expiring atomic write/read, duplicate rejection and cleanup with random isolated keys', async () => {
  const storage = fakeStorage();
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await checkRampnowStorage(env, storage), {configured: true, connected: true,
      atomicRoundTrip: true, duplicateRejected: true, cleanupVerified: true, status: 'sandbox_storage_verified'});
  }
  assert.equal(storage.records.size, 0);
  assert.notEqual(storage.calls[0][3], storage.calls[6][3]);
  assert.equal(storage.calls.length, 12);
});
test('wrong stored value, missing TTL and broken duplicate semantics fail the probe and clean its key', async () => {
  for (const transform of [
    (result, args) => args[0] === 'GET' && result !== null ? 'wrong-value' : result,
    (result, args) => args[0] === 'TTL' ? -1 : result,
    result => result === 'DUPLICATE' ? 'CREATED' : result,
  ]) {
    const storage = fakeStorage(transform);
    const result = await checkRampnowStorage(env, storage);
    assert.equal(result.status, 'sandbox_storage_check_failed');
    assert.equal(result.cleanupVerified, false);
    assert.equal(storage.records.size, 0);
  }
});
test('failed or ambiguous cleanup cannot be reported as verified', async () => {
  const storage = fakeStorage((result, args) => args[0] === 'EVAL' && args[1].includes("'DEL'") ? 0 : result);
  const result = await checkRampnowStorage(env, storage);
  assert.equal(result.status, 'sandbox_storage_check_failed');
  assert.equal(result.cleanupVerified, false);
});
test('provider errors, redirects, oversized responses and exceptions never expose credentials', async () => {
  for (const response of [() => new Response('private-token', {status: 401}),
    () => Response.json({error: 'private-token'}), () => new Response('private-token'),
    () => new Response('private-token'.repeat(1000)), () => {throw new Error(env.RAMPNOW_REDIS_REST_URL + 'private-token');},
    () => ({ok: true, redirected: true, body: new ReadableStream()}),
  ]) {
    let calls = 0;
    const result = await checkRampnowStorage(env, {fetchImpl: async () => {calls++; return response();}});
    assert.equal(result.status, 'sandbox_storage_check_failed');
    assert.doesNotMatch(JSON.stringify(result), /private-token|sandbox-storage\.invalid|probe:/);
    assert.equal(calls, 2); // Initial request plus bounded, compare-and-delete cleanup.
  }
});
