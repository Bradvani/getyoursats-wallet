/** Server-only RampNow integration primitives. No order creation or wallet signing.
 * Contract: https://docs.rampnow.io/api-reference/authentication
 * Checkout submission needs a durable intent ledger first: RampNow does NOT
 * enforce uniqueness of externalOrderUid. Never blindly retry order creation.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const HOSTS = Object.freeze({
  sandbox: 'https://api.sandbox.rampnow.io',
  production: 'https://api.rampnow.io',
});
const ROOT = '/api/partner/v1/ext/ramp_order';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;
export const RAMPNOW_WEBHOOK_PATH = '/api/rampnow/webhook';

export class RampnowError extends Error {
  constructor(code) { super(code); this.name = 'RampnowError'; this.code = code; }
}
function requireValue(condition, code) {
  if (!condition) throw new RampnowError(code);
}
function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function currencyCode(value) { return typeof value === 'string' && /^[A-Z]{3}$/.test(value); }
export function decimalAmount(value, positive = true, precision = 18) {
  return typeof value === 'string' && value.length <= 60
    && /^(0|[1-9]\d*)(\.\d+)?$/.test(value)
    && (value.split('.')[1]?.length ?? 0) <= precision
    && (!positive || /[1-9]/.test(value));
}

export function rampnowSignature(secret, timestamp, method, path, rawBody = '') {
  requireValue(typeof secret === 'string' && secret.length > 0, 'RAMPNOW_SECRET_MISSING');
  requireValue(typeof timestamp === 'string' && /^\d{1,12}$/.test(timestamp), 'RAMPNOW_TIMESTAMP_INVALID');
  requireValue(['GET', 'POST', 'PUT', 'PATCH'].includes(method), 'RAMPNOW_METHOD_INVALID');
  requireValue(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    && !/[\r\n#]/.test(path), 'RAMPNOW_PATH_INVALID');
  requireValue(typeof rawBody === 'string' || Buffer.isBuffer(rawBody), 'RAMPNOW_BODY_INVALID');
  return createHmac('sha256', secret).update(timestamp + method + path).update(rawBody).digest('hex');
}

export function verifyRampnowWebhook({ secret, timestamp, signature, rawBody,
  path = RAMPNOW_WEBHOOK_PATH, now = Date.now() }) {
  if (typeof secret !== 'string' || !secret || !Buffer.isBuffer(rawBody)
    || rawBody.length > MAX_EVENT_BYTES || !Number.isFinite(now)
    || typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)
    || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)
    || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = rampnowSignature(secret, timestamp, 'POST', path, rawBody);
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

/** Use decimal strings throughout; a quote is not a payment authorization. */
export function bitcoinQuoteRequest({ orderType, fiatCurrency, srcAmount, paymentMode }) {
  requireValue(orderType === 'buy' || orderType === 'sell', 'RAMPNOW_DIRECTION_INVALID');
  requireValue(currencyCode(fiatCurrency) && fiatCurrency !== 'BTC', 'RAMPNOW_FIAT_INVALID');
  requireValue(decimalAmount(srcAmount, true, orderType === 'sell' ? 8 : 3), 'RAMPNOW_AMOUNT_INVALID');
  requireValue(paymentMode === undefined || (typeof paymentMode === 'string'
    && /^[a-z][a-z0-9_]{0,63}$/.test(paymentMode)), 'RAMPNOW_PAYMENT_MODE_INVALID');
  return {
    orderType, srcAmount,
    srcCurrency: orderType === 'buy' ? fiatCurrency : 'BTC',
    srcChain: orderType === 'buy' ? 'fiat' : 'bitcoin',
    dstCurrency: orderType === 'buy' ? 'BTC' : fiatCurrency,
    dstChain: orderType === 'buy' ? 'bitcoin' : 'fiat',
    ...(paymentMode === undefined ? {} : { paymentMode }),
  };
}

