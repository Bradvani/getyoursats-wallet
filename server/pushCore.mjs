import {createHash, createHmac, createPrivateKey, createPublicKey, ECDH, sign, timingSafeEqual, verify} from 'node:crypto';

// No private wallet data ever belongs in a notification payload or server log.
export const ORIGIN = 'https://wallet.getyoursats.com';
export const PREFIX = 'gys:notify:v1:';
export function breezLnurlSecret(env=process.env) {
  const secret=env.GYS_BREEZ_LNURL_WEBHOOK_SECRET;
  return env.GYS_PUSH_ENABLED==='true' && env.GYS_BREEZ_LNURL_PUSH_ENABLED==='true'
    && typeof secret==='string' && secret.length>=32 ? secret : null;
}
const TRUSTED_PUSH_HOSTS = new Set([
  'web.push.apple.com', 'fcm.googleapis.com',
  'updates.push.services.mozilla.com', 'push.services.mozilla.com',
  'fcm-xm.googleapis.com',
]);
/**
 * Read original raw bytes without ever buffering more than the configured
 * webhook limit. Reject oversized requests before checking HMAC.
 */
export async function readBoundedRawBody(request,maxBytes=16_384) {
  const declared=request.headers.get('content-length');
  if(declared!=null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))
    throw Object.assign(new Error('Invalid event size'),{status:413});
  if(!request.body)return Buffer.alloc(0);
  const reader=request.body.getReader();
  let size=0;const chunks=[];
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes) {
        await reader.cancel().catch(()=>{});
        throw Object.assign(new Error('Invalid event size'),{status:413});
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks,size);
  }finally{
    try{reader.releaseLock();}catch{}
  }
}
export const walletPubkey = (value) => {
  if (typeof value !== 'string' || !/^(02|03)[0-9a-f]{64}$/i.test(value))
    throw new Error('Invalid wallet identifier');
  return value.toLowerCase();
};
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function verifyOwnership(message, pub, signature) {
  try {
    pub = walletPubkey(pub);
    if (typeof message !== 'string' || !/^gys-push-v2:https:\/\/wallet\.getyoursats\.com:(subscribe|activate|status|unsubscribe):(?:02|03)[0-9a-f]{64}:[a-f0-9]{32}:[a-f0-9]{64}$/.test(message))
      return false;
    if (!message.includes(':' + pub + ':') || typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature))
      return false;
    const uncompressed = ECDH.convertKey(pub, 'secp256k1', 'hex', 'hex', 'uncompressed');
    const spki = Buffer.concat([
      Buffer.from('3056301006072a8648ce3d020106052b8104000a03420004', 'hex'),
      Buffer.from(uncompressed.slice(2), 'hex'),
    ]);
    const key = createPublicKey({key: spki, format: 'der', type: 'spki'});
    return verify('sha256', Buffer.from(message), {key, dsaEncoding: 'ieee-p1363'},
      Buffer.from(signature, 'hex'));
  } catch {return false;}
}
export function pushEndpoint(value) {
  if (typeof value !== 'string' || value.length < 30 || value.length > 2048)
    throw new Error('Unsupported push endpoint');
  let url;
  try {url = new URL(value);} catch {throw new Error('Unsupported push endpoint');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !TRUSTED_PUSH_HOSTS.has(url.hostname.toLowerCase()) || url.pathname.length < 2)
    throw new Error('Unsupported push endpoint');
  return url.href;
}
export function checkedSubscription(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid push subscription');
  const endpoint = pushEndpoint(raw.endpoint);
  const keys = raw.keys;
  if (!keys || typeof keys !== 'object' || typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string' || keys.p256dh.length > 180 || keys.auth.length > 80 ||
    !/^[A-Za-z0-9_-]+$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(keys.auth) ||
    Buffer.from(keys.p256dh,'base64url').length !== 65 ||
    Buffer.from(keys.auth,'base64url').length !== 16)
    throw new Error('Invalid push subscription');
  return {endpoint, keys: {p256dh: keys.p256dh, auth: keys.auth}};
}
export function verifySparkWebhook(raw, pub, secret, signatureHeader, now = Date.now()) {
  pub = walletPubkey(pub);
  if (!Buffer.isBuffer(raw) || raw.length > 16_384 || raw.length === 0 ||
      typeof secret !== 'string' || secret.length < 32 ||
      typeof signatureHeader !== 'string' || !/^[a-f0-9]{64}$/i.test(signatureHeader))
    return {ok:false, reason:'unauthenticated'};
  const expected = createHmac('sha256', secret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signatureHeader, 'hex')))
    return {ok:false, reason:'unauthenticated'};
  let data;
  try {data = JSON.parse(raw.toString('utf8'));} catch {return {ok:false, reason:'invalid_payload'};}
  if (!data || data.type !== 'SPARK_LIGHTNING_RECEIVE_FINISHED' ||
      data.status !== 'TRANSFER_COMPLETED' ||
      data.request_status !== 'SUCCEEDED')
    return {ok:true, notify:false, reason:'not_settled_receive'};
  // The provider documents this field as nullable when the wallet itself
  // issued the invoice. The per-wallet HMAC secret authenticates the receiver
  // in that case. When a receiver key is present, it must match exactly.
  const receiver = data.receiver_identity_public_key;
  if (data.network !== 'MAINNET' ||
      (receiver != null && (typeof receiver !== 'string' || receiver.toLowerCase() !== pub)))
    return {ok:false, reason:'wallet_or_network_mismatch'};
  if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(data.id))
    return {ok:false, reason:'invalid_event'};
  const ts = Date.parse(data.timestamp);
  if (!Number.isFinite(ts) || now - ts > 7*86400_000 || ts - now > 300_000)
    return {ok:false, reason:'stale_event'};
  // Derive the invoice payment hash without storing or returning a preimage.
  // This unifies Spark's event ID with the Breez LNURL payment_hash, allowing
  // the same incoming Lightning payment to be deduplicated across both rails.
  const preimage=typeof data.payment_preimage==='string'&&/^[0-9a-f]{64}$/i.test(data.payment_preimage)
    ?Buffer.from(data.payment_preimage,'hex'):null;
  const paymentHash=preimage?createHash('sha256').update(preimage).digest('hex'):null;
  return {ok:true, notify:true, id:data.id, paymentHash, ts};
}
export function vapidConfig(env = process.env) {
  const pub = env.GYS_PUSH_VAPID_PUBLIC_KEY;
  const priv = env.GYS_PUSH_VAPID_PRIVATE_KEY;
  const subject = env.GYS_PUSH_VAPID_SUBJECT || 'mailto:support@getyoursats.com';
  if (typeof pub !== 'string' || typeof priv !== 'string' ||
      Buffer.from(pub,'base64url').length !== 65 ||
      Buffer.from(priv,'base64url').length !== 32 ||
      Buffer.from(pub,'base64url')[0] !== 4 ||
      !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject))
    throw new Error('Push is not configured');
  const point=Buffer.from(pub,'base64url');
  const key=createPrivateKey({
    key:{kty:'EC',crv:'P-256', x:point.subarray(1,33).toString('base64url'),
      y:point.subarray(33,65).toString('base64url'),d:Buffer.from(priv,'base64url').toString('base64url')},
    format:'jwk'
  });
  return {pub, key, subject};
}
export function createVapidToken(endpoint, config, now = Date.now()) {
  const audience = new URL(pushEndpoint(endpoint)).origin;
  const first = Buffer.from(JSON.stringify({typ:'JWT',alg:'ES256'})).toString('base64url');
  const second = Buffer.from(JSON.stringify({
    aud:audience, exp:Math.floor(now/1000)+3600, sub:config.subject
  })).toString('base64url');
  const input=first+'.'+second;
  const signature=sign('sha256', Buffer.from(input),
    {key:config.key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return 'vapid t='+input+'.'+signature+', k='+config.pub;
}
export async function sendEmptyWebPush(endpoint, config, send=fetch) {
  const url=pushEndpoint(endpoint);
  const response=await send(url,{
    method:'POST',redirect:'error',cache:'no-store',
    headers:{Authorization:createVapidToken(url,config),TTL:'90',Urgency:'high'},
    signal:AbortSignal.timeout(8000)
  });
  // Do not leak the provider's response text or endpoint to logs.
  return {delivered:response.ok, expired:[404,410].includes(response.status),
    transient:response.status >= 500 || response.status===429,
    status:response.status};
}
