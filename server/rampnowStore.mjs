/** Sandbox webhook storage only. No checkout creation or wallet crediting.
 * Bindings are written by a future authenticated intent service, not webhooks.
 * Dedicated RAMPNOW_REDIS_REST_* storage is mandatory; account/support stores
 * are never a fallback. Redis must provide persistent storage without eviction.
 */
import {applyRampnowOrderEvent, decimalAmount, rampnowOrderState, RampnowError} from './rampnow.mjs';

export const RAMPNOW_STORE_PREFIX = 'gys:rampnow:{sandbox}:v1:';
const EVENT_TTL = 7 * 86400;
const STATE_TTL = 30 * 86400;
const MAX_QUARANTINE = 1000;
const MAX_SEEN = 10000;
const MAX_RESPONSE = 64 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function need(value, code = 'RAMPNOW_STORE_UNAVAILABLE') { if (!value) throw new RampnowError(code); }

export function sandboxRampnowConfig(env = process.env) {
  need(env.VERCEL_ENV === 'preview' && env.RAMPNOW_ENVIRONMENT === 'sandbox', 'RAMPNOW_SANDBOX_ONLY');
  const endpoint = env.RAMPNOW_REDIS_REST_URL;
  const token = env.RAMPNOW_REDIS_REST_TOKEN;
  need(typeof endpoint === 'string' && typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token));
  let url;
  try { url = new URL(endpoint); } catch { throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/');
  return {url: url.href, token};
}

/** Explicit allow-list removes customer, wallet address, bank and KYC fields. */
export function normalizeRampnowEvent(event) {
  need(object(event) && identifier(event.eventUid) && event.eventType === 'ramp_order.status_change'
    && object(event.payload), 'RAMPNOW_EVENT_INVALID');
  const p = event.payload;
  need(identifier(p.orderUid) && identifier(p.externalOrderUid)
    && ['buy', 'sell'].includes(p.orderType)
    && typeof p.orderStatus === 'string' && /^[a-z_]{1,64}$/.test(p.orderStatus)
    && typeof p.updateTime === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(p.updateTime)
    && Number.isFinite(Date.parse(p.updateTime))
    && decimalAmount(p.dstFillAmount, p.orderStatus === 'completed'), 'RAMPNOW_EVENT_INVALID');
  for (const key of ['srcCurrency', 'dstCurrency']) {
    need(typeof p[key] === 'string' && /^[A-Z0-9]{2,16}$/.test(p[key]), 'RAMPNOW_EVENT_INVALID');
  }
  for (const key of ['srcChain', 'dstChain']) {
    need(typeof p[key] === 'string' && /^[a-z0-9_-]{1,40}$/.test(p[key]), 'RAMPNOW_EVENT_INVALID');
  }
  const keys = ['orderUid', 'externalOrderUid', 'orderType', 'srcCurrency', 'srcChain', 'dstCurrency', 'dstChain',
    'orderStatus', 'updateTime', 'dstFillAmount'];
  return {eventUid: event.eventUid, eventType: event.eventType,
    payload: Object.fromEntries(keys.map(key => [key, p[key]]))};
}

const CHECK_TYPES = `
local types={unpack(ARGV,1,#KEYS)}
for i,key in ipairs(KEYS) do
  local kind=redis.call('TYPE',key).ok
  if kind~='none' and kind~=types[i] then return redis.error_reply('Invalid store type') end
end
`;

// Quarantine is one bounded hash plus a timestamp index. Expired entries are
// removed even under continuous traffic; a full quarantine returns non-2xx.
export const QUARANTINE_SCRIPT = CHECK_TYPES + `
if redis.call('GET',KEYS[1]) then return 'RETRY' end
local id=ARGV[4]; local record=ARGV[5]; local now=tonumber(ARGV[6]); local ttl=tonumber(ARGV[7])
local expired=redis.call('ZRANGEBYSCORE',KEYS[3],'-inf',now-ttl)
for _,old in ipairs(expired) do redis.call('HDEL',KEYS[2],old) end
redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',now-ttl)
if redis.call('HEXISTS',KEYS[2],id)==1 then return 'DUPLICATE' end
if redis.call('HLEN',KEYS[2])>=tonumber(ARGV[8]) then return 'FULL' end
redis.call('HSET',KEYS[2],id,record); redis.call('ZADD',KEYS[3],now,id)
redis.call('EXPIRE',KEYS[2],ttl); redis.call('EXPIRE',KEYS[3],ttl)
return 'QUARANTINED'
`;