export function validateBitcoinQuote(quote, request) {
  requireValue(object(quote), 'RAMPNOW_QUOTE_INVALID');
  for (const key of ['orderType', 'srcCurrency', 'srcChain', 'dstCurrency', 'dstChain', 'srcAmount']) {
    // Decimal equality permits the provider to return "100.00" for "100".
    const same = key === 'srcAmount' ? equalDecimal(quote[key], request[key]) : quote[key] === request[key];
    requireValue(same, 'RAMPNOW_QUOTE_MISMATCH');
  }
  requireValue(decimalAmount(quote.dstAmount, true, request.orderType === 'buy' ? 8 : 18), 'RAMPNOW_QUOTE_INVALID');
  requireValue(typeof quote.paymentMode === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(quote.paymentMode)
    && quote.paymentMode !== 'unknown', 'RAMPNOW_QUOTE_INVALID');
  if (request.paymentMode !== undefined) requireValue(quote.paymentMode === request.paymentMode, 'RAMPNOW_QUOTE_MISMATCH');
  requireValue(Array.isArray(quote.feeDetails), 'RAMPNOW_QUOTE_INVALID');
  for (const fee of quote.feeDetails) {
    requireValue(object(fee) && decimalAmount(fee.fee, false) && currencyCode(fee.currency)
      && typeof fee.type === 'string' && fee.type.length > 0 && fee.type.length <= 64
      && typeof fee.isInclusive === 'boolean', 'RAMPNOW_QUOTE_INVALID');
  }
  return quote;
}
function equalDecimal(left, right) {
  if (!decimalAmount(left) || !decimalAmount(right)) return false;
  const normal = value => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return normal(left) === normal(right);
}

async function readResponse(response) {
  requireValue(response.ok && !response.redirected, 'RAMPNOW_UPSTREAM_UNAVAILABLE');
  requireValue(response.body, 'RAMPNOW_RESPONSE_INVALID');
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RampnowError('RAMPNOW_RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requireValue(result?.code === 0 && object(result.data), 'RAMPNOW_RESPONSE_INVALID');
    return result.data;
  } finally { reader.releaseLock(); }
}

/** Fixed provider hosts only. No automatic retries or arbitrary signed requests. */
export function createRampnowClient({ environment, apiKey, apiSecret, fetchImpl = fetch, now = Date.now }) {
  requireValue(Object.hasOwn(HOSTS, environment), 'RAMPNOW_ENVIRONMENT_REQUIRED');
  requireValue(typeof apiKey === 'string' && apiKey.length > 0 && !/[\r\n]/.test(apiKey), 'RAMPNOW_KEY_MISSING');
  requireValue(typeof apiSecret === 'string' && apiSecret.length > 0, 'RAMPNOW_SECRET_MISSING');
  async function request(method, path, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(Math.floor(now() / 1000));
    try {
      const response = await fetchImpl(HOSTS[environment] + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json', 'X-RAMPNOW-API-KEY': apiKey,
          'X-RAMPNOW-TIMESTAMP': timestamp,
          'X-RAMPNOW-SIGN': rampnowSignature(apiSecret, timestamp, method, path, body),
        },
        ...(payload === undefined ? {} : { body }),
      });
      return await readResponse(response);
    } catch (error) {
      // Do not retain vendor bodies, URLs, headers or a credential-bearing cause.
      throw error instanceof RampnowError ? error : new RampnowError('RAMPNOW_UPSTREAM_UNAVAILABLE');
    }
  }
  return Object.freeze({
    getConfig: () => request('GET', ROOT + '/config'),
    getBitcoinAsset(fiatCurrency) {
      requireValue(currencyCode(fiatCurrency), 'RAMPNOW_FIAT_INVALID');
      return request('GET', ROOT + '/asset_config?' + new URLSearchParams({ currency: 'BTC', chain: 'bitcoin', orderCurrency: fiatCurrency }));
    },
    getBlockedCurrencies(country) {
      requireValue(typeof country === 'string' && /^[A-Z]{2}$/.test(country), 'RAMPNOW_COUNTRY_INVALID');
      return request('GET', ROOT + '/blocked_currencies?' + new URLSearchParams({ country }));
    },
    async getBitcoinQuote(input) {
      const quote = bitcoinQuoteRequest(input);
      return validateBitcoinQuote(await request('POST', ROOT + '/quote', quote), quote);
    },
    async findOrders(externalOrderUid) {
      requireValue(identifier(externalOrderUid), 'RAMPNOW_ORDER_ID_INVALID');
      const data = await request('GET', ROOT + '/' + encodeURIComponent(externalOrderUid));
      requireValue(Array.isArray(data.orderList), 'RAMPNOW_RESPONSE_INVALID');
      // Preserve zero/multiple matches for reconciliation; never pick the first.
      return data.orderList;
    },
  });
}

