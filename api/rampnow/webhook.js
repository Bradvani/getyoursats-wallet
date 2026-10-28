import {RampnowError, verifyRampnowWebhook} from '../../server/rampnow.mjs';
import {createRampnowStore, sandboxRampnowConfig} from '../../server/rampnowStore.mjs';

// Signature verification requires the original request bytes, never JSON reserialization.
export const config = {api: {bodyParser: false}};
const MAX_BYTES = 64 * 1024;
function reply(res, status, code) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({code}));
}
async function rawBody(req) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (typeof declared !== 'string' || !/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) {
    throw new RampnowError('RAMPNOW_BODY_TOO_LARGE');
  }
  // Vercel's Node request may expose a lazy JSON-parsing body getter. Never
  // access it: only the untouched byte stream is valid signature evidence.
  if (typeof req[Symbol.asyncIterator] !== 'function') throw new RampnowError('RAMPNOW_RAW_BODY_REQUIRED');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) throw new RampnowError('RAMPNOW_RAW_BODY_REQUIRED');
    size += chunk.length;
    if (size > MAX_BYTES) throw new RampnowError('RAMPNOW_BODY_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Injection is for tests only. The deployed export uses server environment. */
export function createWebhookHandler({env = process.env, now = Date.now, storeFactory = createRampnowStore} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(res, 405, 'METHOD_NOT_ALLOWED'); }
    try {
      sandboxRampnowConfig(env);
      if (typeof env.RAMPNOW_API_SECRET !== 'string' || !env.RAMPNOW_API_SECRET) {
        return reply(res, 503, 'WEBHOOK_UNAVAILABLE');
      }
      const bytes = await rawBody(req);
      if (!verifyRampnowWebhook({secret: env.RAMPNOW_API_SECRET,
        timestamp: req.headers['x-rampnow-timestamp'], signature: req.headers['x-rampnow-sign'], rawBody: bytes, now: now()})) {
        return reply(res, 401, 'INVALID_SIGNATURE');
      }
      const event = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      await storeFactory({env, now}).ingest(event);
      // 2xx only follows durable storage. It never asserts wallet settlement.
      return reply(res, 200, 'EVENT_STORED');
    } catch (error) {
      if (error instanceof RampnowError && error.code === 'RAMPNOW_BODY_TOO_LARGE') return reply(res, 413, 'BODY_TOO_LARGE');
      if (error instanceof SyntaxError || error instanceof TypeError || (error instanceof RampnowError
        && ['RAMPNOW_RAW_BODY_REQUIRED', 'RAMPNOW_EVENT_INVALID', 'RAMPNOW_ORDER_MISMATCH', 'RAMPNOW_FILL_INVALID'].includes(error.code))) {
        return reply(res, 400, 'INVALID_EVENT');
      }
      return reply(res, 503, 'WEBHOOK_UNAVAILABLE');
    }
  };
}
export default createWebhookHandler();