// Exact binding + state comparison prevents an old worker overwriting a newer
// event. Dedupe and state commit happen together, after all type checks.
export const COMMIT_SCRIPT = CHECK_TYPES + `
if redis.call('GET',KEYS[1])~=ARGV[6] or (redis.call('GET',KEYS[2]) or '')~=ARGV[7] then return 'RETRY' end
local id=ARGV[8]; local now=tonumber(ARGV[10]); local ttl=tonumber(ARGV[11])
redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',now-ttl)
if redis.call('ZSCORE',KEYS[3],id) then return 'DUPLICATE' end
if redis.call('ZCARD',KEYS[3])>=tonumber(ARGV[13]) then return 'FULL' end
redis.call('SET',KEYS[2],ARGV[9],'EX',ARGV[12])
redis.call('ZADD',KEYS[3],now,id); redis.call('EXPIRE',KEYS[3],ttl)
redis.call('HDEL',KEYS[4],id); redis.call('ZREM',KEYS[5],id)
return 'ACCEPTED'
`;

function storedObject(raw) {
  need(typeof raw === 'string' && Buffer.byteLength(raw) <= 4096);
  let value;
  try { value = JSON.parse(raw); } catch { throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE'); }
  need(object(value));
  return value;
}
function readBinding(raw, externalOrderUid) {
  const binding = storedObject(raw);
  need(binding.environment === 'sandbox' && identifier(binding.orderUid)
    && binding.externalOrderUid === externalOrderUid
    && typeof binding.walletPubkey === 'string' && /^(02|03)[0-9a-f]{64}$/.test(binding.walletPubkey));
  const buy = binding.orderType === 'buy';
  need(buy || binding.orderType === 'sell');
  const fiat = buy ? binding.srcCurrency : binding.dstCurrency;
  need(typeof fiat === 'string' && /^[A-Z]{3}$/.test(fiat) && fiat !== 'BTC');
  need(binding.srcCurrency === (buy ? fiat : 'BTC') && binding.dstCurrency === (buy ? 'BTC' : fiat)
    && binding.srcChain === (buy ? 'fiat' : 'bitcoin') && binding.dstChain === (buy ? 'bitcoin' : 'fiat'));
  return binding;
}
function readState(raw) {
  if (raw === null) return null;
  const state = storedObject(raw);
  need(identifier(state.orderUid) && identifier(state.externalOrderUid) && identifier(state.eventUid)
    && Number.isSafeInteger(state.updatedAt) && typeof state.status === 'string'
    && /^[a-z_]{1,64}$/.test(state.status) && decimalAmount(state.dstFillAmount, false)
    && state.keepObserving === true && state.needsReconciliation === true
    && state.phase === rampnowOrderState(state.status).phase);
  // Reconstruct an allow-listed record, even if a stored record is malformed.
  const keys = ['orderUid', 'externalOrderUid', 'eventUid', 'updatedAt', 'status', 'dstFillAmount', 'phase', 'keepObserving', 'needsReconciliation'];
  return Object.fromEntries(keys.map(key => [key, state[key]]));
}

export function createRampnowStore({env = process.env, fetchImpl = fetch, now = Date.now} = {}) {
  const config = sandboxRampnowConfig(env);
  async function redis(...command) {
    try {
      const response = await fetchImpl(config.url, {method: 'POST', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(7500), headers: {Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json'},
        body: JSON.stringify(command)});
      need(response.ok && !response.redirected && response.body);
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_RESPONSE) { await reader.cancel(); throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      need(object(payload) && !payload.error && Object.hasOwn(payload, 'result'));
      return payload.result;
    } catch { throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE'); }
  }
  const key = suffix => RAMPNOW_STORE_PREFIX + suffix;
  return Object.freeze({
    async ingest(input) {
      const event = normalizeRampnowEvent(input);
      const bindingKey = key('binding:' + event.payload.externalOrderUid);
      const stateKey = key('state:' + event.payload.externalOrderUid);
      for (let attempt = 0; attempt < 5; attempt++) {
        const time = Math.floor(now() / 1000);
        need(Number.isSafeInteger(time) && time > 0);
        const bindingRaw = await redis('GET', bindingKey);
        let result;
        if (bindingRaw === null) {
          result = await redis('EVAL', QUARANTINE_SCRIPT, 3, bindingKey, key('quarantine'), key('quarantine-time'),
            'string', 'hash', 'zset', event.eventUid,
            JSON.stringify({classification: 'unbound', receivedAt: time, event}), time, EVENT_TTL, MAX_QUARANTINE);
        } else {
          const binding = readBinding(bindingRaw, event.payload.externalOrderUid);
          const stateRaw = await redis('GET', stateKey);
          const next = applyRampnowOrderEvent(readState(stateRaw), event, binding);
          result = await redis('EVAL', COMMIT_SCRIPT, 5, bindingKey, stateKey, key('seen'), key('quarantine'), key('quarantine-time'),
            'string', 'string', 'zset', 'hash', 'zset', bindingRaw, stateRaw ?? '', event.eventUid,
            JSON.stringify(next), time, EVENT_TTL, STATE_TTL, MAX_SEEN);
        }
        if (result === 'RETRY') continue;
        need(['ACCEPTED', 'QUARANTINED', 'DUPLICATE'].includes(result));
        return result;
      }
      throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');
    },
  });
}
