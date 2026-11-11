/** In-process sandbox handler/storage self-test. This is NOT provider delivery.
 * Only a synthetic zero-fill, unbound event is created and compare-deleted.
 */
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {createWebhookHandler} from '../api/rampnow/webhook.js';
import {rampnowSignature, RAMPNOW_WEBHOOK_PATH} from './rampnow.mjs';
import {createRampnowStore, normalizeRampnowEvent, RAMPNOW_STORE_PREFIX, sandboxRampnowConfig} from './rampnowStore.mjs';

const CLEAN = `
local htype=redis.call('TYPE',KEYS[1]).ok
local ztype=redis.call('TYPE',KEYS[2]).ok
if (htype~='none' and htype~='hash') or (ztype~='none' and ztype~='zset') then return redis.error_reply('Invalid probe store type') end
if redis.call('HGET',KEYS[1],ARGV[1])~=ARGV[2] then return 0 end
redis.call('HDEL',KEYS[1],ARGV[1]);redis.call('ZREM',KEYS[2],ARGV[1]);return 1`;

export async function checkRampnowWebhook(env = process.env, {fetchImpl = fetch, now = Date.now} = {}) {
  const report = {tamperRejected: false, signedEventStored: false, duplicateStable: false,
    cleanupVerified: false, providerDeliveryVerified: false, productionReady: false, status: 'sandbox_webhook_not_configured'};
  if (env.VERCEL_ENV !== 'preview' || env.RAMPNOW_ENVIRONMENT !== 'sandbox') {
    return {...report, status: 'skipped_outside_sandbox_preview'};
  }
  let config;
  try { config = sandboxRampnowConfig(env); } catch { return report; }
  if (typeof env.RAMPNOW_API_SECRET !== 'string' || !env.RAMPNOW_API_SECRET) return report;
  const clock = now();
  if (!Number.isSafeInteger(clock) || clock <= 0) return {...report, status: 'sandbox_webhook_check_failed'};
  const seconds = Math.floor(clock / 1000);
  const event = {eventUid: 'probe-' + randomUUID(), eventType: 'ramp_order.status_change', payload: {
    orderUid: 'probe-' + randomUUID(), externalOrderUid: 'probe-' + randomUUID(), orderType: 'buy',
    orderStatus: 'created', updateTime: new Date(clock).toISOString(), srcCurrency: 'INR', srcChain: 'fiat',
    dstCurrency: 'BTC', dstChain: 'bitcoin', dstFillAmount: '0',
  }};
  const expected = JSON.stringify({classification: 'unbound', receivedAt: seconds, event: normalizeRampnowEvent(event)});
  const quarantine = RAMPNOW_STORE_PREFIX + 'quarantine';
  const quarantineTime = RAMPNOW_STORE_PREFIX + 'quarantine-time';
  let cleanupNeeded = false;
  async function command(...args) {
    const response = await fetchImpl(config.url, {method: 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(5000), headers: {Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json'},
      body: JSON.stringify(args)});
    if (!response.ok || response.redirected || !response.body) throw new Error('WEBHOOK_CHECK_FAILED');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.length;
        if (size > 8192) { await reader.cancel(); throw new Error('WEBHOOK_CHECK_FAILED'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.error || !Object.hasOwn(result, 'result')) {
      throw new Error('WEBHOOK_CHECK_FAILED');
    }
    return result.result;
  }
  const handler = createWebhookHandler({env, now: () => clock,
    storeFactory: options => createRampnowStore({...options, fetchImpl})});
  const raw = Buffer.from(JSON.stringify(event));
  const timestamp = String(seconds);
  const signature = rampnowSignature(env.RAMPNOW_API_SECRET, timestamp, 'POST', RAMPNOW_WEBHOOK_PATH, raw);
  async function invoke(sign) {
    const req = Readable.from([raw]);
    req.method = 'POST';
    req.headers = {'content-length': String(raw.length), 'content-type': 'application/json',
      'x-rampnow-timestamp': timestamp, 'x-rampnow-sign': sign};
    // Guard against accidentally reintroducing Vercel's lazy JSON parser access.
    Object.defineProperty(req, 'body', {get() {throw new Error('RAW_BODY_REQUIRED');}});
    const res = {statusCode: 0, body: '', setHeader() {}, end(body) {this.body = body;}};
    await handler(req, res);
    return res;
  }
  try {
    const tampered = await invoke((signature[0] === '0' ? '1' : '0') + signature.slice(1));
    if (tampered.statusCode !== 401) throw new Error('WEBHOOK_CHECK_FAILED');
    report.tamperRejected = true;
    cleanupNeeded = true; // A timeout may follow a durable write.
    const first = await invoke(signature);
    if (first.statusCode !== 200 || first.body !== '{"code":"EVENT_STORED"}') throw new Error('WEBHOOK_CHECK_FAILED');
    if (await command('HGET', quarantine, event.eventUid) !== expected) throw new Error('WEBHOOK_CHECK_FAILED');
    report.signedEventStored = true;
    const duplicate = await invoke(signature);
    if (duplicate.statusCode !== 200 || duplicate.body !== '{"code":"EVENT_STORED"}'
      || await command('HGET', quarantine, event.eventUid) !== expected
      || Number(await command('ZSCORE', quarantineTime, event.eventUid)) !== seconds) throw new Error('WEBHOOK_CHECK_FAILED');
    report.duplicateStable = true;
    if (await command('EVAL', CLEAN, 2, quarantine, quarantineTime, event.eventUid, expected) !== 1
      || await command('HGET', quarantine, event.eventUid) !== null
      || await command('ZSCORE', quarantineTime, event.eventUid) !== null) throw new Error('WEBHOOK_CHECK_FAILED');
    cleanupNeeded = false;
    report.cleanupVerified = true;
    report.status = 'sandbox_webhook_selftest_verified';
  } catch {
    report.status = 'sandbox_webhook_check_failed';
  } finally {
    if (cleanupNeeded) {
      try { await command('EVAL', CLEAN, 2, quarantine, quarantineTime, event.eventUid, expected); } catch { /* Sanitized result only. */ }
    }
  }
  return report;
}