/** Provider status only. This does NOT prove receipt/credit in the GYS wallet. */
export function rampnowOrderState(status) {
  if (status === 'completed') return { phase: 'provider_completed', keepObserving: true };
  if (status === 'failed') return { phase: 'delayed', keepObserving: true };
  if (['payment_failed', 'expired'].includes(status)) return { phase: status, keepObserving: true };
  if (['blocked', 'canceled', 'partially_failed'].includes(status)) return { phase: 'stopped', keepObserving: true };
  if (status === 'created') return { phase: 'awaiting_payment', keepObserving: true };
  return { phase: 'pending', keepObserving: true };
}

/** Call ONLY after raw-body signature verification; persist using an atomic CAS.
 * Dedupe on eventUid in the durable store. A return URL or widget message must
 * never be passed here as authoritative settlement evidence.
 * No bank details/IBAN, email, KYC data, addresses or provider payout refs retained.
 */
export function applyRampnowOrderEvent(previous, event, expected) {
  requireValue(object(event) && identifier(event.eventUid)
    && event.eventType === 'ramp_order.status_change' && object(event.payload), 'RAMPNOW_EVENT_INVALID');
  const p = event.payload;
  requireValue(object(expected) && identifier(expected.orderUid) && identifier(expected.externalOrderUid), 'RAMPNOW_BINDING_REQUIRED');
  for (const key of ['orderUid', 'externalOrderUid', 'orderType', 'srcCurrency', 'srcChain', 'dstCurrency', 'dstChain']) {
    requireValue(typeof expected[key] === 'string' && p[key] === expected[key], 'RAMPNOW_ORDER_MISMATCH');
  }
  requireValue(expected.orderType === 'buy' || expected.orderType === 'sell', 'RAMPNOW_BINDING_REQUIRED');
  const updatedAt = typeof p.updateTime === 'string' && /Z$/.test(p.updateTime) ? Date.parse(p.updateTime) : NaN;
  requireValue(Number.isFinite(updatedAt) && typeof p.orderStatus === 'string'
    && /^[a-z_]{1,64}$/.test(p.orderStatus), 'RAMPNOW_EVENT_INVALID');
  requireValue(decimalAmount(p.dstFillAmount, p.orderStatus === 'completed', expected.orderType === 'buy' ? 8 : 18), 'RAMPNOW_FILL_INVALID');
  if (previous) {
    requireValue(previous.orderUid === expected.orderUid && previous.externalOrderUid === expected.externalOrderUid
      && Number.isFinite(previous.updatedAt), 'RAMPNOW_ORDER_MISMATCH');
    if (event.eventUid === previous.eventUid || updatedAt < previous.updatedAt) return previous;
    if (updatedAt === previous.updatedAt) {
      // Equal timestamps with conflicting status cannot be ordered: poll instead.
      if (p.orderStatus !== previous.status || p.dstFillAmount !== previous.dstFillAmount) {
        return { ...previous, needsReconciliation: true };
      }
      return previous;
    }
  }
  return {
    orderUid: p.orderUid, externalOrderUid: p.externalOrderUid, eventUid: event.eventUid,
    updatedAt, status: p.orderStatus, dstFillAmount: p.dstFillAmount,
    ...rampnowOrderState(p.orderStatus), needsReconciliation: true,
  };
}
