import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRampnowCallbacks} from '../server/rampnowCallbackCheck.mjs';
import {RAMPNOW_STORE_PREFIX} from '../server/rampnowStore.mjs';

const env = {VERCEL_ENV: 'preview', RAMPNOW_ENVIRONMENT: 'sandbox',
  VERCEL_GIT_COMMIT_REF: 'feat/rampnow-integration-20261028', VERCEL_PROJECT_ID: 'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa',
  RAMPNOW_REDIS_REST_URL: 'https://private-storage.invalid', RAMPNOW_REDIS_REST_TOKEN: 'private-token'};
const clock = Date.parse('2026-10-29T12:00:00Z');
const now = () => clock;
function record(id = 'private-event', receivedAt = clock / 1000) {
  return {classification: 'unbound', receivedAt, event: {eventUid: id, eventType: 'ramp_order.status_change', payload: {
    orderUid: 'private-order', externalOrderUid: 'private-external', orderType: 'buy', orderStatus: 'created',
    srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin',
    dstFillAmount: '0', updateTime: new Date(clock).toISOString(),
  }}};
}
function store(entries) {
  let calls = 0;
  return {now, get calls() {return calls;}, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, env.RAMPNOW_REDIS_REST_URL + '/');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), ['HGETALL', RAMPNOW_STORE_PREFIX + 'quarantine']);
    return Response.json({result: entries.flatMap(([field, value]) => [field, typeof value === 'string' ? value : JSON.stringify(value)])});
  }};
}
function sanitized(report) {
  assert.equal(report.productionReady, false);
  assert.doesNotMatch(JSON.stringify(report), /private-|probe-|walletAddress|token|https:/);
  assert.equal(Object.hasOwn(report, 'verifiedCallbackPresent'), false);
  for (const [key, value] of Object.entries(report)) {
    if (key === 'status') assert.equal(typeof value, 'string');
    else assert.ok(typeof value === 'boolean' || (Number.isSafeInteger(value) && value >= 0));
  }
}

test('callback inspection requires the exact sandbox wallet preview branch and dedicated storage', async () => {
  for (const patch of [{VERCEL_ENV: 'production'}, {RAMPNOW_ENVIRONMENT: 'production'},
    {VERCEL_GIT_COMMIT_REF: 'main'}, {VERCEL_GIT_COMMIT_REF: undefined}, {VERCEL_PROJECT_ID: undefined},
    {VERCEL_PROJECT_ID: 'prj_A4rcsAjtYNd6RgdyJoo8zrTLFa1P'}, {RAMPNOW_REDIS_REST_TOKEN: ''},
    {RAMPNOW_REDIS_REST_URL: undefined, KV_REST_API_URL: 'https://production.invalid', KV_REST_API_TOKEN: 'private-other'}]) {
    const report = await checkRampnowCallbacks({...env, ...patch}, {now, fetchImpl() {assert.fail('must not contact storage');}});
    assert.equal(report.configured, false); assert.equal(report.checked, false); sanitized(report);
  }
});

test('one read-only query counts recent normalized non-probe candidates without revealing records', async () => {
  const recent = record(); const stale = record('private-stale', clock / 1000 - 86401);
  const storage = store([['private-event', recent], ['private-stale', stale]]);
  const report = await checkRampnowCallbacks(env, storage);
  assert.equal(storage.calls, 1);
  assert.deepEqual(report, {configured: true, checked: true, existingRecordCandidatePresent: true,
    providerCallbackCandidatePresent: true, providerCallbackCandidateCount: 1, scannedEntryCount: 2,
    excludedProbeCount: 0, staleEntryCount: 1, invalidEntryCount: 0, productionReady: false,
    status: 'sandbox_callback_candidates_found'});
  sanitized(report);
});

