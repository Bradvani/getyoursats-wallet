import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

const allowedOrigins = new Set(['https://getyoursats.com', 'https://www.getyoursats.com']);
const topicLabels = Object.freeze({
  support: 'Wallet & payment help',
  feedback: 'Product feedback & ideas',
  partnership: 'Partnerships & affiliations',
  media: 'Media & community collaborations',
  privacy: 'Privacy & data requests',
  general: 'General enquiry',
});
const legacyTopics = Object.freeze({ wallet: 'support', payment: 'support', recovery: 'support', mining: 'general' });
const PREFIX = 'gys:support:v1:';
const DAY = 86_400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Reserve before delivery: a timeout may still have sent the email. The 20-send
// daily support budget fits beside the wallet's 80-send verification budget.
const RESERVE = `local prior=redis.call('GET',KEYS[1])
if prior then
  local hash,tries=string.match(prior,'^([0-9a-f]+):([1-4])$')
  local ttl=redis.call('PTTL',KEYS[1])
  if not hash or #hash~=64 or ttl<1 or ttl>86400000 then return redis.error_reply('Invalid submission state') end
  if hash~=ARGV[1] then return {1,0} end
  if tonumber(tries)>=4 then return {2,math.ceil(ttl/1000)} end
  redis.call('SET',KEYS[1],hash..':'..(tonumber(tries)+1),'KEEPTTL')
  return {0,0}
end
for i=2,#KEYS do
  local value=redis.call('GET',KEYS[i])
  if value then
    local count=tonumber(value)
    local ttl=redis.call('PTTL',KEYS[i])
    if not string.match(value,'^[1-9][0-9]*$') or not count or count>9007199254740991 or ttl<1 or ttl>tonumber(ARGV[(i-2)*2+3])*1000 then
      return redis.error_reply('Invalid support budget state')
    end
    if count>=tonumber(ARGV[(i-2)*2+2]) then return {i+1,math.ceil(ttl/1000)} end
  end
end
for i=2,#KEYS do
  local count=redis.call('INCR',KEYS[i])
  if count==1 then
    if i==2 then redis.call('EXPIREAT',KEYS[i],ARGV[8])
    else redis.call('EXPIRE',KEYS[i],ARGV[(i-2)*2+3]) end
  end
end
redis.call('SET',KEYS[1],ARGV[1]..':1','EX',86400)
return {0,0}`;

