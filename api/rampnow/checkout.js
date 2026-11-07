import {isIP} from 'node:net';
import {RampnowError} from '../../server/rampnow.mjs';
import {createRampnowAuth, hashRampnowPayload} from '../../server/rampnowAuth.mjs';
import {createRampnowIntentStore} from '../../server/rampnowIntentStore.mjs';
import {createRampnowService} from '../../server/rampnowService.mjs';

export const config = {api: {bodyParser: false}};
const ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const BRANCH = 'feat/rampnow-integration-20261028';
const MAX_BYTES = 16 * 1024;
const ACTIONS = new Set(['prepare', 'submit', 'status', 'reconcile']);
const MUTATING = new Set(['prepare', 'submit']);
const unavailable = () => ({available: false, reason: 'unavailable', network: null, environment: 'sandbox', buyOnly: true});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(condition, code = 'RAMPNOW_INVALID_REQUEST') {if (!condition) throw new RampnowError(code);}
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function scoped(env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_PROJECT_ID === 'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa'
    && env.VERCEL_GIT_COMMIT_REF === BRANCH && env.RAMPNOW_ENVIRONMENT === 'sandbox';
}
function configured(env) {
  return typeof env.RAMPNOW_API_KEY === 'string' && env.RAMPNOW_API_KEY.length > 0
    && typeof env.RAMPNOW_API_SECRET === 'string' && env.RAMPNOW_API_SECRET.length > 0;
}
function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const declared = req.headers['content-length'];
  need(declared === undefined || (typeof declared === 'string' && /^\d+$/.test(declared)
    && Number(declared) <= MAX_BYTES), 'RAMPNOW_BODY_TOO_LARGE');
  need(typeof req[Symbol.asyncIterator] === 'function');
  const chunks = []; let size = 0;
  // Avoid Vercel's lazy req.body parser and enforce the bound on actual bytes.
  for await (const chunk of req) {
    need(Buffer.isBuffer(chunk) || chunk instanceof Uint8Array);
    size += chunk.length; need(size <= MAX_BYTES, 'RAMPNOW_BODY_TOO_LARGE'); chunks.push(Buffer.from(chunk));
  }
  try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));}
  catch {throw new RampnowError('RAMPNOW_INVALID_REQUEST');}
}
function validPayload(action, payload) {
  const fields = action === 'prepare' ? ['input'] : action === 'submit'
    ? ['externalOrderUid', 'input', 'quoteHash'] : ['externalOrderUid'];
  need(exactKeys(payload, fields));
  if (action === 'prepare' || action === 'submit') need(object(payload.input));
  if (action !== 'prepare') need(typeof payload.externalOrderUid === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(payload.externalOrderUid));
  if (action === 'submit') need(typeof payload.quoteHash === 'string' && /^[a-f0-9]{64}$/.test(payload.quoteHash));
}
const BAD_INPUT = new Set(['RAMPNOW_INVALID_REQUEST', 'RAMPNOW_AUTH_REQUEST_INVALID', 'RAMPNOW_PAYLOAD_INVALID',
  'RAMPNOW_WALLET_INVALID', 'RAMPNOW_AMOUNT_INVALID', 'RAMPNOW_AMOUNT_OUT_OF_RANGE', 'RAMPNOW_CHECKOUT_ADDRESS_INVALID',
  'RAMPNOW_CHECKOUT_INPUT_INVALID', 'RAMPNOW_CHECKOUT_NETWORK_INVALID', 'RAMPNOW_CHECKOUT_PROFILE_INVALID',
  'RAMPNOW_CHECKOUT_RETURN_INVALID', 'RAMPNOW_ORDER_ID_INVALID', 'RAMPNOW_INTENT_INVALID', 'RAMPNOW_NETWORK_MISMATCH']);
const CONFLICT = new Set(['RAMPNOW_INTENT_CONFLICT', 'RAMPNOW_INTENT_EXPIRED', 'RAMPNOW_INTENT_NOT_FOUND',
  'RAMPNOW_CHECKOUT_UNCERTAIN', 'RAMPNOW_RECONCILIATION_REQUIRED', 'RAMPNOW_QUOTE_CHANGED', 'RAMPNOW_QUOTE_MISMATCH']);