test('probe prefixes in any identifier are excluded, including HTTP probes and uppercase variants', async () => {
  const values = [record('probe-selftest'), record('probe-http-test'), record('PROBE-other'), record('private-four'), record('private-five')];
  values[3].event.payload.orderUid = 'probe-http-order';
  values[4].event.payload.externalOrderUid = 'probe-external';
  const storage = store(values.map(value => [value.event.eventUid, value]));
  const report = await checkRampnowCallbacks(env, storage);
  assert.equal(report.checked, true); assert.equal(report.excludedProbeCount, 5);
  assert.equal(report.providerCallbackCandidateCount, 0); assert.equal(report.providerCallbackCandidatePresent, false);
  assert.equal(report.existingRecordCandidatePresent, false); sanitized(report);
});

test('invalid schema, extra private fields, mismatched keys and implausible times only increment invalid counts', async () => {
  const values = Array.from({length: 8}, (_, i) => record('private-' + i));
  values[0].event.payload.walletAddress = 'private-address';
  values[1].event.eventType = 'wrong_event';
  values[2].event.payload.dstFillAmount = '-1';
  values[3].classification = 'bound';
  values[4].receivedAt = clock / 1000 + 121;
  values[5].receivedAt = 'private-not-time';
  values[6].event.eventUid = 'private-other-key';
  values[7].extra = 'private-data';
  const entries = values.map((value, i) => ['private-' + i, value]);
  entries.push(['private-malformed', '{bad private-json'], ['private-large', 'private-'.repeat(600)]);
  const report = await checkRampnowCallbacks(env, store(entries));
  assert.equal(report.checked, true); assert.equal(report.invalidEntryCount, 10);
  assert.equal(report.providerCallbackCandidatePresent, false); sanitized(report);
});

test('empty or stale-only storage reports absence of recent candidates, without claiming registration failed', async () => {
  for (const entries of [[], [['private-old', record('private-old', clock / 1000 - 86401)]]]) {
    const report = await checkRampnowCallbacks(env, store(entries));
    assert.equal(report.status, 'sandbox_no_recent_callback_candidates');
    assert.equal(report.providerCallbackCandidatePresent, false);
    assert.equal(report.existingRecordCandidatePresent, entries.length > 0);
    sanitized(report);
  }
  const report = await checkRampnowCallbacks(env, store([['private-boundary', record('private-boundary', clock / 1000 - 86400)]]));
  assert.equal(report.providerCallbackCandidateCount, 1);
});

test('oversized streams, too many entries, duplicate fields and malformed replies fail closed with no partial evidence', async () => {
  let canceled = false;
  const responses = [
    () => new Response('private-token', {status: 401}),
    () => ({ok: true, redirected: true, body: new ReadableStream()}),
    () => Response.json({error: 'private-token'}),
    () => Response.json({result: ['private-odd']}),
    () => Response.json({result: Array(2002).fill('private-too-many')}),
    () => Response.json({result: ['private-event', JSON.stringify(record()), 'private-event', JSON.stringify(record())]}),
    () => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));}, cancel() {canceled = true;}})),
    () => {throw new Error('private-token https://private-storage.invalid');},
  ];
  for (const response of responses) {
    let calls = 0;
    const report = await checkRampnowCallbacks(env, {now, fetchImpl: async () => {calls++; return response();}});
    assert.equal(calls, 1); assert.equal(report.status, 'sandbox_callback_check_failed');
    assert.equal(report.checked, false); assert.equal(report.providerCallbackCandidateCount, 0);
    assert.equal(report.providerCallbackCandidatePresent, false); sanitized(report);
  }
  assert.equal(canceled, true);
});

test('invalid clocks fail without a query and storage inspection never reads the API signing secret', async () => {
  const guarded = {...env};
  Object.defineProperty(guarded, 'RAMPNOW_API_SECRET', {get() {assert.fail('signing secret is unnecessary');}});
  assert.equal((await checkRampnowCallbacks(guarded, store([]))).checked, true);
  for (const time of [NaN, Infinity, 0, -1, 1.5]) {
    const report = await checkRampnowCallbacks(env, {now: () => time, fetchImpl() {assert.fail('network is forbidden');}});
    assert.equal(report.status, 'sandbox_callback_check_failed'); sanitized(report);
  }
});
