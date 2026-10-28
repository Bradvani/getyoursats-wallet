/** Sandbox-only, purpose-separated wallet proofs. No payment or provider calls. */
import {createHash, createHmac, createPublicKey, ECDH, randomBytes, verify} from 'node:crypto';
import {RampnowError} from './rampnow.mjs';
import {RAMPNOW_STORE_PREFIX} from './rampnowStore.mjs';

const ACTIONS = new Set(['prepare', 'submit', 'status', 'reconcile']);
const TTL = 300;
const RATE_TTL = 3600;
const RATE_LIMIT = 25;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const PREFIX = RAMPNOW_STORE_PREFIX + 'auth:';
const need = (condition, code) => {if (!condition) throw new RampnowError(code);};
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Canonical JSON: sorted object keys, preserved array order and finite JSON
 * primitives only. No getters, toJSON, custom prototypes, holes or extra array
 * properties are evaluated. Bounded depth/nodes complement the 16 KiB limit.
 */
export function hashRampnowPayload(value) {
  const code = 'RAMPNOW_PAYLOAD_INVALID';
  const active = new WeakSet(); const parts = []; let bytes = 0; let nodes = 0;
  const append = part => {
    bytes += Buffer.byteLength(part, 'utf8'); need(bytes <= MAX_PAYLOAD_BYTES, code); parts.push(part);
  };
  const string = input => {need(input.length <= MAX_PAYLOAD_BYTES, code); append(JSON.stringify(input));};
  function visit(input, depth) {
    need(depth <= 32 && ++nodes <= 4096, code);
    if (input === null) return append('null');
    if (typeof input === 'string') return string(input);
    if (typeof input === 'boolean') return append(input ? 'true' : 'false');
    if (typeof input === 'number') {need(Number.isFinite(input), code); return append(JSON.stringify(input));}
    need(typeof input === 'object' && !active.has(input), code);
    const array = Array.isArray(input);
    need(Object.getPrototypeOf(input) === (array ? Array.prototype : Object.prototype), code);
    need(Object.getOwnPropertySymbols(input).length === 0, code);
    const names = Object.getOwnPropertyNames(input);
    need(names.length <= 4096, code);
    active.add(input);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
      need(Number.isSafeInteger(length) && length >= 0 && length <= 4095 && names.length === length + 1, code);
      append('[');
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, code);
        if (index) append(','); visit(descriptor.value, depth + 1);
      }
      append(']');
    } else {
      append('{');
      for (const [index, name] of names.sort().entries()) {
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, code);
        if (index) append(','); string(name); append(':'); visit(descriptor.value, depth + 1);
      }
      append('}');
    }
    active.delete(input);
  }
  try {visit(value, 0);} catch {throw new RampnowError(code);}
  return createHash('sha256').update(parts.join('')).digest('hex');
}

function walletKey(value) {
  need(typeof value === 'string' && /^(02|03)[a-f0-9]{64}$/i.test(value), 'RAMPNOW_WALLET_INVALID');
  try {ECDH.convertKey(value, 'secp256k1', 'hex', 'hex', 'uncompressed');}
  catch {throw new RampnowError('RAMPNOW_WALLET_INVALID');}
  return value.toLowerCase();
}
function canonicalOrigin(value) {
  try {
    const url = new URL(value);
    need(typeof value === 'string' && value.length <= 255 && url.protocol === 'https:'
      && url.origin === value && !url.username && !url.password, 'RAMPNOW_AUTH_CONFIGURATION_INVALID');
    return value;
  } catch {throw new RampnowError('RAMPNOW_AUTH_CONFIGURATION_INVALID');}
}
function messageOf(record) {
  return 'gys-rampnow-v1:' + JSON.stringify(['sandbox', record.origin, record.action,
    record.payloadHash, record.challengeId, record.walletPubkey]);
}

export function verifyRampnowWalletProof(message, pubkey, signature) {
  try {
    const pub = walletKey(pubkey);
    if (typeof message !== 'string' || message.length > 1024 || !message.startsWith('gys-rampnow-v1:')
      || typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)) return false;
    const fields = JSON.parse(message.slice('gys-rampnow-v1:'.length));
    if (!Array.isArray(fields) || fields.length !== 6 || fields[0] !== 'sandbox'
      || !ACTIONS.has(fields[2]) || !validHash(fields[3])
      || typeof fields[4] !== 'string' || !/^[a-f0-9]{36}$/.test(fields[4]) || fields[5] !== pub) return false;
    canonicalOrigin(fields[1]);
    if (message !== 'gys-rampnow-v1:' + JSON.stringify(fields)) return false;
    const uncompressed = ECDH.convertKey(pub, 'secp256k1', 'hex', 'hex', 'uncompressed');
    const spki = Buffer.concat([Buffer.from('3056301006072a8648ce3d020106052b8104000a03420004', 'hex'),
      Buffer.from(uncompressed.slice(2), 'hex')]);
    return verify('sha256', Buffer.from(message, 'utf8'),
      {key: createPublicKey({key: spki, format: 'der', type: 'spki'}), dsaEncoding: 'ieee-p1363'}, Buffer.from(signature, 'hex'));
  } catch {return false;}
}

