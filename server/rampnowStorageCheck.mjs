/** Sandbox storage capability probe. Only random, expiring probe keys are touched.
 * Successful round trips prove API write/read/EVAL behavior, not disk durability
 * across a provider outage. Never return endpoints, tokens, keys or exceptions.
 */
import {randomBytes} from 'node:crypto';
import {sandboxRampnowConfig} from './rampnowStore.mjs';

const MAX_RESPONSE_BYTES = 8192;
const PROBE_TTL = 120;
const CREATE = `local old=redis.call('GET',KEYS[1])
if old then if old==ARGV[1] then return 'DUPLICATE' else return 'COLLISION' end end
redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2],'NX'); return 'CREATED'`;
const CLEAN = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0`;

export async function checkRampnowStorage(env = process.env, {fetchImpl = fetch} = {}) {
  const report = {configured: false, connected: false, atomicRoundTrip: false, duplicateRejected: false,
    cleanupVerified: false, status: 'sandbox_storage_not_configured'};
  if (env.VERCEL_ENV !== 'preview' || env.RAMPNOW_ENVIRONMENT !== 'sandbox') {
    return {...report, status: 'skipped_outside_sandbox_preview'};
  }
  let config;
  try { config = sandboxRampnowConfig(env); } catch { return report; }
  report.configured = true;
  const key = 'gys:rampnow:{sandbox}:probe:' + randomBytes(24).toString('hex');
  const value = randomBytes(24).toString('hex');
  let cleanupNeeded = false;
  async function command(...args) {
    const response = await fetchImpl(config.url, {method: 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(5000), headers: {Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json'},
      body: JSON.stringify(args)});
    if (!response.ok || response.redirected || !response.body) throw new Error('STORAGE_CHECK_FAILED');
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const {done, value: chunk} = await reader.read();
        if (done) break;
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('STORAGE_CHECK_FAILED'); }
        chunks.push(Buffer.from(chunk));
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error || !Object.hasOwn(data, 'result')) {
      throw new Error('STORAGE_CHECK_FAILED');
    }
    report.connected = true;
    return data.result;
  }
  try {
    // Mark before the request: a timeout may occur after Redis has stored it.
    cleanupNeeded = true;
    if (await command('EVAL', CREATE, 1, key, value, PROBE_TTL) !== 'CREATED') throw new Error('STORAGE_CHECK_FAILED');
    if (await command('GET', key) !== value) throw new Error('STORAGE_CHECK_FAILED');
    const ttl = await command('TTL', key);
    if (!Number.isInteger(ttl) || ttl <= 0 || ttl > PROBE_TTL) throw new Error('STORAGE_CHECK_FAILED');
    report.atomicRoundTrip = true;
    if (await command('EVAL', CREATE, 1, key, value, PROBE_TTL) !== 'DUPLICATE') throw new Error('STORAGE_CHECK_FAILED');
    report.duplicateRejected = true;
    if (await command('EVAL', CLEAN, 1, key, value) !== 1) throw new Error('STORAGE_CHECK_FAILED');
    if (await command('GET', key) !== null) throw new Error('STORAGE_CHECK_FAILED');
    cleanupNeeded = false;
    report.cleanupVerified = true;
    report.status = 'sandbox_storage_verified';
  } catch {
    report.status = 'sandbox_storage_check_failed';
  } finally {
    // Only compare-and-delete the private random probe value. The short TTL is
    // the fallback if the provider is unavailable. Never delete real event keys.
    if (cleanupNeeded) { try { await command('EVAL', CLEAN, 1, key, value); } catch { /* Sanitized result only. */ } }
  }
  return report;
}
