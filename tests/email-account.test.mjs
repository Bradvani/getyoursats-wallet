import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,ECDH} from 'node:crypto';
import {Readable} from 'node:stream';
import {verifyWalletProof,normalizeEmail,digest,equalHex} from '../server/emailCrypto.mjs';
import handler from '../api/account/email.js';

test('Breez compact secp256k1 signatures prove the exact message and wallet identity',()=>{
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'secp256k1'});
  const publicUncompressed=publicKey.export({format:'der',type:'spki'}).subarray(-65).toString('hex');
  const pub=ECDH.convertKey(publicUncompressed,'secp256k1','hex','hex','compressed');
  const message='gys-email-v1:send:'+pub+':'+('a'.repeat(36));
  const signature=sign('sha256',Buffer.from(message),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('hex');
  assert.equal(verifyWalletProof(message,pub,signature),true);
  assert.equal(verifyWalletProof(message+'tampered',pub,signature),false);
  assert.equal(verifyWalletProof(message,pub,'0'.repeat(128)),false);
  assert.equal(verifyWalletProof(message,'03'+'0'.repeat(64),signature),false);
});
test('verified email inputs normalize and reject header injection',()=>{
 assert.equal(normalizeEmail('  User@Example.COM  '),'user@example.com');
 for (const v of ['bad','user@example.com\nBcc:abc','a..b@example.com','x@','','.user@example.com','user.@example.com','user@a.-b.com','user@'+('a'.repeat(64))+'.com']) {
  assert.throws(()=>normalizeEmail(v));
 }
});

function wallet() {
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'secp256k1'});
  const uncompressed=publicKey.export({format:'der',type:'spki'}).subarray(-65).toString('hex');
  const pub=ECDH.convertKey(uncompressed,'secp256k1','hex','hex','compressed');
  return {pub,sign:message=>sign('sha256',Buffer.from(message),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('hex')};
}