const RATE_SCRIPT = `local limit=tonumber(ARGV[1]);local window=tonumber(ARGV[2])
for _,key in ipairs(KEYS) do
  local kind=redis.call('TYPE',key).ok
  if kind~='none' and kind~='string' then return redis.error_reply('Invalid auth rate type') end
  local value=redis.call('GET',key)
  if value then
    local count=tonumber(value);local ttl=redis.call('TTL',key)
    if not string.match(value,'^[1-9][0-9]*$') or not count or count>limit or ttl<0 or ttl>window then
      return redis.error_reply('Invalid auth rate state') end
    if count>=limit then return 0 end
  end
end
for _,key in ipairs(KEYS) do local count=redis.call('INCR',key);if count==1 then redis.call('EXPIRE',key,window) end end
return 1`;

export function createRampnowAuth({redis, secret, origin, now = Date.now}) {
  need(typeof redis === 'function' && typeof secret === 'string' && secret.length > 0 && secret.length <= 4096
    && typeof now === 'function', 'RAMPNOW_AUTH_CONFIGURATION_INVALID');
  const trustedOrigin = canonicalOrigin(origin);
  const clock = () => {const value = now(); need(Number.isSafeInteger(value) && value > 0, 'RAMPNOW_AUTH_UNAVAILABLE'); return value;};
  const hashed = value => createHmac('sha256', secret).update('gys-rampnow-auth-rate-v1:' + value).digest('hex');
  async function command(...args) {
    try {return await redis(...args);} catch {throw new RampnowError('RAMPNOW_AUTH_UNAVAILABLE');}
  }
  return Object.freeze({
    async issue({walletPubkey, action, payloadHash, clientKey}) {
      const pub = walletKey(walletPubkey);
      need(ACTIONS.has(action) && validHash(payloadHash), 'RAMPNOW_AUTH_REQUEST_INVALID');
      need(typeof clientKey === 'string' && clientKey.length > 0 && clientKey.length <= 256
        && !/[\x00-\x20\x7f]/.test(clientKey), 'RAMPNOW_AUTH_REQUEST_INVALID');
      const issuedAt = clock();
      const allowed = await command('EVAL', RATE_SCRIPT, 2, PREFIX + 'rate:' + hashed('ip:' + clientKey),
        PREFIX + 'rate:' + hashed('wallet:' + pub), RATE_LIMIT, RATE_TTL);
      need(allowed === 0 || allowed === 1, 'RAMPNOW_AUTH_UNAVAILABLE');
      need(allowed === 1, 'RAMPNOW_AUTH_RATE_LIMITED');
      const challengeId = randomBytes(18).toString('hex');
      const record = {environment: 'sandbox', origin: trustedOrigin, walletPubkey: pub, action,
        payloadHash, challengeId, issuedAt};
      const result = await command('SET', PREFIX + 'challenge:' + challengeId, JSON.stringify(record), 'EX', TTL, 'NX');
      need(result === 'OK', 'RAMPNOW_AUTH_UNAVAILABLE');
      return {challengeId, message: messageOf(record), expiresIn: TTL};
    },
    async consume({challengeId, signature, action, payloadHash}) {
      need(typeof challengeId === 'string' && /^[a-f0-9]{36}$/.test(challengeId), 'RAMPNOW_AUTH_REQUEST_INVALID');
      // Consume once before checking action, payload, signature or stored data.
      const raw = await command('GETDEL', PREFIX + 'challenge:' + challengeId);
      need(raw !== null && raw !== undefined, 'RAMPNOW_AUTH_CHALLENGE_EXPIRED');
      let record;
      try {
        need(typeof raw === 'string' && Buffer.byteLength(raw) <= 2048, 'RAMPNOW_AUTH_INVALID');
        record = JSON.parse(raw);
        need(record && typeof record === 'object' && !Array.isArray(record), 'RAMPNOW_AUTH_INVALID');
        const current = clock();
        need(record.environment === 'sandbox' && record.origin === trustedOrigin && record.challengeId === challengeId
          && walletKey(record.walletPubkey) === record.walletPubkey && ACTIONS.has(action) && record.action === action
          && validHash(payloadHash) && record.payloadHash === payloadHash && Number.isSafeInteger(record.issuedAt)
          && record.issuedAt > 0 && record.issuedAt <= current && current - record.issuedAt < TTL * 1000
          && verifyRampnowWalletProof(messageOf(record), record.walletPubkey, signature), 'RAMPNOW_AUTH_INVALID');
      } catch {throw new RampnowError('RAMPNOW_AUTH_INVALID');}
      return {walletPubkey: record.walletPubkey, action: record.action, payloadHash: record.payloadHash};
    },
  });
}
