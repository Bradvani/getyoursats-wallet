/** Sandbox buy checkout contract. Call only after the authenticated intent
 * service has checked provider/network readiness and reserved a durable intent.
 * Creation is never retried here; every uncertain submission needs lookup.
 */
import {createHash} from 'node:crypto';
import {bech32, bech32m, createBase58check} from '@scure/base';
import {normalizeEmail} from './emailCrypto.mjs';
import {RampnowError, rampnowSignature} from './rampnow.mjs';

const CHECKOUT_HOST = 'https://api.sandbox.rampnow.io';
const CHECKOUT_PATH = '/api/partner/v1/ext/ramp_order/checkout';
const RETURN_ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const MAX_RESPONSE = 2 * 1024 * 1024;
const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const need = (condition, code) => { if (!condition) throw new RampnowError(code); };
const base58check = createBase58check(bytes => createHash('sha256').update(bytes).digest());

function testAddress(value) {
  const code = 'RAMPNOW_CHECKOUT_ADDRESS_INVALID';
  need(typeof value === 'string' && value.length >= 14 && value.length <= 90 && value === value.trim(), code);
  try {
    if (/^tb1/i.test(value)) {
      let decoded; let family;
      try { decoded = bech32.decode(value); family = 'bech32'; }
      catch { decoded = bech32m.decode(value); family = 'bech32m'; }
      const version = decoded.words[0];
      const program = bech32.fromWords(decoded.words.slice(1));
      need(decoded.prefix === 'tb' && Number.isInteger(version) && version >= 0 && version <= 16
        && program.length >= 2 && program.length <= 40, code);
      need(version === 0
        ? family === 'bech32' && (program.length === 20 || program.length === 32)
        : family === 'bech32m', code);
      return value.toLowerCase();
    }
    const payload = base58check.decode(value);
    need(payload.length === 21 && (payload[0] === 0x6f || payload[0] === 0xc4), code);
    return value;
  } catch { throw new RampnowError(code); }
}

function legalName(value) {
  need(typeof value === 'string', 'RAMPNOW_CHECKOUT_PROFILE_INVALID');
  const name = value.trim().normalize('NFC');
  need(name.length >= 1 && name.length <= 100 && /\p{L}/u.test(name)
    && !/[\p{Cc}\p{Cf}]/u.test(name), 'RAMPNOW_CHECKOUT_PROFILE_INVALID');
  return name;
}

function profile(value) {
  const code = 'RAMPNOW_CHECKOUT_PROFILE_INVALID';
  need(object(value), code);
  let email;
  try { email = normalizeEmail(value.email); } catch { throw new RampnowError(code); }
  const firstName = legalName(value.firstName);
  const lastName = legalName(value.lastName);
  need(typeof value.phone === 'string' && /^\+[1-9]\d{6,14}$/.test(value.phone), code);
  need(typeof value.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dateOfBirth), code);
  const date = new Date(value.dateOfBirth + 'T00:00:00.000Z');
  need(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.dateOfBirth
    && date.getTime() <= Date.now(), code);
  need(['unknown', 'male', 'female'].includes(value.gender) && value.country === 'IN', code);
  return {email, firstName, lastName, phone: value.phone, dateOfBirth: value.dateOfBirth,
    gender: value.gender, country: 'IN'};
}

/** Testnet and signet share address encoding; the caller must separately bind
 * the confirmed provider network to the authenticated wallet's network.
 * No customer profile is fetched or inferred, and extra input fields are dropped.
 */
export function normalizeRampnowBuyInput(input) {
  need(object(input), 'RAMPNOW_CHECKOUT_INPUT_INVALID');
  need(input.network === 'testnet' || input.network === 'signet', 'RAMPNOW_CHECKOUT_NETWORK_INVALID');
  need(typeof input.srcAmount === 'string' && /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(input.srcAmount)
    && /[1-9]/.test(input.srcAmount), 'RAMPNOW_AMOUNT_INVALID');
  const srcAmount = input.srcAmount.includes('.')
    ? input.srcAmount.replace(/0+$/, '').replace(/\.$/, '') : input.srcAmount;
  return {srcAmount, destination: testAddress(input.destination), network: input.network, user: profile(input.user)};
}

