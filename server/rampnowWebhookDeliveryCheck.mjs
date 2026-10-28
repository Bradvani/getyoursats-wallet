/** Signed HTTP delivery to the dedicated sandbox receiver, never provider delivery. */
import {randomUUID} from 'node:crypto';
import {rampnowSignature, RAMPNOW_WEBHOOK_PATH} from './rampnow.mjs';
import {normalizeRampnowEvent, RAMPNOW_STORE_PREFIX, sandboxRampnowConfig} from './rampnowStore.mjs';

const RECEIVER = 'https://gys-rampnow-sandbox-webhook.vercel.app/api/rampnow/webhook';
const BRANCH = 'feat/rampnow-integration-20261028';
const CLOCK_SKEW_SECONDS = 120;
const matchesScore = (actual, expected) => (typeof actual === 'string' || Number.isSafeInteger(actual)) && String(actual) === expected;
const CLEAN = `
local htype=redis.call('TYPE',KEYS[1]).ok
local ztype=redis.call('TYPE',KEYS[2]).ok
if (htype~='none' and htype~='hash') or (ztype~='none' and ztype~='zset') then return redis.error_reply('Invalid probe store type') end
if redis.call('HGET',KEYS[1],ARGV[1])~=ARGV[2] then return 0 end
if redis.call('ZSCORE',KEYS[2],ARGV[1])~=ARGV[3] then return 0 end
redis.call('HDEL',KEYS[1],ARGV[1]);redis.call('ZREM',KEYS[2],ARGV[1]);return 1`;

