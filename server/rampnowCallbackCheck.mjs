/** Read-only inspection of sandbox intake records, never proof of provider origin.
 * Anyone holding the shared API secret can sign a callback. The report therefore
 * identifies only recent non-probe candidates and never authorizes production.
 */
import {normalizeRampnowEvent, RAMPNOW_STORE_PREFIX, sandboxRampnowConfig} from './rampnowStore.mjs';

const BRANCH = 'feat/rampnow-integration-20261028';
const WALLET_PROJECT = 'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const RECENT_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 120;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isProbe = value => typeof value === 'string' && /^probe-/i.test(value);
const sameKeys = (left, right) => object(left) && object(right)
  && Object.keys(left).length === Object.keys(right).length
  && Object.keys(right).every(key => Object.hasOwn(left, key));

async function readResult(response) {
  if (!response.ok || response.redirected || !response.body) throw new Error('CALLBACK_CHECK_FAILED');
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('CALLBACK_CHECK_FAILED'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const result = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
  if (!object(result) || Object.hasOwn(result, 'error') || !Array.isArray(result.result)
    || result.result.length % 2 || result.result.length > MAX_ENTRIES * 2) throw new Error('CALLBACK_CHECK_FAILED');
  return result.result;
}

function validRecord(record, field, seconds) {
  if (!sameKeys(record, {classification: 0, receivedAt: 0, event: 0})
    || record.classification !== 'unbound' || !Number.isSafeInteger(record.receivedAt)
    || record.receivedAt <= 0 || record.receivedAt > seconds + CLOCK_SKEW_SECONDS) return false;
  try {
    const event = normalizeRampnowEvent(record.event);
    return field === event.eventUid && sameKeys(record.event, event)
      && sameKeys(record.event.payload, event.payload)
      && Object.keys(event.payload).every(key => record.event.payload[key] === event.payload[key]);
  } catch { return false; }
}

export async function checkRampnowCallbacks(env = process.env, {fetchImpl = fetch, now = Date.now} = {}) {
  const report = {configured: false, checked: false, existingRecordCandidatePresent: false,
    providerCallbackCandidatePresent: false, providerCallbackCandidateCount: 0, scannedEntryCount: 0,
    excludedProbeCount: 0, staleEntryCount: 0, invalidEntryCount: 0, productionReady: false,
    status: 'sandbox_callbacks_not_configured'};
  if (env.VERCEL_ENV !== 'preview' || env.RAMPNOW_ENVIRONMENT !== 'sandbox'
    || env.VERCEL_GIT_COMMIT_REF !== BRANCH || env.VERCEL_PROJECT_ID !== WALLET_PROJECT) {
    return {...report, status: 'skipped_outside_sandbox_wallet_preview_branch'};
  }
  let config;
  try { config = sandboxRampnowConfig(env); } catch { return report; }
  report.configured = true;
  try {
    const clock = now();
    if (!Number.isSafeInteger(clock) || clock <= 0) throw new Error('CALLBACK_CHECK_FAILED');
    const seconds = Math.floor(clock / 1000);
    // HGETALL is read-only. Bound both streamed bytes and the store's maximum
    // 1,000-entry quarantine before inspecting any records. Never read bindings.
    const response = await fetchImpl(config.url, {method: 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(5000), headers: {Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json'},
      body: JSON.stringify(['HGETALL', RAMPNOW_STORE_PREFIX + 'quarantine'])});
    const records = await readResult(response);
    const counts = {scannedEntryCount: records.length / 2, excludedProbeCount: 0,
      staleEntryCount: 0, invalidEntryCount: 0, providerCallbackCandidateCount: 0};
    const fields = new Set();
    for (let i = 0; i < records.length; i += 2) {
      const field = records[i]; const raw = records[i + 1];
      if (typeof field !== 'string' || fields.has(field)) throw new Error('CALLBACK_CHECK_FAILED');
      fields.add(field);
      if (isProbe(field)) { counts.excludedProbeCount++; continue; }
      let record;
      try {
        if (typeof raw !== 'string' || Buffer.byteLength(raw) > 4096) throw new Error('INVALID_RECORD');
        record = JSON.parse(raw);
      } catch { counts.invalidEntryCount++; continue; }
      if ([record?.event?.eventUid, record?.event?.payload?.orderUid,
        record?.event?.payload?.externalOrderUid].some(isProbe)) { counts.excludedProbeCount++; continue; }
      if (!validRecord(record, field, seconds)) { counts.invalidEntryCount++; continue; }
      if (record.receivedAt < seconds - RECENT_SECONDS) counts.staleEntryCount++;
      else counts.providerCallbackCandidateCount++;
    }
    const present = counts.providerCallbackCandidateCount > 0;
    return {...report, ...counts, checked: true, providerCallbackCandidatePresent: present,
      existingRecordCandidatePresent: present || counts.staleEntryCount > 0,
      status: present ? 'sandbox_callback_candidates_found' : 'sandbox_no_recent_callback_candidates'};
  } catch {
    // No raw errors, endpoints, IDs, payload fields or partially scanned results.
    return {...report, status: 'sandbox_callback_check_failed'};
  }
}