function checkoutReturnUrl(value, externalOrderUid) {
  const code = 'RAMPNOW_CHECKOUT_RETURN_INVALID';
  need(typeof value === 'string' && value.length <= 512 && value.startsWith(RETURN_ORIGIN + '/rampnow/return?')
    && !/[\s\\#]/.test(value), code);
  let url;
  try { url = new URL(value); } catch { throw new RampnowError(code); }
  need(url.origin === RETURN_ORIGIN && !url.username && !url.password && !url.port
    && url.pathname === '/rampnow/return' && [...url.searchParams].length === 1
    && url.searchParams.get('intent') === externalOrderUid, code);
  return RETURN_ORIGIN + '/rampnow/return?intent=' + externalOrderUid;
}

function hostedCheckoutUrl(value) {
  const code = 'RAMPNOW_CHECKOUT_RESPONSE_INVALID';
  need(typeof value === 'string' && value.length <= 8192
    && /^https:\/\/app\.sandbox\.rampnow\.io(?:[/?]|$)/.test(value)
    && !/[\s\\#]/.test(value), code);
  let url;
  try { url = new URL(value); } catch { throw new RampnowError(code); }
  need(url.protocol === 'https:' && url.hostname === 'app.sandbox.rampnow.io'
    && !url.username && !url.password && !url.port && !url.hash, code);
  return url.href;
}

async function checkoutResponse(response) {
  const code = 'RAMPNOW_CHECKOUT_RESPONSE_INVALID';
  need(response.ok && !response.redirected && response.status === 200 && response.body, code);
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_RESPONSE) { await reader.cancel(); throw new RampnowError(code); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  let envelope;
  try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RampnowError(code); }
  need(object(envelope) && envelope.code === 0 && object(envelope.data), code);
  const data = envelope.data;
  need(identifier(data.orderUid) && identifier(data.userUid), code);
  return {orderUid: data.orderUid, userUid: data.userUid, redirectUrl: hostedCheckoutUrl(data.redirectUrl)};
}

export function createRampnowCheckoutClient({apiKey, apiSecret, fetchImpl = fetch, now = Date.now}) {
  need(typeof apiKey === 'string' && apiKey.length > 0 && apiKey.length <= 4096 && !/[\r\n]/.test(apiKey), 'RAMPNOW_KEY_MISSING');
  need(typeof apiSecret === 'string' && apiSecret.length > 0, 'RAMPNOW_SECRET_MISSING');
  return Object.freeze({
    async createBuyOrder(params) {
      need(object(params), 'RAMPNOW_CHECKOUT_INPUT_INVALID');
      const {externalOrderUid, input, returnUrl, paymentMode} = params;
      need(uuid(externalOrderUid), 'RAMPNOW_ORDER_ID_INVALID');
      need(paymentMode === undefined || (typeof paymentMode === 'string'
        && /^[a-z][a-z0-9_]{0,63}$/.test(paymentMode) && paymentMode !== 'unknown'), 'RAMPNOW_PAYMENT_MODE_INVALID');
      const normalized = normalizeRampnowBuyInput(input);
      const body = JSON.stringify({orderType: 'buy', externalOrderUid, srcCurrency: 'INR', srcChain: 'fiat',
        srcAmount: normalized.srcAmount, dstCurrency: 'BTC', dstChain: 'bitcoin', user: normalized.user,
        wallet: {crytpoAccountDetail: {custodyType: 'unhosted', address: normalized.destination}},
        returnUrl: checkoutReturnUrl(returnUrl, externalOrderUid),
        ...(paymentMode === undefined ? {} : {paymentMode})});
      const timestamp = String(Math.floor(now() / 1000));
      const signature = rampnowSignature(apiSecret, timestamp, 'POST', CHECKOUT_PATH, body);
      try {
        const response = await fetchImpl(CHECKOUT_HOST + CHECKOUT_PATH, {method: 'POST', redirect: 'error', cache: 'no-store',
          signal: AbortSignal.timeout(10000), headers: {'Content-Type': 'application/json',
            'X-RAMPNOW-API-KEY': apiKey, 'X-RAMPNOW-TIMESTAMP': timestamp, 'X-RAMPNOW-SIGN': signature}, body});
        return await checkoutResponse(response);
      } catch {
        // Even a malformed/failed response can follow successful creation.
        // Do not retain upstream errors, response bodies, headers or URLs.
        const error = new RampnowError('RAMPNOW_CHECKOUT_UNCERTAIN');
        error.ambiguous = true;
        throw error;
      }
    },
  });
}