async function boundedText(response) {
  if (response.redirected || !response.body) throw new Error('DELIVERY_CHECK_FAILED');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > 8192) { await reader.cancel(); throw new Error('DELIVERY_CHECK_FAILED'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
}

export async function checkRampnowWebhookDelivery(env = process.env, {fetchImpl = fetch, now = Date.now} = {}) {
  const report = {tamperRejected: false, signedEventStored: false, duplicateStable: false,
    cleanupVerified: false, httpDeliveryVerified: false, providerDeliveryVerified: false, productionReady: false,
    tamperedHttpStatus: 0, signedHttpStatus: 0, duplicateHttpStatus: 0, status: 'sandbox_webhook_delivery_not_configured'};
  if (env.VERCEL_ENV !== 'preview' || env.RAMPNOW_ENVIRONMENT !== 'sandbox' || env.VERCEL_GIT_COMMIT_REF !== BRANCH) {
    return {...report, status: 'skipped_outside_sandbox_preview_branch'};
  }
  let config;
  try { config = sandboxRampnowConfig(env); } catch { return report; }
  if (typeof env.RAMPNOW_API_SECRET !== 'string' || !env.RAMPNOW_API_SECRET) return report;
  let event; let expectedEvent; let startSeconds; let cleanupNeeded = false; let observedRecord;
  const quarantine = RAMPNOW_STORE_PREFIX + 'quarantine';
  const quarantineTime = RAMPNOW_STORE_PREFIX + 'quarantine-time';
  async function command(...args) {
    const response = await fetchImpl(config.url, {method: 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(5000), headers: {Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json'},
      body: JSON.stringify(args)});
    if (!response.ok) throw new Error('DELIVERY_CHECK_FAILED');
    const result = JSON.parse(await boundedText(response));
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.error || !Object.hasOwn(result, 'result')) {
      throw new Error('DELIVERY_CHECK_FAILED');
    }
    return result.result;
  }
  function verifiedRecord(raw) {
    if (typeof raw !== 'string') throw new Error('DELIVERY_CHECK_FAILED');
    const record = JSON.parse(raw); const endSeconds = Math.floor(now() / 1000);
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || Object.keys(record).sort().join(',') !== 'classification,event,receivedAt'
      || record.classification !== 'unbound' || !Number.isSafeInteger(record.receivedAt)
      || !Number.isSafeInteger(endSeconds) || endSeconds < startSeconds
      || record.receivedAt < startSeconds - CLOCK_SKEW_SECONDS || record.receivedAt > endSeconds + CLOCK_SKEW_SECONDS
      || JSON.stringify(record.event) !== expectedEvent) throw new Error('DELIVERY_CHECK_FAILED');
    return {raw, score: String(record.receivedAt)};
  }
  async function cleanup(record) {
    if (await command('EVAL', CLEAN, 2, quarantine, quarantineTime, event.eventUid, record.raw, record.score) !== 1) {
      throw new Error('DELIVERY_CHECK_FAILED');
    }
    if (await command('HGET', quarantine, event.eventUid) !== null
      || await command('ZSCORE', quarantineTime, event.eventUid) !== null) throw new Error('DELIVERY_CHECK_FAILED');
    report.cleanupVerified = true;
    cleanupNeeded = false;
  }
  try {
    const clock = now();
    if (!Number.isSafeInteger(clock) || clock <= 0) throw new Error('DELIVERY_CHECK_FAILED');
    startSeconds = Math.floor(clock / 1000);
    event = {eventUid: 'probe-http-' + randomUUID(), eventType: 'ramp_order.status_change', payload: {
      orderUid: 'probe-http-' + randomUUID(), externalOrderUid: 'probe-http-' + randomUUID(), orderType: 'buy',
      orderStatus: 'created', updateTime: new Date(clock).toISOString(), srcCurrency: 'INR', srcChain: 'fiat',
      dstCurrency: 'BTC', dstChain: 'bitcoin', dstFillAmount: '0',
    }};
    expectedEvent = JSON.stringify(normalizeRampnowEvent(event));
    const raw = Buffer.from(JSON.stringify(event)); const timestamp = String(startSeconds);
    const signature = rampnowSignature(env.RAMPNOW_API_SECRET, timestamp, 'POST', RAMPNOW_WEBHOOK_PATH, raw);
    async function deliver(sign, statusField) {
      const response = await fetchImpl(RECEIVER, {method: 'POST', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(10000), headers: {'Content-Type': 'application/json',
          'x-rampnow-timestamp': timestamp, 'x-rampnow-sign': sign}, body: raw});
      if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) report[statusField] = response.status;
      return {status: response.status, body: await boundedText(response)};
    }
    // Even a faulty receiver might persist an invalidly signed request; allow exact probe cleanup.
    cleanupNeeded = true;
    const tampered = await deliver((signature[0] === '0' ? '1' : '0') + signature.slice(1), 'tamperedHttpStatus');
    if (tampered.status !== 401) throw new Error('DELIVERY_CHECK_FAILED');
    if (await command('HGET', quarantine, event.eventUid) !== null
      || await command('ZSCORE', quarantineTime, event.eventUid) !== null) throw new Error('DELIVERY_CHECK_FAILED');
    report.tamperRejected = true;
    const first = await deliver(signature, 'signedHttpStatus');
    if (first.status !== 200 || first.body !== '{"code":"EVENT_STORED"}') throw new Error('DELIVERY_CHECK_FAILED');
    observedRecord = verifiedRecord(await command('HGET', quarantine, event.eventUid));
    if (!matchesScore(await command('ZSCORE', quarantineTime, event.eventUid), observedRecord.score)) throw new Error('DELIVERY_CHECK_FAILED');
    report.signedEventStored = true;
    const duplicate = await deliver(signature, 'duplicateHttpStatus');
    if (duplicate.status !== 200 || duplicate.body !== '{"code":"EVENT_STORED"}'
      || await command('HGET', quarantine, event.eventUid) !== observedRecord.raw
      || !matchesScore(await command('ZSCORE', quarantineTime, event.eventUid), observedRecord.score)) throw new Error('DELIVERY_CHECK_FAILED');
    report.duplicateStable = true;
    await cleanup(observedRecord);
    report.httpDeliveryVerified = true;
    report.status = 'sandbox_webhook_http_delivery_verified';
  } catch {
    report.status = 'sandbox_webhook_delivery_check_failed';
  } finally {
    if (cleanupNeeded && event) {
      try {
        // On an ambiguous HTTP failure, read and validate ownership before any deletion.
        const current = await command('HGET', quarantine, event.eventUid);
        if (current !== null) {
          const record = observedRecord ?? verifiedRecord(current);
          if (current === record.raw && matchesScore(await command('ZSCORE', quarantineTime, event.eventUid), record.score)) await cleanup(record);
        }
      } catch { /* Only fixed safe fields leave this function. */ }
    }
  }
  return report;
}
