import {randomBytes,randomInt} from 'node:crypto';
import {isIP} from 'node:net';
import {digest,equalHex,normalizeEmail,verifyWalletProof,walletPubkey} from '../../server/emailCrypto.mjs';

const ORIGIN='https://wallet.getyoursats.com';
const PREFIX='gys:email:v1:';
const ttlChallenge=300,ttlCode=600;
const MAX_BODY_BYTES=4096;
const DAILY_MAIL_LIMIT=80;
const RATE_SCRIPT="local count=redis.call('INCR',KEYS[1]);if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return count";
function storageConfig() {
  const explicit=[process.env.UPSTASH_REDIS_REST_URL,process.env.UPSTASH_REDIS_REST_TOKEN];
  const integrated=[process.env.KV_REST_API_URL,process.env.KV_REST_API_TOKEN];
  const [endpoint,token]=explicit.some(Boolean)?explicit:integrated;
  if(!endpoint||!token)throw new Error('Storage unavailable');
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('Storage unavailable');
  return {url:url.href,token};
}
function ready() {
  try{storageConfig();}catch{return false;}
  return process.env.GETYOURSATS_EMAIL_ENABLED==='true'
    && !!process.env.RESEND_API_KEY
    && !!process.env.GETYOURSATS_EMAIL_FROM
    && (process.env.GETYOURSATS_EMAIL_HMAC_KEY?.length??0)>=32;
}
function hmac(value){return digest(process.env.GETYOURSATS_EMAIL_HMAC_KEY,value);}
async function redis(...command) {
  const storage=storageConfig();
  const response=await fetch(storage.url,{
    method:'POST',headers:{
      Authorization:'Bearer '+storage.token,
      'Content-Type':'application/json'
    },body:JSON.stringify(command),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7500)
  });
  if(!response.ok)throw new Error('Storage unavailable');
  let payload;
  try{payload=await response.json();}catch{throw new Error('Storage unavailable');}
  if(!payload||typeof payload!=='object'||payload.error||!Object.hasOwn(payload,'result'))throw new Error('Storage unavailable');
  return payload.result;
}
async function rate(key,max,seconds) {
  const count=Number(await redis('EVAL',RATE_SCRIPT,1,PREFIX+'rate:'+hmac(key),seconds));
  if(!Number.isSafeInteger(count)||count<1)throw new Error('Storage unavailable');
  if(count>max)throw Object.assign(new Error('Too many requests. Please try again later.'),{status:429});
}
async function mailBudget() {
  const now=Date.now();
  const day=Math.floor(now/86_400_000);
  // Reserve some of the shared free mail allowance for support. Failed or
  // uncertain provider calls also count because the email may have been sent.
  await rate('mail-day:'+day,DAILY_MAIL_LIMIT,Math.ceil(((day+1)*86_400_000-now)/1000));
}
function respond(res,status,body) {res.statusCode=status;res.end(JSON.stringify(body));}
async function payloadOf(req) {
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(String(declared))||Number(declared)>MAX_BODY_BYTES))
    throw Object.assign(new Error('Request too large'),{status:413});
  if(req.body && typeof req.body==='object'){
    if(Buffer.byteLength(JSON.stringify(req.body),'utf8')>MAX_BODY_BYTES)
      throw Object.assign(new Error('Request too large'),{status:413});
    return req.body;
  }
  if(typeof req.body==='string'){
    if(Buffer.byteLength(req.body,'utf8')>MAX_BODY_BYTES)throw Object.assign(new Error('Request too large'),{status:413});
    return JSON.parse(req.body);
  }
  const chunks=[];let size=0;
  for await (const chunk of req) {
    const bytes=Buffer.from(chunk);
    size+=bytes.length;if(size>MAX_BODY_BYTES)throw Object.assign(new Error('Request too large'),{status:413});
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function clientKey(req) {
  const ip=req.headers['x-vercel-forwarded-for'];
  if(typeof ip!=='string'||!isIP(ip)||/[\s,%\[\]]/.test(ip))throw new Error('Client address unavailable');
  return 'ip:'+ip;
}
const challengeKey=(id)=>PREFIX+'challenge:'+id;
const pendingKey=(id)=>PREFIX+'pending:'+id;
const verifiedKey=(pub)=>PREFIX+'wallet:'+pub;
const ownerKey=(email)=>PREFIX+'owner:'+hmac(email);
function storedObject(raw) {
  try{
    if(typeof raw!=='string')throw new Error();
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
    return value;
  }catch{throw new Error('Storage unavailable');}
}
function verifiedRecord(raw) {
  if(raw===null)return null;
  const value=storedObject(raw);
  try{
    if(normalizeEmail(value.email)!==value.email||!Number.isSafeInteger(value.verifiedAt)||value.verifiedAt<=0)throw new Error();
  }catch{throw new Error('Storage unavailable');}
  return value;
}

/** Email verified is not wallet recovery. Signature ownership must precede
 * issuing codes/status; messages are nonce-bound and one-time. */
export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'){respond(res,200,{available:ready()});return;}
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');respond(res,405,{error:'Method not allowed'});return;}
  if(req.headers.origin!==ORIGIN || typeof req.headers['content-type']!=='string'||req.headers['content-type'].split(';')[0].trim().toLowerCase()!=='application/json'){
    respond(res,403,{error:'Unsupported origin'});return;
  }
  if(!ready()){respond(res,503,{error:'Email verification is not available yet'});return;}
  try {
    const body=await payloadOf(req);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid request');
    const action=body.action;
    if(action==='challenge'){
      const pub=walletPubkey(body.walletPubkey);
      const purpose=body.purpose;
      if(purpose!=='send'&&purpose!=='status')throw new Error('Invalid purpose');
      await rate('challenge:'+clientKey(req),25,3600);
      await rate('wallet-challenge:'+pub,20,3600);
      const id=randomBytes(18).toString('hex');
      const message='gys-email-v1:'+purpose+':'+pub+':'+id;
      const saved=await redis('SET',challengeKey(id),JSON.stringify({message,pub,purpose}),'EX',ttlChallenge,'NX');
      if(saved!=='OK')throw new Error('Cannot begin verification');
      respond(res,200,{challengeId:id,message,expiresIn:ttlChallenge});return;
    }
    if(action==='send'||action==='status'){
      if(typeof body.challengeId!=='string'||!/^[0-9a-f]{36}$/i.test(body.challengeId))throw new Error('Invalid challenge');
      // Consume before checking the signature: even an invalid attempt cannot replay a challenge.
      const found=await redis('GETDEL',challengeKey(body.challengeId));
      if(!found)throw Object.assign(new Error('Challenge expired'),{status:409});
      const challenge=storedObject(found);
      if(challenge.message!=='gys-email-v1:'+challenge.purpose+':'+challenge.pub+':'+body.challengeId)
        throw new Error('Storage unavailable');
      if(challenge.purpose!==action || !verifyWalletProof(challenge.message,challenge.pub,body.signature))
        throw Object.assign(new Error('Wallet authentication failed'),{status:401});
      if(action==='status'){
        const linked=await redis('GET',verifiedKey(challenge.pub));
        const value=verifiedRecord(linked);
        respond(res,200,{verified:value!==null,email:value?.email??null});return;
      }
      const email=normalizeEmail(body.email);
      await rate('email-send:'+email,4,86400);
      await rate('wallet-send:'+challenge.pub,4,86400);
      await rate('send:'+clientKey(req),8,86400);
      const previously=await redis('GET',verifiedKey(challenge.pub));
      if(verifiedRecord(previously))throw Object.assign(new Error('Email already linked to this wallet'),{status:409});
      await mailBudget();
      const code=String(randomInt(0,1000000)).padStart(6,'0');
      const requestId=randomBytes(18).toString('hex');
      const codeHash=hmac(requestId+':'+challenge.pub+':'+email+':'+code);
      const saved=await redis('SET',pendingKey(requestId),JSON.stringify({pub:challenge.pub,email,codeHash}),'EX',ttlCode,'NX');
      if(saved!=='OK')throw new Error('Could not begin email verification');
      const sent=await fetch('https://api.resend.com/emails',{
        method:'POST',headers:{
          Authorization:'Bearer '+process.env.RESEND_API_KEY,
          'Content-Type':'application/json',
          'Idempotency-Key':'gys-email-'+requestId
        },
        body:JSON.stringify({
          from:process.env.GETYOURSATS_EMAIL_FROM,
          to:[email],subject:'Verify your GetYourSats email',
          text:'Your GetYourSats verification code is '+code+'. It expires in 10 minutes.\n\nThis code only verifies an email address. It will never restore your Bitcoin wallet. Never share recovery words or passkeys.'
        }),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)
      });
      if(!sent.ok){await redis('DEL',pendingKey(requestId));throw new Error('Email delivery unavailable');}
      respond(res,200,{requestId,expiresIn:ttlCode});return;
    }
    if(action==='verify'){
      if(typeof body.requestId!=='string'||!/^[0-9a-f]{36}$/i.test(body.requestId)||
        typeof body.code!=='string'||!/^[0-9]{6}$/.test(body.code))throw new Error('Invalid code');
      await rate('otp:'+body.requestId,5,ttlCode);
      await rate('verify:'+clientKey(req),40,3600);
      const raw=await redis('GET',pendingKey(body.requestId));
      if(!raw)throw Object.assign(new Error('Code expired'),{status:409});
      const record=storedObject(raw);
      try{
        if(walletPubkey(record.pub)!==record.pub||normalizeEmail(record.email)!==record.email||!equalHex(record.codeHash,record.codeHash))throw new Error();
      }catch{throw new Error('Storage unavailable');}
      const expected=hmac(body.requestId+':'+record.pub+':'+record.email+':'+body.code);
      if(!equalHex(expected,record.codeHash))throw Object.assign(new Error('Invalid verification code'),{status:401});
      const used=await redis('GETDEL',pendingKey(body.requestId));
      if(!used)throw Object.assign(new Error('Code already used'),{status:409});
      // Both uniqueness rules must be committed atomically. Do not let an
      // account be stolen by linking one mailbox to two wallet identities.
      const now=Date.now();
      const lua=`local currentOwner=redis.call('GET',KEYS[1]);local currentWallet=redis.call('GET',KEYS[2]);if currentOwner and currentOwner~=ARGV[1] then return 'EMAIL_IN_USE' end;if currentWallet then return 'WALLET_ALREADY_LINKED' end;redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2]);return 'OK'`;
      const linked=await redis('EVAL',lua,2,ownerKey(record.email),verifiedKey(record.pub),record.pub,JSON.stringify({email:record.email,verifiedAt:now}));
      if(linked!=='OK')throw Object.assign(new Error('Email or wallet is already linked'),{status:409});
      respond(res,200,{verified:true,email:record.email});return;
    }
    throw new Error('Invalid operation');
  } catch(err) {
    const code=err?.status || (err instanceof SyntaxError?400:err?.message?.startsWith('Invalid')?400:503);
    // Do not log email, code, signature or key material.
    respond(res,code,{error:code===503?'Verification service temporarily unavailable':err.message});
  }
}