function errorResponse(error) {
  const code = error instanceof RampnowError ? error.code : null;
  if (code === 'RAMPNOW_BODY_TOO_LARGE') return [413, code];
  if (code === 'RAMPNOW_ORIGIN_INVALID') return [403, code];
  if (code === 'RAMPNOW_AUTH_INVALID' || code === 'RAMPNOW_AUTH_CHALLENGE_EXPIRED') return [401, code];
  if (code === 'RAMPNOW_AUTH_RATE_LIMITED' || code === 'RAMPNOW_INTENT_CAPACITY') return [429, code];
  if (BAD_INPUT.has(code)) return [400, code];
  if (CONFLICT.has(code)) return [409, code];
  if (code === 'RAMPNOW_CHECKOUT_DISABLED') return [503, code];
  return [503, 'RAMPNOW_UNAVAILABLE'];
}

export function createRampnowCheckoutHandler({env = process.env, now = Date.now,
  storeFactory = createRampnowIntentStore, serviceFactory = createRampnowService, authFactory = createRampnowAuth} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST'); return reply(res, 405, {error: 'RAMPNOW_METHOD_NOT_ALLOWED'});
    }
    if (!scoped(env) || !configured(env)) {
      return reply(res, req.method === 'GET' ? 200 : 503, req.method === 'GET' ? unavailable() : {error: 'RAMPNOW_UNAVAILABLE'});
    }
    try {
      if (req.method === 'GET') {
        const store = storeFactory({env, now});
        return reply(res, 200, await serviceFactory({env, store, now}).availability());
      }
      need(req.headers.origin === ORIGIN, 'RAMPNOW_ORIGIN_INVALID');
      const type = req.headers['content-type'];
      need(typeof type === 'string' && type.split(';')[0].trim().toLowerCase() === 'application/json');
      const body = await readBody(req);
      need(object(body));
      const challenge = body.action === 'challenge';
      need(exactKeys(body, challenge ? ['action', 'purpose', 'walletPubkey', 'payload']
        : ['action', 'payload', 'challengeId', 'signature']));
      const action = challenge ? body.purpose : body.action;
      need(ACTIONS.has(action)); validPayload(action, body.payload);
      if (MUTATING.has(action)) need(env.RAMPNOW_CHECKOUT_ENABLED === 'true', 'RAMPNOW_CHECKOUT_DISABLED');
      const payloadHash = hashRampnowPayload(body.payload);
      let clientKey;
      if (challenge) {
        clientKey = req.headers['x-vercel-forwarded-for'];
        need(typeof clientKey === 'string' && isIP(clientKey) !== 0);
      }
      const store = storeFactory({env, now});
      const auth = authFactory({redis: store.redis, secret: env.RAMPNOW_API_SECRET, origin: ORIGIN, now});
      if (challenge) {
        return reply(res, 200, await auth.issue({walletPubkey: body.walletPubkey, action, payloadHash, clientKey}));
      }
      const proof = await auth.consume({challengeId: body.challengeId, signature: body.signature, action, payloadHash});
      if (MUTATING.has(action)) need(env.RAMPNOW_CHECKOUT_ENABLED === 'true', 'RAMPNOW_CHECKOUT_DISABLED');
      const service = serviceFactory({env, store, now});
      const result = action === 'prepare' ? await service.prepare(proof.walletPubkey, body.payload.input)
        : action === 'submit' ? await service.submit(proof.walletPubkey, body.payload)
          : await service[action](proof.walletPubkey, body.payload.externalOrderUid);
      return reply(res, 200, result);
    } catch (error) {
      if (req.method === 'GET') return reply(res, 200, unavailable());
      const [status, code] = errorResponse(error);
      return reply(res, status, {error: code});
    }
  };
}
export default createRampnowCheckoutHandler();
