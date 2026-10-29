const SANDBOX_ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const ENDPOINT = '/api/rampnow/checkout';
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const encoder = new TextEncoder();

const SAFE_MESSAGES = {
  RAMPNOW_UNAVAILABLE: 'Sandbox checkout is unavailable. Please check again later.',
  RAMPNOW_ORIGIN_INVALID: 'Open sandbox checkout from the wallet preview.',
  RAMPNOW_WALLET_INVALID: 'Reconnect your wallet before opening sandbox checkout.',
  RAMPNOW_PAYLOAD_INVALID: 'Check the checkout details before continuing.',
  RAMPNOW_CHECKOUT_INPUT_INVALID: 'Check the checkout details before continuing.',
  RAMPNOW_CHECKOUT_PROFILE_INVALID: 'Check your personal details before continuing.',
  RAMPNOW_CHECKOUT_ADDRESS_INVALID: 'Check the test Bitcoin address before continuing.',
  RAMPNOW_CHECKOUT_NETWORK_INVALID: 'This Bitcoin network is unavailable for sandbox checkout.',
  RAMPNOW_AMOUNT_INVALID: 'Check the purchase amount before continuing.',
  RAMPNOW_AMOUNT_OUT_OF_RANGE: 'Choose an amount within the provider purchase limits.',
  RAMPNOW_NETWORK_MISMATCH: 'This wallet network does not match the sandbox checkout network.',
  RAMPNOW_ORDER_ID_INVALID: 'This checkout reference is invalid.',
  RAMPNOW_AUTH_INVALID: 'Could not verify the checkout request. Reconnect your wallet.',
  RAMPNOW_AUTH_CHALLENGE_EXPIRED: 'The checkout request expired. Review it again before continuing.',
  RAMPNOW_AUTH_RATE_LIMITED: 'Too many checkout requests. Please wait before continuing.',
  RAMPNOW_SIGNING_FAILED: 'Could not authorize the checkout request with your wallet.',
  RAMPNOW_RESPONSE_INVALID: 'Could not verify the checkout response. Check its status before continuing.',
  RAMPNOW_RESPONSE_TOO_LARGE: 'Could not verify the checkout response. Check its status before continuing.',
  RAMPNOW_REQUEST_TIMEOUT: 'Could not confirm checkout. Check its status before continuing.',
  RAMPNOW_REQUEST_FAILED: 'Could not confirm checkout. Check its status before continuing.',
  RAMPNOW_CHECKOUT_UNCERTAIN: 'Checkout may have started. Check its status before continuing.',
  RAMPNOW_RECONCILIATION_REQUIRED: 'Checkout may have started. Check its status before continuing.',
  RAMPNOW_CHECKOUT_DISABLED: 'Sandbox checkout is currently disabled.',
  RAMPNOW_INTENT_EXPIRED: 'This quote expired. Review a new quote before continuing.',
  RAMPNOW_INTENT_CONFLICT: 'This checkout has changed. Check its status before continuing.',
  RAMPNOW_INTENT_NOT_FOUND: 'This checkout could not be found for your wallet.',
  RAMPNOW_QUOTE_MISMATCH: 'This quote has changed. Review a new quote before continuing.',
  RAMPNOW_QUOTE_CHANGED: 'This quote has changed. Review a new quote before continuing.',
  RAMPNOW_QUOTE_INVALID: 'Could not verify the quote. Review a new quote before continuing.',
} as const;

export type RampnowErrorCode = keyof typeof SAFE_MESSAGES;

export class RampnowClientError extends Error {
  readonly code: RampnowErrorCode;

  constructor(code: RampnowErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'RampnowClientError';
    this.code = code;
  }
}

export interface RampnowBuyInput {
  srcAmount: string;
  destination: string;
  network: 'signet';
  user: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: 'male' | 'female' | 'unknown';
    country: 'IN';
  };
}

export interface RampnowAvailability {
  available: boolean;
  reason: 'ready' | 'network_or_route_unavailable' | 'checkout_disabled' | 'unavailable';
  network: RampnowBuyInput['network'] | null;
  environment: 'sandbox';
  buyOnly: true;
}

export interface RampnowQuote {
  orderType: 'buy';
  srcCurrency: 'INR';
  srcChain: 'fiat';
  dstCurrency: 'BTC';
  dstChain: 'bitcoin';
  srcAmount: string;
  dstAmount: string;
  paymentMode: string;
  feeDetails: {type: string; fee: string; currency: string; isInclusive: boolean}[];
}

export interface RampnowPreparedCheckout {
  externalOrderUid: string;
  quoteHash: string;
  quote: RampnowQuote;
  expiresAt: number;
  destination: string;
  network: RampnowBuyInput['network'];
}

