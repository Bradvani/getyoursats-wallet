import {createHash,randomBytes} from 'node:crypto';
import {walletPubkey,verifyWalletProof} from './emailCrypto.mjs';

export const DOMAIN='getyoursats.com';
export const ROOT='gys:handle:v1:';
export const EMAIL_ROOT='gys:email:v1:wallet:';
const BLOCKED=new Set(['admin','support','security','billing','wallet','pay','api','help','contact','breez','getyoursats','satoshi','root','system','staff','official','team','verify','login','auth','www','mail','postmaster','abuse']);

export function validUsername(input){
  return typeof input==='string' && /^[a-z][a-z0-9]{2,23}$/.test(input) && !BLOCKED.has(input);
}
export function normalizeSourceAddress(value){
  if(typeof value!=='string')throw Object.assign(new Error('Invalid source Lightning address'),{status:400});
  const address=value.trim().toLowerCase();
  if(!/^[a-z0-9_-]{3,50}@breez\.tips$/.test(address))
    throw Object.assign(new Error('A wallet-issued Breez Lightning address is required'),{status:400});
  return address;
}
export function enabled(){
  return process.env.GETYOURSATS_HANDLE_ENABLED==='true' &&
    process.env.GETYOURSATS_EMAIL_ENABLED==='true' &&
    !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
}
export async function redis(...args){
  const response=await fetch(process.env.UPSTASH_REDIS_REST_URL,{
    method:'POST',headers:{'Authorization':'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify(args),signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)throw Object.assign(new Error('Account database unavailable'),{status:503});
  const data=await response.json();
  if(data.error)throw Object.assign(new Error('Account database unavailable'),{status:503});
  return data.result;
}
export const nameKey=(name)=>ROOT+'name:'+name;
export const walletKey=(pub)=>ROOT+'wallet:'+pub;
export const challengeKey=(id)=>ROOT+'challenge:'+id;
export const verifiedKey=(pub)=>EMAIL_ROOT+pub;
export function publicWalletKey(value){return walletPubkey(value);}
export async function ensureVerified(pub){
  const raw=await redis('GET',verifiedKey(pub));
  if(!raw)throw Object.assign(new Error('Verify email first to claim a username'),{status:403});
  try{if(JSON.parse(raw).email)return;}catch{/* invalid record */}
  throw Object.assign(new Error('Verified email record unavailable'),{status:403});
}
export async function rate(key,limit,ttl){
  // Hash the source before storing it; avoid storing raw IP or email in rate keys.
  const hash=createHash('sha256').update(key).digest('hex');
  const count=Number(await redis('INCR',ROOT+'rate:'+hash));
  await redis('EXPIRE',ROOT+'rate:'+hash,ttl);
  if(count>limit)throw Object.assign(new Error('Too many username requests'),{status:429});
}
export async function checkSourceLNURL(address){
  const local=normalizeSourceAddress(address).split('@')[0];
  // Constant trusted host, validated username, no arbitrary URL or SSRF.
  const response=await fetch('https://breez.tips/.well-known/lnurlp/'+encodeURIComponent(local),{
    headers:{'Accept':'application/json'},signal:AbortSignal.timeout(7500),cache:'no-store'
  });
  if(!response.ok)throw Object.assign(new Error('Wallet address is not externally payable'),{status:409});
  const data=await response.json();
  if(data.tag!=='payRequest'||typeof data.callback!=='string'||typeof data.metadata!=='string'||
      !Number.isSafeInteger(data.minSendable)||!Number.isSafeInteger(data.maxSendable))
    throw Object.assign(new Error('Wallet Lightning address returned invalid LNURL data'),{status:409});
  let callback;
  try{callback=new URL(data.callback);}catch{throw Object.assign(new Error('Invalid wallet callback'),{status:409});}
  if(callback.protocol!=='https:'||callback.hostname!=='breez.tips')
    throw Object.assign(new Error('Untrusted Lightning payment callback'),{status:409});
  if(data.minSendable<=0||data.maxSendable<data.minSendable)
    throw Object.assign(new Error('Invalid Lightning payment limits'),{status:409});
  return {tag:'payRequest',callback:data.callback,minSendable:data.minSendable,
    maxSendable:data.maxSendable,metadata:data.metadata,
    ...(Number.isSafeInteger(data.commentAllowed)&&data.commentAllowed>=0?{commentAllowed:data.commentAllowed}:{})
  };
}
export function newChallenge(pub,mode,name='',source=''){
  const id=randomBytes(18).toString('hex');
  const message='gys-handle-v1:'+mode+':'+pub+':'+name+':'+source+':'+id;
  return {id,message,pub,mode,name,source};
}
export function verifyChallenge(challenge,signature,mode){
  if(challenge.mode!==mode||!verifyWalletProof(challenge.message,challenge.pub,signature))
    throw Object.assign(new Error('Wallet ownership proof failed'),{status:401});
}