function service(t) {
  const settings={
    GETYOURSATS_EMAIL_ENABLED:'true',UPSTASH_REDIS_REST_URL:'https://email-store.upstash.invalid',
    UPSTASH_REDIS_REST_TOKEN:'test-storage-token',RESEND_API_KEY:'test-sending-key',
    GETYOURSATS_EMAIL_FROM:'GetYourSats <verify@getyoursats.com>',GETYOURSATS_EMAIL_HMAC_KEY:'a'.repeat(64)
  };
  const envKeys=[...Object.keys(settings),'KV_REST_API_URL','KV_REST_API_TOKEN'];
  const originalEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  Object.assign(process.env,settings);
  const originalFetch=globalThis.fetch,originalNow=Date.now;
  let now=Date.UTC(2026,9,26,10),providerOk=true,storageFailure=false;
  Date.now=()=>now;
  const values=new Map(),deadlines=new Map(),commands=[],emails=[],storageRequests=[];
  const get=key=>{
    if(deadlines.has(key)&&deadlines.get(key)<=now){values.delete(key);deadlines.delete(key);}
    return values.get(key)??null;
  };
  const del=key=>{const existed=get(key)!==null;values.delete(key);deadlines.delete(key);return existed?1:0;};
  const redis=command=>{
    commands.push(command);
    const [op,...args]=command;
    if(op==='GET')return get(args[0]);
    if(op==='GETDEL'){const found=get(args[0]);del(args[0]);return found;}
    if(op==='DEL')return del(args[0]);
    if(op==='SET'){
      const [key,value,expiry,seconds,mode]=args;
      if(mode==='NX'&&get(key)!==null)return null;
      values.set(key,value);
      if(expiry==='EX')deadlines.set(key,now+Number(seconds)*1000);
      return 'OK';
    }
    if(op==='EVAL'){
      const [script,keyCount,...parameters]=args;
      if(keyCount===1){
        assert.match(script,/if count==1 then redis.call\('EXPIRE'/);
        const [key,seconds]=parameters;
        const count=Number(get(key)??0)+1;
        values.set(key,count);
        if(count===1)deadlines.set(key,now+Number(seconds)*1000);
        return count;
      }
      assert.equal(keyCount,2);
      assert.match(script,/currentOwner/);
      const [ownerKey,verifiedKey,pub,value]=parameters;
      const owner=get(ownerKey);
      if(owner!==null&&owner!==pub)return 'EMAIL_IN_USE';
      if(get(verifiedKey)!==null)return 'WALLET_ALREADY_LINKED';
      values.set(ownerKey,pub);values.set(verifiedKey,value);
      return 'OK';
    }
    assert.fail('Unexpected Redis command '+op);
  };
  globalThis.fetch=async (url,options)=>{
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    if(String(url)==='https://email-store.upstash.invalid/'){
      storageRequests.push({url:String(url),authorization:options.headers.Authorization});
      if(storageFailure)return new Response(JSON.stringify({error:'storage unavailable'}),{status:503});
      return Response.json({result:redis(JSON.parse(options.body))});
    }
    assert.equal(String(url),'https://api.resend.com/emails');
    const body=JSON.parse(options.body);
    emails.push({body,code:body.text.match(/code is (\d{6})\./)?.[1]});
    return Response.json(providerOk?{id:'test-message-id'}:{error:'provider failure'},{status:providerOk?200:503});
  };
  t.after(()=>{
    globalThis.fetch=originalFetch;Date.now=originalNow;
    for(const [key,value] of Object.entries(originalEnv)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });
  const invoke=async(body,overrides={})=>{
    const headers={origin:'https://wallet.getyoursats.com','content-type':'application/json','x-vercel-forwarded-for':'192.0.2.1',...overrides.headers};
    const req=overrides.raw===undefined?{body}:Readable.from([overrides.raw]);
    Object.assign(req,{method:overrides.method??'POST',headers});
    const res={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}};
    await handler(req,res);
    return res;
  };
  const proof=async(account,purpose,headers)=>{
    const response=await invoke({action:'challenge',purpose,walletPubkey:account.pub},{headers});
    assert.equal(response.statusCode,200,JSON.stringify(response.body));
    const {challengeId,message}=response.body;
    return {challengeId,signature:account.sign(message)};
  };
  const send=async(account,email,headers)=>invoke({action:'send',email,...await proof(account,'send',headers)},{headers});
  const status=async(account,headers)=>invoke({action:'status',...await proof(account,'status',headers)},{headers});
  return {invoke,proof,send,status,values,commands,emails,storageRequests,advance:ms=>{now+=ms;},setProviderOk:value=>{providerOk=value;},setStorageFailure:value=>{storageFailure=value;},settings};
}

test('signed email and one-use OTP flow creates one durable wallet binding and restores its status',async t=>{
  const api=service(t),account=wallet();
  assert.deepEqual((await api.status(account)).body,{verified:false,email:null});
  const sent=await api.send(account,' User@Example.com ');
  assert.equal(sent.statusCode,200);
  assert.equal(api.emails.length,1);
  assert.deepEqual(api.emails[0].body.to,['user@example.com']);
  const request={action:'verify',requestId:sent.body.requestId,code:api.emails[0].code};
  const verified=await api.invoke(request);
  assert.equal(verified.statusCode,200);
  assert.deepEqual(verified.body,{verified:true,email:'user@example.com'});
  assert.deepEqual((await api.status(account)).body,verified.body);
  assert.equal((await api.invoke(request)).statusCode,409);
  const record=JSON.parse(api.values.get('gys:email:v1:wallet:'+account.pub));
  assert.ok(record.verifiedAt>0);
  assert.equal((await api.send(account,'other@example.com')).statusCode,409);
  assert.equal(api.emails.length,1);
});

test('wrong-wallet signatures, changed action, expired challenges and replay cannot issue mail or reveal status',async t=>{
  const api=service(t),account=wallet(),other=wallet();
  const challenge=await api.invoke({action:'challenge',purpose:'send',walletPubkey:account.pub});
  const request={action:'send',email:'user@example.com',challengeId:challenge.body.challengeId,signature:other.sign(challenge.body.message)};
  assert.equal((await api.invoke(request)).statusCode,401);
  request.signature=account.sign(challenge.body.message);
  assert.equal((await api.invoke(request)).statusCode,409);
  const wrongAction=await api.proof(account,'send');
  assert.equal((await api.invoke({action:'status',...wrongAction})).statusCode,401);
  const expired=await api.proof(account,'send');
  api.advance(301_000);
  assert.equal((await api.invoke({action:'send',email:'user@example.com',...expired})).statusCode,409);
  assert.equal(api.emails.length,0);
});

test('OTP attempts are capped at five and expired codes do not verify',async t=>{
  const api=service(t),account=wallet();
  const sent=await api.send(account,'user@example.com');
  const correct=api.emails[0].code,wrong=correct==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)assert.equal((await api.invoke({action:'verify',requestId:sent.body.requestId,code:wrong})).statusCode,401);
  assert.equal((await api.invoke({action:'verify',requestId:sent.body.requestId,code:correct})).statusCode,429);
  assert.equal(api.values.has('gys:email:v1:wallet:'+account.pub),false);
  const next=await api.send(account,'user@example.com');
  api.advance(601_000);
  assert.equal((await api.invoke({action:'verify',requestId:next.body.requestId,code:api.emails[1].code})).statusCode,409);
});

