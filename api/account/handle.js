import {enabled,redis,validUsername,normalizeSourceAddress,publicWalletKey,ensureVerified,rate,
 nameKey,walletKey,challengeKey,newChallenge,verifyChallenge,checkSourceLNURL,DOMAIN} from '../../server/handleCore.mjs';

const ORIGIN='https://wallet.getyoursats.com';
function send(res,code,obj){res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(obj));}
function clientIp(req){return String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].slice(0,128);}
async function bodyOf(req){
 if(req.body&&typeof req.body==='object')return req.body;
 if(typeof req.body==='string'&&req.body.length<=4000)return JSON.parse(req.body);
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>4000)throw Object.assign(new Error('Request too large'),{status:413});chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export default async function handler(req,res){
 if(req.method==='GET')return send(res,200,{available:enabled(),domain:DOMAIN,requiresVerifiedEmail:true,activityThreshold:0});
 if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
 if(req.headers.origin!==ORIGIN || req.headers['content-type']?.split(';')[0]!=='application/json')
   return send(res,403,{error:'Unsupported origin'});
 if(!enabled())return send(res,503,{error:'Custom Lightning usernames are not enabled'});
 try{
   const body=await bodyOf(req);
   if(!body || typeof body!=='object' || Array.isArray(body))throw Object.assign(new Error('Invalid request'),{status:400});
   if(body.action==='challenge'){
     const pub=publicWalletKey(body.walletPubkey);
     const mode=body.purpose;
     if(mode!=='claim'&&mode!=='status')throw Object.assign(new Error('Invalid operation'),{status:400});
     await rate('ip:'+clientIp(req),30,3600);
     await rate('pub:'+pub,20,3600);
     await ensureVerified(pub);
     const name=mode==='claim'?body.username:'';
     const source=mode==='claim'?normalizeSourceAddress(body.sourceAddress):'';
     if(mode==='claim'&&!validUsername(name))throw Object.assign(new Error('Choose a different username (3–24 lowercase letters/numbers)'),{status:400});
     const record=newChallenge(pub,mode,name,source);
     const saved=await redis('SET',challengeKey(record.id),JSON.stringify(record),'EX',300,'NX');
     if(saved!=='OK')throw Object.assign(new Error('Could not issue ownership challenge'),{status:503});
     return send(res,200,{challengeId:record.id,message:record.message,expiresIn:300});
   }
   if(body.action!=='claim'&&body.action!=='status')throw Object.assign(new Error('Invalid operation'),{status:400});
   if(typeof body.challengeId!=='string'||!/^[a-f0-9]{36}$/i.test(body.challengeId))throw Object.assign(new Error('Invalid challenge'),{status:400});
   // Challenge is consumed atomically before signature check to prevent replay.
   const encoded=await redis('GETDEL',challengeKey(body.challengeId));
   if(!encoded)throw Object.assign(new Error('Challenge expired'),{status:409});
   const challenge=JSON.parse(encoded);
   verifyChallenge(challenge,body.signature,body.action);
   await ensureVerified(challenge.pub);
   if(body.action==='status'){
     const name=await redis('GET',walletKey(challenge.pub));
     const raw=name?await redis('GET',nameKey(name)):null;
     const claim=raw?JSON.parse(raw):null;
     return send(res,200,{claimed:!!claim,username:claim?.username??null,
       lightningAddress:claim?claim.username+'@'+DOMAIN:null,sourceAddress:claim?.sourceAddress??null});
   }
   await rate('claim:'+challenge.pub,4,86400);
   // Important: successful LNURL lookup alone cannot cryptographically prove that
   // the owner of Breez sourceAddress is the signer. The UI uses the wallet SDK's
   // own getLightningAddress() result, but a stronger provider-side proof is
   // required before claiming this alias mechanism fully audited for production.
   await checkSourceLNURL(challenge.source);
   const record=JSON.stringify({username:challenge.name,sourceAddress:challenge.source,
     walletPubkey:challenge.pub,createdAt:Date.now()});
   const lua="local owner=redis.call('GET',KEYS[1]);local name=redis.call('GET',KEYS[2]);if owner then if owner==ARGV[1] then return 'OWNED' else return 'WALLET_HAS_NAME' end end;if name then return 'TAKEN' end;redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2]);return 'OK'";
   const result=await redis('EVAL',lua,2,walletKey(challenge.pub),nameKey(challenge.name),challenge.name,record);
   if(result!=='OK'&&result!=='OWNED')throw Object.assign(new Error(result==='TAKEN'?'Username is taken':'Wallet already owns a different username'),{status:409});
   return send(res,200,{claimed:true,username:challenge.name,lightningAddress:challenge.name+'@'+DOMAIN});
 }catch(err){
   const status=Number.isSafeInteger(err?.status)?err.status:503;
   // Never echo an arbitrary vendor exception or private signature in responses.
   return send(res,status,{error:status===503?'Username service temporarily unavailable':String(err?.message||'Request failed')});
 }
}