function storageConfig() {
  const explicit = [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN];
  const integrated = [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN];
  const [endpoint, token] = explicit.some(Boolean) ? explicit : integrated;
  if (!endpoint || !token) throw new Error('Storage unavailable');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Storage unavailable');
  return { url: url.href, token };
}
function available() {
  try { storageConfig(); } catch { return false; }
  return Boolean(process.env.RESEND_API_KEY && process.env.GETYOURSATS_SUPPORT_TO && process.env.GETYOURSATS_SUPPORT_FROM);
}
function respond(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}
async function reserve(id, payload, ip) {
  const storage = storageConfig();
  const digest = (value) => createHmac('sha256', storage.token).update('gys-support-v1:' + value).digest('hex');
  const now = Date.now();
  const day = Math.floor(now / (DAY * 1000));
  const command = ['EVAL', RESERVE, 4,
    PREFIX + 'submission:' + id, PREFIX + 'day:' + day,
    PREFIX + 'ip:' + digest(ip), PREFIX + 'email:' + digest(payload.email.toLowerCase()),
    digest(JSON.stringify(payload)), 20, DAY, 4, 3600, 4, DAY, (day + 1) * DAY];
  const response = await fetch(storage.url, {
    method: 'POST', headers: { Authorization: 'Bearer ' + storage.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(7500),
  });
  if (!response.ok) throw new Error('Storage unavailable');
  const result = await response.json();
  const value = result?.result;
  if (result?.error || !Array.isArray(value) || value.length !== 2 || !value.every(Number.isSafeInteger)
    || value[0] < 0 || value[0] > 5 || value[1] < 0 || value[1] > DAY
    || (value[0] <= 1 && value[1] !== 0) || (value[0] > 1 && value[1] === 0)) throw new Error('Storage unavailable');
  return value;
}

export default async function handler(req, res) {
  if (req.method === 'GET') return respond(res, 200, { available: available() });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return respond(res, 405, { error: 'Method not allowed' }); }
  if (!allowedOrigins.has(req.headers.origin)) return respond(res, 403, { error: 'Unsupported origin' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return respond(res, 415, { error: 'JSON required' });
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > 12000)) return respond(res, 413, { error: 'Request too large' });
  let payload = req.body;
  try {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (!raw || Buffer.byteLength(raw) > 12000) return respond(res, 413, { error: 'Request too large' });
    if (typeof payload === 'string') payload = JSON.parse(payload);
  } catch { return respond(res, 400, { error: 'Invalid JSON' }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return respond(res, 400, { error: 'Invalid request' });
  if (String(payload.website || '').trim()) return respond(res, 202, { ok: true });
  const email = String(payload.email || '').trim();
  const name = String(payload.name || '').trim().slice(0, 80);
  const requestedTopic = String(payload.topic || '').trim();
  const topic = Object.hasOwn(topicLabels, requestedTopic) ? requestedTopic
    : Object.hasOwn(legacyTopics, requestedTopic) ? legacyTopics[requestedTopic] : null;
  const message = String(payload.message || '').trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return respond(res, 400, { error: 'Enter a valid reply email' });
  if (!topic) return respond(res, 400, { error: 'Choose an enquiry type' });
  if (message.length < 15 || message.length > 2500) return respond(res, 400, { error: 'Your message must be 15 to 2500 characters' });
  if (payload.consent !== true) return respond(res, 400, { error: 'Please acknowledge the privacy reminder' });
  if (payload.submissionId !== undefined && (typeof payload.submissionId !== 'string' || !UUID.test(payload.submissionId))) {
    return respond(res, 400, { error: 'Invalid enquiry reference' });
  }
  if (!available()) return respond(res, 503, { error: 'Secure mail delivery is not available' });
  const ip = req.headers['x-vercel-forwarded-for'];
  if (typeof ip !== 'string' || !isIP(ip)) return respond(res, 503, { error: 'Request verification is unavailable' });
  const id = (payload.submissionId || randomUUID()).toLowerCase();
  const reference = 'GYS-' + id.toUpperCase();
  try {
    const [blocked, retryAfter] = await reserve(id, { name, email, topic, message }, ip);
    if (blocked === 1) return respond(res, 409, { error: 'This enquiry reference belongs to a different message' });
    if (blocked) {
      res.setHeader('Retry-After', String(retryAfter));
      return respond(res, 429, { error: blocked === 3 ? 'Today\'s enquiry capacity is full. Please try again after the daily reset.' : 'Too many attempts. Please try again later', reference });
    }
  } catch { return respond(res, 503, { error: 'Secure mail delivery is temporarily unavailable. Please retry', reference }); }
  const topicLabel = topicLabels[topic];
  const text = ['GetYourSats website enquiry', 'Reference: ' + reference, 'Enquiry type: ' + topicLabel,
    'Routing code: ' + topic, 'Name: ' + (name || 'Not supplied'), 'Reply to: ' + email, '', message, '',
    'Never request private keys, recovery words or PINs in any reply.'].join('\n');
  try {
    const upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': reference },
      body: JSON.stringify({ from: process.env.GETYOURSATS_SUPPORT_FROM, to: [process.env.GETYOURSATS_SUPPORT_TO], reply_to: email, subject: 'GetYourSats · ' + topicLabel + ' · ' + reference, text }),
      redirect: 'error', signal: AbortSignal.timeout(9000),
    });
    if (!upstream.ok) return respond(res, 502, { error: 'Email provider could not accept the request. Retry this enquiry', reference });
    return respond(res, 202, { ok: true, reference });
  } catch { return respond(res, 502, { error: 'Email service unavailable. Please retry this enquiry', reference }); }
}