test('mailbox uniqueness is checked after its code and concurrent OTP reuse has one winner',async t=>{
  const api=service(t),first=wallet(),second=wallet();
  const initial=await api.send(first,'user@example.com');
  const attempts=await Promise.all(Array.from({length:2},()=>api.invoke({action:'verify',requestId:initial.body.requestId,code:api.emails[0].code})));
  assert.deepEqual(attempts.map(value=>value.statusCode).sort(),[200,409]);
  const duplicate=await api.send(second,'user@example.com');
  assert.equal(duplicate.statusCode,200);
  assert.equal((await api.invoke({action:'verify',requestId:duplicate.body.requestId,code:api.emails[1].code})).statusCode,409);
  assert.equal(api.values.has('gys:email:v1:wallet:'+second.pub),false);
  assert.deepEqual((await api.status(first)).body,{verified:true,email:'user@example.com'});
});

test('challenge, send and code limits are independent and failed requests do not extend their windows',async t=>{
  const api=service(t),account=wallet();
  for(let i=0;i<12;i++)assert.equal((await api.status(account)).statusCode,200);
  for(let i=0;i<4;i++)assert.equal((await api.send(account,'user@example.com')).statusCode,200);
  const nextProof=await api.proof(account,'send');
  assert.equal((await api.invoke({action:'send',email:'user@example.com',...nextProof})).statusCode,429);
  api.advance(86_399_000);
  assert.equal((await api.send(account,'user@example.com')).statusCode,429);
  api.advance(2_000);
  assert.equal((await api.send(account,'user@example.com')).statusCode,200);
});

test('the shared daily mail budget stops new wallets after 80 attempts and resets at UTC midnight',async t=>{
  const api=service(t);
  for(let i=0;i<80;i++){
    const headers={'x-vercel-forwarded-for':'192.0.2.'+(i+1)};
    assert.equal((await api.send(wallet(),'user'+i+'@example.com',headers)).statusCode,200);
  }
  const account=wallet(),headers={'x-vercel-forwarded-for':'198.51.100.1'};
  assert.equal((await api.send(account,'next@example.com',headers)).statusCode,429);
  assert.equal(api.emails.length,80);
  api.advance(14*60*60*1000);
  assert.equal((await api.send(account,'next@example.com',headers)).statusCode,200);
  assert.equal(api.emails.length,81);
});

test('provider failure removes its pending OTP and storage errors fail closed',async t=>{
  const api=service(t),account=wallet();
  api.setProviderOk(false);
  assert.equal((await api.send(account,'user@example.com')).statusCode,503);
  assert.equal([...api.values.keys()].some(key=>key.includes(':pending:')),false);
  api.setStorageFailure(true);
  const response=await api.invoke({action:'challenge',purpose:'status',walletPubkey:account.pub});
  assert.equal(response.statusCode,503);
  assert.deepEqual(response.body,{error:'Verification service temporarily unavailable'});
});

