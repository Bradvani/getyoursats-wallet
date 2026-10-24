import {randomBytes,randomInt} from 'node:crypto';
import {digest,equalHex,normalizeEmail,verifyWalletProof,walletPubkey} from '../../server/emailCrypto.mjs';

const ORIGIN='https://wallet.getyoursats.com';
const PREFIX='gys:email:v1:';
const ttlChallenge=300,ttlCode=600;
function ready() {
  return process.env.GETYOURSATS_EMAIL_ENABLED==='true'
    && !!process.env.UPSTASH_REDIS_REST_URL
    && !!process.env.UPSTASH_REDIS_REST_TOKEN
    && !!process.env.RESEND_API_KEY
    && !!process.env.GETYOURSATS_EMAIL_FROM
    && (process.env.GETYOURSATS_EMAIL_HMAC_KEY?.length??0)>=32;
}
function hmac(value){return digest(process.env.GETYOURSATS_EMAIL_HMAC_KEY,value);}
async function redis(...command) {
  const response=await fetch(process.env.UPSTASH_REDIS_REST_URL,{
    method:'POST',headers:{
      Authorization:'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN,
      'Content-Type':'application/json'
    },body:JSON.stringify(command),signal:AbortSignal.timeout(7500)
  });
  if(!response.ok)throw new Error('Storage unavailable');
  const payload=await response.json();
  if(payload.error)throw new Error('Storage unavailable');
  return payload.result;
}
async function rate(key,max,seconds) {
  const count=Number(await redis('INCR',PREFIX+'rate:'+hmac(key)));
  await redis('EXPIRE',PREFIX+'rate:'+hmac(key),seconds);
  if(!Number.isSafeInteger(count)||count>max)throw Object.assign(new Error('Too many requests'),{status:429});
}
function respond(res,status,body) {res.statusCode=status;res.end(JSON.stringify(body));}
async function payloadOf(req) {
  if(req.body && typeof req.body==='object')return req.body;
  if(typeof req.body==='string')return JSON.parse(req.body);
  const chunks=[];let size=0;
  for await (const chunk of req) {
    size+=chunk.length;if(size>4096)throw Object.assign(new Error('Request too large'),{status:413});
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function clientKey(req) {
  const ip=req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown';
  return 'ip:'+String(ip).slice(0,100);
}
const challengeKey=(id)=>PREFIX+'challenge:'+id;
const pendingKey=(id)=>PREFIX+'pending:'+id;
const verifiedKey=(pub)=>PREFIX+'wallet:'+pub;
const ownerKey=(email)=>PREFIX+'owner:'+hmac(email);

/** Email verified is not wallet recovery. Signature ownership must precede
 * issuing codes/status; messages are nonce-bound and one-time. */
export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'){respond(res,200,{available:ready()});return;}
  if(req.method!=='POST'){respond(res,405,{error:'Method not allowed'});return;}
  if(req.headers.origin!==ORIGIN || req.headers['content-type']?.split(';')[0]!=='application/json'){
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
      await rate(clientKey(req),25,3600);
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
      const challenge=JSON.parse(found);
      if(challenge.purpose!==action || !verifyWalletProof(challenge.message,challenge.pub,body.signature))
        throw Object.assign(new Error('Wallet authentication failed'),{status:401});
      if(action==='status'){
        const linked=await redis('GET',verifiedKey(challenge.pub));
        const value=linked?JSON.parse(linked):null;
        respond(res,200,{verified:!!value,email:value?.email??null});return;
      }
      const email=normalizeEmail(body.email);
      await rate('email-send:'+email,4,86400);
      await rate('wallet-send:'+challenge.pub,4,86400);
      await rate(clientKey(req),8,86400);
      const previously=await redis('GET',verifiedKey(challenge.pub));
      if(previously)throw Object.assign(new Error('Email already linked to this wallet'),{status:409});
      const assigned=await redis('GET',ownerKey(email));
      if(assigned&&assigned!==challenge.pub)throw Object.assign(new Error('Email is linked to another wallet'),{status:409});
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
        }),signal:AbortSignal.timeout(10000)
      });
      if(!sent.ok){await redis('DEL',pendingKey(requestId));throw new Error('Email delivery unavailable');}
      respond(res,200,{requestId,expiresIn:ttlCode});return;
    }
    if(action==='verify'){
      if(typeof body.requestId!=='string'||!/^[0-9a-f]{36}$/i.test(body.requestId)||
        typeof body.code!=='string'||!/^[0-9]{6}$/.test(body.code))throw new Error('Invalid code');
      await rate('otp:'+body.requestId,5,ttlCode);
      await rate(clientKey(req),40,3600);
      const raw=await redis('GET',pendingKey(body.requestId));
      if(!raw)throw Object.assign(new Error('Code expired'),{status:409});
      const record=JSON.parse(raw);
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
    throw new Error('Unknown operation');
  } catch(err) {
    const code=err?.status || (err instanceof SyntaxError?400:err?.message?.startsWith('Invalid')?400:503);
    // Do not log email, code, signature or key material.
    respond(res,code,{error:code===503?'Verification service temporarily unavailable':err.message});
  }
}