export interface RampnowCheckoutStatus {
  externalOrderUid: string;
  phase: 'prepared' | 'submitting' | 'uncertain' | 'bound';
  orderUid: string | null;
  checkoutUrl: string | null;
  providerStatus: string | null;
  dstFillAmount: string | null;
  needsReconciliation: true;
  walletReceiptVerified: false;
  reconciliation?: 'matched' | 'not_found' | 'ambiguous' | 'mismatch' | 'not_submitted';
}

export interface RampnowSubmitInput {
  externalOrderUid: string;
  input: RampnowBuyInput;
  quoteHash: string;
}

interface RampnowBrowserClientOptions {
  walletPubkey: string;
  signMessage: (message: string) => Promise<{pubkey: string; signature: string}>;
  fetchImpl?: typeof fetch;
  origin?: string;
}

type Purpose = 'prepare' | 'submit' | 'status' | 'reconcile';
type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
type JsonObject = {[key: string]: Json};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const need: (condition: unknown, code?: RampnowErrorCode) => asserts condition =
  (condition, code = 'RAMPNOW_RESPONSE_INVALID') => { if (!condition) throw new RampnowClientError(code); };
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const network = (value: unknown): value is RampnowBuyInput['network'] => value === 'signet';
const decimal = (value: unknown, positive = false, precision = 18): value is string =>
  typeof value === 'string' && value.length <= 60 && /^(0|[1-9]\d*)(\.\d+)?$/.test(value)
  && (value.split('.')[1]?.length ?? 0) <= precision && (!positive || /[1-9]/.test(value));
const normalizedDecimal = (value: string) => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safeCode = (value: unknown): RampnowErrorCode => typeof value === 'string'
  && Object.prototype.hasOwnProperty.call(SAFE_MESSAGES, value) ? value as RampnowErrorCode : 'RAMPNOW_UNAVAILABLE';

// Match the server's canonical JSON without invoking getters or toJSON. A copy
// also pins the payload while a wallet prompt or network request is pending.
function canonicalJson(value: unknown): string {
  const code = 'RAMPNOW_PAYLOAD_INVALID';
  const active = new WeakSet<object>();
  const parts: string[] = [];
  let bytes = 0;
  let nodes = 0;
  const append = (part: string) => {
    bytes += encoder.encode(part).byteLength;
    need(bytes <= MAX_PAYLOAD_BYTES, code);
    parts.push(part);
  };
  const string = (input: string) => { need(input.length <= MAX_PAYLOAD_BYTES, code); append(JSON.stringify(input)); };
  function visit(input: unknown, depth: number): void {
    need(depth <= 32 && ++nodes <= 4096, code);
    if (input === null) return append('null');
    if (typeof input === 'string') return string(input);
    if (typeof input === 'boolean') return append(input ? 'true' : 'false');
    if (typeof input === 'number') { need(Number.isFinite(input), code); return append(JSON.stringify(input)); }
    need(typeof input === 'object' && !active.has(input), code);
    const array = Array.isArray(input);
    need(Object.getPrototypeOf(input) === (array ? Array.prototype : Object.prototype), code);
    need(Object.getOwnPropertySymbols(input).length === 0, code);
    const names = Object.getOwnPropertyNames(input);
    need(names.length <= 4096, code);
    active.add(input);
    if (array) {
      const length: unknown = Object.getOwnPropertyDescriptor(input, 'length')?.value;
      need(typeof length === 'number' && Number.isSafeInteger(length) && length >= 0
        && length <= 4095 && names.length === length + 1, code);
      append('[');
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        need(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.enumerable, code);
        if (index) append(',');
        visit(descriptor.value, depth + 1);
      }
      append(']');
    } else {
      append('{');
      for (const [index, name] of names.sort().entries()) {
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        need(descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.enumerable, code);
        if (index) append(',');
        string(name); append(':'); visit(descriptor.value, depth + 1);
      }
      append('}');
    }
    active.delete(input);
  }
  try { visit(value, 0); } catch { throw new RampnowClientError(code); }
  return parts.join('');
}