test('malformed stored verification is never treated as an eligible account',async t=>{
  const api=service(t),account=wallet();
  for(const record of ['true','{}','{"email":"user@example.com"}','{"email":"user@example.com","verifiedAt":0}','not-json']){
    api.values.set('gys:email:v1:wallet:'+account.pub,record);
    const response=await api.status(account);
    assert.equal(response.statusCode,503);
    assert.equal(response.body.verified,undefined);
  }
});

test('unsafe origins, body sizes, IP headers and storage URLs are rejected before provider work',async t=>{
  const api=service(t),body={action:'challenge',purpose:'status',walletPubkey:wallet().pub};
  assert.equal((await api.invoke(body,{headers:{origin:'https://attacker.example'}})).statusCode,403);
  assert.equal((await api.invoke({...body,extra:'a'.repeat(4096)})).statusCode,413);
  assert.equal((await api.invoke(body,{raw:Buffer.alloc(4097)})).statusCode,413);
  for(const ip of [undefined,'192.0.2.1, 203.0.113.5','unknown','[2001:db8::1]']){
    assert.equal((await api.invoke(body,{headers:{'x-vercel-forwarded-for':ip}})).statusCode,503);
  }
  for(const url of ['http://email-store.upstash.invalid','https://secret@example.com']){
    process.env.UPSTASH_REDIS_REST_URL=url;
    assert.deepEqual((await api.invoke(null,{method:'GET'})).body,{available:false});
  }
  assert.equal(api.commands.length,0);
  assert.equal(api.emails.length,0);
});

test('Vercel Redis aliases use one complete credential pair and never combine providers',async t=>{
  const api=service(t),account=wallet();
  process.env.KV_REST_API_URL='https://other-store.upstash.invalid';
  process.env.KV_REST_API_TOKEN='kv-test-token';
  assert.equal((await api.status(account)).statusCode,200);
  assert.equal(api.storageRequests.at(-1).authorization,'Bearer test-storage-token');

  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.KV_REST_API_URL=api.settings.UPSTASH_REDIS_REST_URL;
  assert.deepEqual((await api.invoke(null,{method:'GET'})).body,{available:false});
  delete process.env.UPSTASH_REDIS_REST_URL;
  assert.equal((await api.status(account)).statusCode,200);
  assert.equal(api.storageRequests.at(-1).authorization,'Bearer kv-test-token');

  process.env.UPSTASH_REDIS_REST_URL=api.settings.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_URL;
  const before=api.storageRequests.length;
  assert.deepEqual((await api.invoke(null,{method:'GET'})).body,{available:false});
  assert.equal((await api.invoke({action:'challenge',purpose:'status',walletPubkey:account.pub})).statusCode,503);
  assert.equal(api.storageRequests.length,before);
});
test('HMAC digests compare in constant time for valid hex',()=>{
 const a=digest('a'.repeat(32),'code');const b=digest('a'.repeat(32),'other');
 assert.equal(equalHex(a,a),true);assert.equal(equalHex(a,b),false);assert.equal(equalHex(a,'x'),false);
});
test('without provider secrets email endpoints fail closed',async()=>{
 const old=process.env.GETYOURSATS_EMAIL_ENABLED;
 process.env.GETYOURSATS_EMAIL_ENABLED='false';
 const invoke=async (method,origin)=>{
  const response={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=JSON.parse(body)}};
  await handler({method,headers:{origin,'content-type':'application/json'}},response);
  return response;
 };
 try{
  assert.deepEqual((await invoke('GET')).body,{available:false});
  assert.equal((await invoke('POST','https://wallet.getyoursats.com')).statusCode,503);
  assert.equal((await invoke('POST','https://attacker.example')).statusCode,403);
 }finally{if(old===undefined)delete process.env.GETYOURSATS_EMAIL_ENABLED;else process.env.GETYOURSATS_EMAIL_ENABLED=old;}
});
