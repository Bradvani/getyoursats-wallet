/** Durable sandbox checkout intents. Reserving is one-way: uncertain submissions
 * require provider lookup reconciliation and can never authorize another POST.
 */
import {decimalAmount, RampnowError} from './rampnow.mjs';
import {RAMPNOW_STORE_PREFIX, sandboxRampnowConfig} from './rampnowStore.mjs';

const RETENTION_MS = 30 * 86400 * 1000;
const CAPACITY = 1000;
const MAX_RESPONSE = 64 * 1024;
const BASE_KEYS = ['externalOrderUid', 'walletPubkey', 'requestHash', 'sourceAmount', 'orderType',
  'srcCurrency', 'srcChain', 'dstCurrency', 'dstChain', 'network', 'destinationHash', 'quoteHash', 'createdAt', 'expiresAt'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const wallet = value => typeof value === 'string' && /^(02|03)[0-9a-f]{64}$/.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function need(condition, code = 'RAMPNOW_STORE_UNAVAILABLE') {if (!condition) throw new RampnowError(code);}
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function checkoutUrl(value, code) {
  need(typeof value === 'string' && value.length <= 8192 && !/[\u0000-\u0020\\#]/.test(value), code);
  let parsed;
  try {parsed = new URL(value);} catch {throw new RampnowError(code);}
  need(parsed.protocol === 'https:' && parsed.hostname === 'app.sandbox.rampnow.io' && !parsed.port
    && !parsed.username && !parsed.password && !parsed.hash && parsed.href.length <= 8192, code);
  return parsed.href;
}
function baseRecord(record, code) {
  need(object(record) && uuid(record.externalOrderUid) && wallet(record.walletPubkey) && hash(record.requestHash)
    && decimalAmount(record.sourceAmount, true, 3) && record.orderType === 'buy'
    && record.srcCurrency === 'INR' && record.srcChain === 'fiat' && record.dstCurrency === 'BTC' && record.dstChain === 'bitcoin'
    && ['testnet', 'signet'].includes(record.network) && hash(record.destinationHash) && hash(record.quoteHash)
    && Number.isSafeInteger(record.createdAt) && record.createdAt > 0
    && Number.isSafeInteger(record.expiresAt) && record.expiresAt > record.createdAt
    && record.expiresAt <= record.createdAt + RETENTION_MS && Number.isSafeInteger(record.createdAt + RETENTION_MS), code);
  return Object.fromEntries(BASE_KEYS.map(key => [key, record[key]]));
}
function readIntent(raw, externalOrderUid) {
  need(typeof raw === 'string' && Buffer.byteLength(raw) <= 16 * 1024);
  let value;
  try {value = JSON.parse(raw);} catch {throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');}
  const base = baseRecord(value, 'RAMPNOW_STORE_UNAVAILABLE');
  need(base.externalOrderUid === externalOrderUid && ['prepared', 'submitting', 'uncertain', 'bound'].includes(value.phase)
    && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= base.createdAt);
  const keys = [...BASE_KEYS, 'phase', 'updatedAt', ...(value.phase === 'bound' ? ['orderUid', 'checkoutUrl'] : [])];
  need(exactKeys(value, keys));
  const result = {...base, phase: value.phase, updatedAt: value.updatedAt};
  if (value.phase === 'bound') {
    need(identifier(value.orderUid));
    const url = value.checkoutUrl === null ? null : checkoutUrl(value.checkoutUrl, 'RAMPNOW_STORE_UNAVAILABLE');
    need(url === value.checkoutUrl);
    result.orderUid = value.orderUid; result.checkoutUrl = url;
  }
  return result;
}
function bindingFor(intent, orderUid) {
  return {environment: 'sandbox', walletPubkey: intent.walletPubkey, externalOrderUid: intent.externalOrderUid, orderUid,
    orderType: intent.orderType, srcCurrency: intent.srcCurrency, srcChain: intent.srcChain,
    dstCurrency: intent.dstCurrency, dstChain: intent.dstChain};
}

const PREPARE = `
local kinds={'string','zset','string'}
for i,key in ipairs(KEYS) do local kind=redis.call('TYPE',key).ok
  if kind~='none' and kind~=kinds[i] then return redis.error_reply('Invalid intent store type') end
end
local existing=redis.call('GET',KEYS[1]);if existing then return {'EXISTS',existing} end
if redis.call('GET',KEYS[3]) then return {'CONFLICT'} end
local now=tonumber(ARGV[3]);local retainUntil=tonumber(ARGV[4]);local expiresAt=tonumber(ARGV[7])
if expiresAt<=now or retainUntil<=now then return {'EXPIRED'} end
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now)
if redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[5]) then return {'FULL'} end
local created=redis.call('SET',KEYS[1],ARGV[2],'NX','PX',retainUntil-now)
if not created then return {'RETRY'} end
redis.call('ZADD',KEYS[2],retainUntil,ARGV[1]);redis.call('PEXPIRE',KEYS[2],ARGV[6])
return {'CREATED',ARGV[2]}
`;
const UPDATE = `
local kind=redis.call('TYPE',KEYS[1]).ok
if kind~='none' and kind~='string' then return redis.error_reply('Invalid intent store type') end
if redis.call('GET',KEYS[1])~=ARGV[1] then return 'RETRY' end
local deadline=tonumber(ARGV[3])
if deadline>0 then
  local clock=redis.call('TIME');local milliseconds=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)
  if milliseconds>=deadline then return 'EXPIRED' end
end
local ttl=redis.call('PTTL',KEYS[1]);if ttl<=0 then return redis.error_reply('Invalid intent retention') end
redis.call('SET',KEYS[1],ARGV[2],'PX',ttl);return 'UPDATED'
`;
const BIND = `
for _,key in ipairs(KEYS) do local kind=redis.call('TYPE',key).ok
  if kind~='none' and kind~='string' then return redis.error_reply('Invalid intent store type') end
end
if redis.call('GET',KEYS[1])~=ARGV[1] then return 'RETRY' end
local binding=redis.call('GET',KEYS[2]);local reverse=redis.call('GET',KEYS[3])
if (binding and binding~=ARGV[3]) or (reverse and reverse~=ARGV[4]) then return 'CONFLICT' end
local ttl=redis.call('PTTL',KEYS[1]);if ttl<=0 then return redis.error_reply('Invalid intent retention') end
redis.call('SET',KEYS[1],ARGV[2],'PX',ttl)
redis.call('SET',KEYS[2],ARGV[3],'PX',ttl);redis.call('SET',KEYS[3],ARGV[4],'PX',ttl)
return 'BOUND'
`;

export function createRampnowIntentStore({env = process.env, fetchImpl = fetch, now = Date.now} = {}) {
  need(env.VERCEL_ENV === 'preview' && env.RAMPNOW_ENVIRONMENT === 'sandbox'
    && env.VERCEL_GIT_COMMIT_REF === 'feat/rampnow-integration-20261028', 'RAMPNOW_SANDBOX_ONLY');
  const config = sandboxRampnowConfig(env);
  const key = suffix => RAMPNOW_STORE_PREFIX + suffix;
  const intentKey = id => key('intent:' + id);
  function time() {const value = now(); need(Number.isSafeInteger(value) && value > 0); return value;}
  function identity(id, owner, requestHash) {
    need(uuid(id) && wallet(owner) && (requestHash === undefined || hash(requestHash)), 'RAMPNOW_INTENT_INVALID');
  }
  async function redis(...command) {
    try {
      need(command.length > 0 && command.length <= 128
        && command.every(value => typeof value === 'string' || Number.isSafeInteger(value)));
      const body = JSON.stringify(command); need(Buffer.byteLength(body) <= 64 * 1024);
      const response = await fetchImpl(config.url, {method: 'POST', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(7500), headers: {Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json'}, body});
      need(response.ok && !response.redirected && response.body);
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        for (;;) {
          const {done, value} = await reader.read(); if (done) break;
          size += value.length;
          if (size > MAX_RESPONSE) {await reader.cancel(); throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');}
          chunks.push(Buffer.from(value));
        }
      } finally {reader.releaseLock();}
      const payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
      need(object(payload) && !payload.error && Object.hasOwn(payload, 'result'));
      return payload.result;
    } catch {throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');}
  }
  async function owned(id, owner, requestHash) {
    identity(id, owner, requestHash);
    const raw = await redis('GET', intentKey(id));
    if (raw === null) return null;
    const intent = readIntent(raw, id);
    if (intent.walletPubkey !== owner) return null;
    if (requestHash !== undefined) need(intent.requestHash === requestHash, 'RAMPNOW_INTENT_CONFLICT');
    return {raw, intent};
  }
  async function transition(id, owner, requestHash, decide) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await owned(id, owner, requestHash); need(current, 'RAMPNOW_INTENT_NOT_FOUND');
      const change = decide(current.intent);
      if (!change.next) return change.result;
      const result = await redis('EVAL', UPDATE, 1, intentKey(id), current.raw, JSON.stringify(change.next), change.expiresAt ?? 0);
      if (result === 'RETRY') continue;
      if (result === 'EXPIRED') throw new RampnowError('RAMPNOW_INTENT_EXPIRED');
      need(result === 'UPDATED'); return change.result;
    }
    throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');
  }
  return Object.freeze({
    redis,
    async prepare(record) {
      need(exactKeys(record, BASE_KEYS), 'RAMPNOW_INTENT_INVALID');
      const base = baseRecord(record, 'RAMPNOW_INTENT_INVALID'); const clock = time();
      need(base.createdAt <= clock, 'RAMPNOW_INTENT_INVALID');
      const candidate = {...base, phase: 'prepared', updatedAt: clock};
      const response = await redis('EVAL', PREPARE, 3, intentKey(base.externalOrderUid), key('intent-index'),
        key('binding:' + base.externalOrderUid), base.externalOrderUid, JSON.stringify(candidate), clock,
        base.createdAt + RETENTION_MS, CAPACITY, RETENTION_MS, base.expiresAt);
      need(Array.isArray(response));
      if (response[0] === 'CONFLICT') throw new RampnowError('RAMPNOW_INTENT_CONFLICT');
      if (response[0] === 'EXPIRED') throw new RampnowError('RAMPNOW_INTENT_EXPIRED');
      if (response[0] === 'FULL') throw new RampnowError('RAMPNOW_INTENT_CAPACITY');
      need(['CREATED', 'EXISTS'].includes(response[0]) && response.length === 2);
      const intent = readIntent(response[1], base.externalOrderUid);
      need(JSON.stringify(baseRecord(intent, 'RAMPNOW_STORE_UNAVAILABLE')) === JSON.stringify(base), 'RAMPNOW_INTENT_CONFLICT');
      return intent;
    },
    async get(id, owner) {const found = await owned(id, owner); return found?.intent ?? null;},
    async reserve(id, owner, requestHash) {
      need(hash(requestHash), 'RAMPNOW_INTENT_INVALID');
      return transition(id, owner, requestHash, intent => {
        if (intent.phase !== 'prepared') return {result: {reserved: false, intent}};
        const clock = time(); need(clock < intent.expiresAt, 'RAMPNOW_INTENT_EXPIRED');
        const next = {...intent, phase: 'submitting', updatedAt: Math.max(clock, intent.updatedAt)};
        return {next, expiresAt: intent.expiresAt, result: {reserved: true, intent: next}};
      });
    },
    async markUncertain(id, owner, requestHash) {
      need(hash(requestHash), 'RAMPNOW_INTENT_INVALID');
      return transition(id, owner, requestHash, intent => {
        if (['uncertain', 'bound'].includes(intent.phase)) return {result: intent};
        need(intent.phase === 'submitting', 'RAMPNOW_INTENT_CONFLICT');
        const next = {...intent, phase: 'uncertain', updatedAt: Math.max(time(), intent.updatedAt)};
        return {next, result: next};
      });
    },
    async bind(id, owner, requestHash, provider) {
      identity(id, owner, requestHash); need(hash(requestHash), 'RAMPNOW_INTENT_INVALID');
      need(exactKeys(provider, ['orderUid', 'checkoutUrl']) && identifier(provider.orderUid), 'RAMPNOW_INTENT_INVALID');
      const url = provider.checkoutUrl === null ? null : checkoutUrl(provider.checkoutUrl, 'RAMPNOW_INTENT_INVALID');
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await owned(id, owner, requestHash); need(current, 'RAMPNOW_INTENT_NOT_FOUND');
        const {intent} = current;
        need(['submitting', 'uncertain', 'bound'].includes(intent.phase), 'RAMPNOW_INTENT_CONFLICT');
        if (intent.phase === 'bound') need(intent.orderUid === provider.orderUid
          && (url === null || intent.checkoutUrl === null || intent.checkoutUrl === url), 'RAMPNOW_INTENT_CONFLICT');
        // Lookup reconciliation may have no redirect. Never erase a known URL;
        // only this trusted server-side binding call may fill a missing one.
        const effectiveUrl = intent.phase === 'bound' && intent.checkoutUrl !== null ? intent.checkoutUrl : url;
        const next = intent.phase === 'bound' && intent.checkoutUrl === effectiveUrl ? intent
          : {...intent, phase: 'bound', updatedAt: Math.max(time(), intent.updatedAt), orderUid: provider.orderUid, checkoutUrl: effectiveUrl};
        const result = await redis('EVAL', BIND, 3, intentKey(id), key('binding:' + id), key('order-binding:' + provider.orderUid),
          current.raw, JSON.stringify(next), JSON.stringify(bindingFor(intent, provider.orderUid)), id);
        if (result === 'RETRY') continue;
        if (result === 'CONFLICT') throw new RampnowError('RAMPNOW_INTENT_CONFLICT');
        need(result === 'BOUND'); return next;
      }
      throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');
    },
  });
}
