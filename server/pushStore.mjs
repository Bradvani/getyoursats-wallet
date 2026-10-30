import {randomBytes} from 'node:crypto';
import {PREFIX, digest} from './pushCore.mjs';
import {pushAuthorizationMessage} from '../shared/pushAuthorization.mjs';

const RETENTION=180*86400;

function storeConfig() {
  const endpoint = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!endpoint || !token) throw new Error('Notification storage unavailable');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Notification storage unavailable');
  return {url:url.href,token};
}
export function storeReady() {
  try {storeConfig();return true;}catch{return false;}
}
export async function redis(...cmd) {
  const {url,token}=storeConfig();
  const response=await fetch(url,{
    method:'POST',redirect:'error',cache:'no-store',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(cmd),signal:AbortSignal.timeout(6500)
  });
  if (!response.ok) throw new Error('Notification storage unavailable');
  const value=await response.json();
  if (!value || typeof value!=='object' || value.error ||
      !Object.prototype.hasOwnProperty.call(value,'result'))
    throw new Error('Notification storage unavailable');
  return value.result;
}
export const walletKey = (pub) => PREFIX+'wallet:'+pub;
export const subKey = (pub) => PREFIX+'subs:'+pub;
export const endpointKey = (endpoint) => PREFIX+'endpoint:'+digest(endpoint);
export const subscriptionId = (endpoint) => digest(endpoint);
export const challengeKey = (id) => PREFIX+'challenge:'+id;
export const receiptKey = (pub,id) => PREFIX+'receipt:'+pub+':'+digest(id);