async function payloadHash(value: string): Promise<string> {
  try {
    const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { throw new RampnowClientError('RAMPNOW_AUTH_INVALID'); }
}

function checkoutUrl(value: unknown): string | null {
  if (value === null) return null;
  need(typeof value === 'string' && value.length <= 8192
    && /^https:\/\/app\.sandbox\.rampnow\.io(?:[/?]|$)/.test(value) && !/[\s\\#]/.test(value));
  try {
    const url = new URL(value);
    need(url.protocol === 'https:' && url.hostname === 'app.sandbox.rampnow.io'
      && !url.username && !url.password && !url.port && !url.hash);
    return url.href;
  } catch { throw new RampnowClientError('RAMPNOW_RESPONSE_INVALID'); }
}

function parseStatus(value: unknown, expectedId: string): RampnowCheckoutStatus {
  need(object(value) && uuid(value.externalOrderUid) && value.externalOrderUid === expectedId);
  need(value.phase === 'prepared' || value.phase === 'submitting' || value.phase === 'uncertain' || value.phase === 'bound');
  need(value.orderUid === null || identifier(value.orderUid));
  need(value.providerStatus === null || (typeof value.providerStatus === 'string' && /^[a-z_]{1,64}$/.test(value.providerStatus)));
  need(value.dstFillAmount === null || decimal(value.dstFillAmount, false, 8));
  need(value.needsReconciliation === true && value.walletReceiptVerified === false);
  const url = checkoutUrl(value.checkoutUrl);
  need(value.phase === 'bound' ? identifier(value.orderUid) : value.orderUid === null && url === null);
  need(value.reconciliation === undefined || value.reconciliation === 'matched' || value.reconciliation === 'not_found'
    || value.reconciliation === 'ambiguous' || value.reconciliation === 'mismatch' || value.reconciliation === 'not_submitted');
  return {
    externalOrderUid: value.externalOrderUid, phase: value.phase, orderUid: value.orderUid, checkoutUrl: url,
    providerStatus: value.providerStatus, dstFillAmount: value.dstFillAmount,
    needsReconciliation: true, walletReceiptVerified: false,
    ...(value.reconciliation === undefined ? {} : {reconciliation: value.reconciliation}),
  };
}

function parsePrepared(value: unknown, input: RampnowBuyInput): RampnowPreparedCheckout {
  need(object(value) && uuid(value.externalOrderUid) && hash(value.quoteHash));
  need(typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0);
  const destination = /^tb1/i.test(input.destination) ? input.destination.toLowerCase() : input.destination;
  need(value.destination === destination && network(value.network) && value.network === input.network);
  const quote = value.quote;
  need(object(quote) && quote.orderType === 'buy' && quote.srcCurrency === 'INR' && quote.srcChain === 'fiat'
    && quote.dstCurrency === 'BTC' && quote.dstChain === 'bitcoin');
  need(decimal(quote.srcAmount, true, 3) && normalizedDecimal(quote.srcAmount) === normalizedDecimal(input.srcAmount)
    && decimal(quote.dstAmount, true, 8));
  need(typeof quote.paymentMode === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(quote.paymentMode)
    && quote.paymentMode !== 'unknown' && Array.isArray(quote.feeDetails) && quote.feeDetails.length <= 20);
  const feeDetails = quote.feeDetails.map(fee => {
    need(object(fee) && typeof fee.type === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(fee.type)
      && decimal(fee.fee) && typeof fee.currency === 'string' && /^[A-Z]{3,6}$/.test(fee.currency)
      && typeof fee.isInclusive === 'boolean');
    return {type: fee.type, fee: fee.fee, currency: fee.currency, isInclusive: fee.isInclusive};
  });
  return {
    externalOrderUid: value.externalOrderUid, quoteHash: value.quoteHash, expiresAt: value.expiresAt,
    destination: value.destination, network: value.network,
    quote: {orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin',
      srcAmount: quote.srcAmount, dstAmount: quote.dstAmount, paymentMode: quote.paymentMode, feeDetails},
  };
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  need(!response.redirected && response.body && response.headers.get('content-type')?.split(';')[0].trim() === 'application/json');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new RampnowClientError('RAMPNOW_RESPONSE_TOO_LARGE');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RampnowClientError('RAMPNOW_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
    catch { throw new RampnowClientError('RAMPNOW_RESPONSE_INVALID'); }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export function createRampnowBrowserClient({walletPubkey, signMessage, fetchImpl = fetch, origin}: RampnowBrowserClientOptions) {
  const currentOrigin = typeof window === 'undefined' ? null : window.location.origin;
  need(currentOrigin === SANDBOX_ORIGIN && (origin === undefined || origin === currentOrigin), 'RAMPNOW_ORIGIN_INVALID');
  need(typeof walletPubkey === 'string' && /^(02|03)[a-f0-9]{64}$/i.test(walletPubkey), 'RAMPNOW_WALLET_INVALID');
  need(typeof signMessage === 'function' && typeof fetchImpl === 'function', 'RAMPNOW_WALLET_INVALID');
  const pubkey = walletPubkey.toLowerCase();
  const assertOrigin = () => need(window.location.origin === currentOrigin, 'RAMPNOW_ORIGIN_INVALID');

  async function request(body?: JsonObject): Promise<unknown> {
    assertOrigin();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new RampnowClientError('RAMPNOW_REQUEST_TIMEOUT'));
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    });
    const perform = async () => {
      const response = await fetchImpl(currentOrigin + ENDPOINT, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: controller.signal, headers: {'Accept': 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });
      const result = await readJson(response, controller.signal);
      if (!response.ok) {
        throw new RampnowClientError(safeCode(object(result) ? result.error ?? result.code : null));
      }
      need(response.status === 200);
      return result;
    };
    try { return await Promise.race([perform(), timeout]); }
    catch (error) {
      if (error instanceof RampnowClientError) throw error;
      throw new RampnowClientError('RAMPNOW_REQUEST_FAILED');
    } finally { clearTimeout(timer); }
  }

  async function authenticated(purpose: Purpose, inputPayload: unknown): Promise<unknown> {
    const encoded = canonicalJson(inputPayload);
    const payload: JsonObject = JSON.parse(encoded);
    const digest = await payloadHash(encoded);
    const startedAt = Date.now();
    const challenge = await request({action: 'challenge', purpose, walletPubkey: pubkey, payload});
    need(object(challenge) && Object.keys(challenge).sort().join(',') === 'challengeId,expiresIn,message'
      && typeof challenge.challengeId === 'string' && /^[a-f0-9]{36}$/.test(challenge.challengeId)
      && challenge.expiresIn === 300, 'RAMPNOW_AUTH_INVALID');
    const message = 'gys-rampnow-v1:' + canonicalJson(['sandbox', currentOrigin, purpose, digest, challenge.challengeId, pubkey]);
    need(challenge.message === message, 'RAMPNOW_AUTH_INVALID');
    assertOrigin();
    let signed: {pubkey: string; signature: string};
    try { signed = await signMessage(message); }
    catch { throw new RampnowClientError('RAMPNOW_SIGNING_FAILED'); }
    need(object(signed) && typeof signed.pubkey === 'string' && signed.pubkey.toLowerCase() === pubkey
      && typeof signed.signature === 'string' && /^[a-f0-9]{128}$/i.test(signed.signature), 'RAMPNOW_AUTH_INVALID');
    need(Date.now() >= startedAt && Date.now() - startedAt < 300_000, 'RAMPNOW_AUTH_CHALLENGE_EXPIRED');
    return request({action: purpose, payload, challengeId: challenge.challengeId, signature: signed.signature.toLowerCase()});
  }

  return Object.freeze({
    async availability(): Promise<RampnowAvailability> {
      const value = await request();
      need(object(value) && typeof value.available === 'boolean' && value.environment === 'sandbox' && value.buyOnly === true);
      need(value.network === null || network(value.network));
      need(!value.available || network(value.network));
      need(value.reason === 'ready' || value.reason === 'network_or_route_unavailable'
        || value.reason === 'checkout_disabled' || value.reason === 'unavailable');
      need(value.available === (value.reason === 'ready'));
      return {available: value.available, reason: value.reason,
        network: value.network, environment: 'sandbox', buyOnly: true};
    },
    async prepare(input: RampnowBuyInput): Promise<RampnowPreparedCheckout> {
      const copy: RampnowBuyInput = JSON.parse(canonicalJson(input));
      need(object(copy) && typeof copy.srcAmount === 'string' && typeof copy.destination === 'string'
        && network(copy.network), 'RAMPNOW_CHECKOUT_INPUT_INVALID');
      return parsePrepared(await authenticated('prepare', {input: copy}), copy);
    },
    async submit(input: RampnowSubmitInput): Promise<RampnowCheckoutStatus> {
      const copy: RampnowSubmitInput = JSON.parse(canonicalJson(input));
      need(object(copy) && uuid(copy.externalOrderUid) && hash(copy.quoteHash)
        && object(copy.input) && network(copy.input.network), 'RAMPNOW_CHECKOUT_INPUT_INVALID');
      return parseStatus(await authenticated('submit', copy), copy.externalOrderUid);
    },
    async status(externalOrderUid: string): Promise<RampnowCheckoutStatus> {
      need(uuid(externalOrderUid), 'RAMPNOW_ORDER_ID_INVALID');
      return parseStatus(await authenticated('status', {externalOrderUid}), externalOrderUid);
    },
    async reconcile(externalOrderUid: string): Promise<RampnowCheckoutStatus> {
      need(uuid(externalOrderUid), 'RAMPNOW_ORDER_ID_INVALID');
      return parseStatus(await authenticated('reconcile', {externalOrderUid}), externalOrderUid);
    },
  });
}