export async function fixedRateLimit(key,max,seconds) {
  const atomic = "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n";
  const count=Number(await redis('EVAL',atomic,1,PREFIX+'limit:'+digest(key),seconds));
  if (!Number.isSafeInteger(count) || count<1) throw new Error('Notification storage unavailable');
  if (count>max) throw Object.assign(new Error('Too many requests'),{status:429});
}
export async function issueChallenge(action,pub,ip,payloadHash) {
  await fixedRateLimit('challenge:'+ip,30,3600);
  await fixedRateLimit('wallet:'+pub,25,3600);
  const id=randomBytes(16).toString('hex');
  const message=pushAuthorizationMessage(action,pub,id,payloadHash);
  const stored=await redis('SET',challengeKey(id),JSON.stringify({action,pub,message,payloadHash}),'EX',300,'NX');
  if (stored!=='OK') throw new Error('Notification storage unavailable');
  return {challengeId:id,message,expiresIn:300};
}
export async function consumeChallenge(action,pub,id,signature,verifyOwnership,payloadHash) {
  if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))
    throw Object.assign(new Error('Invalid challenge'),{status:400});
  const raw=await redis('GETDEL',challengeKey(id));
  if (!raw) throw Object.assign(new Error('Notification authorization expired'),{status:409});
  let saved;
  try {saved=JSON.parse(raw);}catch{throw new Error('Notification storage unavailable');}
  if (saved.action!==action || saved.pub!==pub || saved.payloadHash!==payloadHash ||
      saved.message!==pushAuthorizationMessage(action,pub,id,payloadHash) ||
      !verifyOwnership(saved.message,pub,signature))
    throw Object.assign(new Error('Wallet authorization failed'),{status:401});
}
export async function getWallet(pub) {
  const raw=await redis('GET',walletKey(pub));
  if(!raw)return null;
  let data;
  try {data=JSON.parse(raw);}catch{throw new Error('Notification storage unavailable');}
  if(typeof data.secret!=='string'||data.secret.length<32)throw new Error('Notification storage unavailable');
  return data;
}
export async function ensureWallet(pub) {
  const existing=await getWallet(pub);
  if(existing)return existing;
  const record={secret:randomBytes(32).toString('hex'),createdAt:Date.now(),
    registered:false,webhookId:null};
  await redis('SET',walletKey(pub),JSON.stringify(record),'EX',RETENTION,'NX');
  return getWallet(pub);
}
export async function listSubscriptions(pub) {
  const raw=await redis('HGETALL',subKey(pub));
  const pairs = Array.isArray(raw)?Array.from({length:Math.floor(raw.length/2)},(_,i)=>[raw[i*2],raw[i*2+1]])
    :raw && typeof raw==='object'?Object.entries(raw):[];
  return pairs.flatMap(([id,encoded])=>{
    try {
      const value=JSON.parse(encoded);
      return [{id,...value}];
    }catch{return [];}
  });
}
export async function getSubscription(pub,endpoint) {
  const raw=await redis('HGET',subKey(pub),subscriptionId(endpoint));
  if(!raw)return null;
  try{return JSON.parse(raw);}catch{throw new Error('Notification storage unavailable');}
}
export async function saveSubscription(pub,subscription) {
  // Transfer endpoint ownership when a browser changes wallets. A device
  // subscription can never remain bound to two wallet identities.
  const endpoint=subscription.endpoint;
  const ownerKey=endpointKey(endpoint);
  const id=subscriptionId(endpoint);
  const record=JSON.stringify({...subscription,active:false,enabledAt:Date.now(),revision:randomBytes(16).toString('hex')});
  const script="local count=redis.call('HLEN',KEYS[2]..ARGV[1]);if count>=5 and redis.call('HEXISTS',KEYS[2]..ARGV[1],ARGV[2])==0 then return 'TOO_MANY' end;local old=redis.call('GET',KEYS[1]);if old and old~=ARGV[1] then redis.call('HDEL',KEYS[2]..old,ARGV[2]) end;redis.call('HSET',KEYS[2]..ARGV[1],ARGV[2],ARGV[3]);redis.call('EXPIRE',KEYS[2]..ARGV[1],ARGV[4]);redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[4]);return 'OK'";
  const result=await redis('EVAL',script,2,ownerKey,PREFIX+'subs:',pub,id,record,RETENTION);
  if(result!=='OK')throw Object.assign(new Error('Device notification limit reached'),{status:409});
  return id;
}
export async function activateSubscription(pub,endpoint,webhookId) {
  const current=await getSubscription(pub,endpoint);
  if(!current||await redis('GET',endpointKey(endpoint))!==pub)
    throw Object.assign(new Error('Notification subscription changed'),{status:409});
  const wallet=await getWallet(pub);
  if(!wallet)throw new Error('Notification storage unavailable');
  const active={...current,active:true,enabledAt:Date.now()};
  // Atomic update of activation and retained webhook ID. A second device
  // must not erase an existing valid provider registration.
  const script="if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('HGET',KEYS[2],ARGV[2])~=ARGV[4] then return 'CHANGED' end;local raw=redis.call('GET',KEYS[3]);if not raw then return 'CHANGED' end;local wallet=cjson.decode(raw);if ARGV[5]~='' then wallet.registered=true;wallet.webhookId=wallet.webhookId or ARGV[5];if wallet.webhookId==cjson.null then wallet.webhookId=ARGV[5] end end;redis.call('HSET',KEYS[2],ARGV[2],ARGV[3]);redis.call('EXPIRE',KEYS[2],ARGV[6]);redis.call('EXPIRE',KEYS[1],ARGV[6]);redis.call('SET',KEYS[3],cjson.encode(wallet),'EX',ARGV[6]);return 'OK'";
  const ok=await redis('EVAL',script,3,endpointKey(endpoint),subKey(pub),walletKey(pub),
    pub,subscriptionId(endpoint),JSON.stringify(active),JSON.stringify(current),webhookId||'',RETENTION);
  if(ok!=='OK')throw Object.assign(new Error('Notification subscription changed'),{status:409});
}
export async function removeSubscription(pub,endpoint) {
  const script="redis.call('HDEL',KEYS[1],ARGV[1]);if redis.call('GET',KEYS[2])==ARGV[2] then redis.call('DEL',KEYS[2]) end;return 1";
  await redis('EVAL',script,2,subKey(pub),endpointKey(endpoint),subscriptionId(endpoint),pub);
}
