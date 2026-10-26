import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,ECDH,generateKeyPairSync,sign} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough,Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createBreezLnurlProxy} from '../site/server/breezLnurlProxy.mjs';
import {validUsername} from '../server/handleCore.mjs';

const DOMAIN='getyoursats.com';
const ORIGIN='https://wallet.getyoursats.com';
const SECRET='test-proxy-secret-never-a-production-credential';
const NOW=1_790_000_000;
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'secp256k1'});
const pubkey=ECDH.convertKey(publicKey.export({type:'spki',format:'der'}).subarray(-65),'secp256k1',undefined,'hex','compressed');
const BASE='/lnurlpay/'+pubkey;
const environment={
  BREEZ_LNURL_PROXY_SECRET:SECRET,GETYOURSATS_NATIVE_HANDLES_ENABLED:'true',
  UPSTASH_REDIS_REST_URL:'https://test-storage.example',UPSTASH_REDIS_REST_TOKEN:'test-storage-token'
};

function signedRegistration({username='alice',description='Pay to alice',timestamp=NOW,domain=DOMAIN,message}={}){
  const signed=message??['breez-lnurl:v2','register',domain,username,createHash('sha256').update(description).digest('hex'),String(timestamp)].join('\n');
  return {username,description,timestamp,signature:sign('sha256',Buffer.from(signed),{key:privateKey,dsaEncoding:'der'}).toString('hex')};
}

function signedManagement(operation,username='alice'){
  const fields=['breez-lnurl:v2',operation,DOMAIN];
  if(operation==='unregister')fields.push(username);
  else fields.push(pubkey,...(operation==='available'?[username]:[]));
  fields.push(String(NOW));
  return {timestamp:NOW,signature:sign('sha256',Buffer.from(fields.join('\n')),{key:privateKey,dsaEncoding:'der'}).toString('hex'),
    ...(['unregister','available'].includes(operation)?{username}:{})};
}

function responseRecorder(){
  return {headers:{},statusCode:200,
    setHeader(name,value){this.headers[name.toLowerCase()]=value;},
    end(body){this.body=body===undefined?Buffer.alloc(0):Buffer.from(body);this.ended=true;}
  };
}

function incoming({url=BASE,method='POST',body=JSON.stringify(signedRegistration()),headers={},restored=false}={}){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
  const req=Readable.from([bytes.subarray(0,4),bytes.subarray(4)]);
  req.url=url;
  req.method=method;
  req.headers={host:DOMAIN,'x-vercel-forwarded-for':'192.0.2.10',origin:ORIGIN,
    authorization:'Bearer test-sdk-api-key','content-type':'application/json',...headers};
  req.socket={remoteAddress:'203.0.113.99'};
  Object.defineProperty(req,'body',{get(){throw new Error('The parsed Vercel body must not be read');}});
  Object.defineProperty(req,'query',{get(){throw new Error('Parsed query parameters must not be used');}});
  if(restored){
    // This is the Node helper's restoreBody shape, including the exhausted original stream.
    req.read();req.read();
    const duplicate=new PassThrough();
    const originalOn=req.on.bind(req);
    req.read=duplicate.read.bind(duplicate);
    req.on=req.addListener=(name,callback)=>name==='data'||name==='end'?duplicate.on(name,callback):originalOn(name,callback);
    duplicate.end(bytes);
  }
  return req;
}

function harness({env={},redisResult=JSON.stringify({email:'verified@example.com',verifiedAt:NOW*1000}),redisError,
  upstreamStatus=200,upstreamBody=Buffer.from('{"ok":true}'),upstreamHeaders={},upstreamError,upstream}={}){
  const forwarded=[],storage=[];
  const fetchImpl=async(url,options)=>{
    storage.push({url,options});
    if(redisError)throw redisError;
    return new Response(JSON.stringify({result:redisResult}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const requestImpl=(options,callback)=>{
    const request=new EventEmitter();
    request.end=body=>{
      forwarded.push({options,body:Buffer.from(body)});
      queueMicrotask(()=>{
        if(upstreamError){request.emit('error',upstreamError);return;}
        const current=upstream?.(forwarded.length)??{status:upstreamStatus,body:upstreamBody,headers:upstreamHeaders};
        const response=Readable.from([Buffer.from(current.body)]);
        response.statusCode=current.status;
        response.headers={'content-type':'application/json',...current.headers};
        callback(response);
      });
    };
    return request;
  };
  const handler=createBreezLnurlProxy({env:{...environment,...env},requestImpl,fetchImpl,now:()=>NOW*1000});
  return {forwarded,storage,async invoke(options){
    const req=incoming(options),res=responseRecorder();
    await handler(req,res);
    assert.equal(res.ended,true);
    assert.equal(res.headers['cache-control'],'no-store, max-age=0');
    assert.equal(res.headers['cdn-cache-control'],'no-store');
    assert.equal(res.headers['vercel-cdn-cache-control'],'no-store');
    assert.equal(res.body.includes(Buffer.from(SECRET)),false);
    return res;
  }};
}

test('forwards raw public method, path, query, bytes and end-to-end headers to a fixed TLS endpoint',async()=>{
  const body=Buffer.from([0,255,13,10,123,34,125]);
  const target='/lnurlp/alice/invoice?amount=1000&comment=a+b%2Fc&nonce=x&nonce=y%2f&empty=';
  const output=Buffer.from('{ "metadata" : "unchanged\\u2603" }\n');
  const app=harness({upstreamBody:output,upstreamHeaders:{'cache-control':'public, max-age=3600',
    'access-control-allow-origin':'https://attacker.example','set-cookie':'sensitive=1',
    'x-breez-reverse-proxy-shared-secret':SECRET,'location':'https://attacker.example'}});
  const response=await app.invoke({url:target,method:'PROPFIND',body,headers:{origin:'https://paying-wallet.example',
    host:'spoofed.example','content-length':'999',cookie:'private-site-cookie',
    'x-forwarded-for':'198.51.100.8, 10.0.0.1','x-real-ip':'198.51.100.8',forwarded:'for=198.51.100.8',
    'x-forwarded-host':'attacker.example','x-original-url':BASE,'x-rewrite-url':BASE,
    'x-vercel-protection-bypass':'private-preview-token','x-breez-reverse-proxy-shared-secret':'spoofed-secret',
    connection:'keep-alive, x-hop','x-hop':'remove','x-http-method-override':'POST',
    'x-sdk-version':'test','content-type':'application/octet-stream'}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.body,output);
  assert.equal(response.headers['access-control-allow-origin'],'*');
  for(const name of ['set-cookie','location','x-breez-reverse-proxy-shared-secret'])assert.equal(response.headers[name],undefined);
  assert.equal(app.storage.length,0);
  const sent=app.forwarded[0];
  assert.equal(sent.options.hostname,'breez.tips');
  assert.equal(sent.options.servername,'breez.tips');
  assert.equal(sent.options.protocol,'https:');
  assert.equal(sent.options.port,443);
  assert.equal(sent.options.rejectUnauthorized,true);
  assert.equal(sent.options.path,target);
  assert.equal(sent.options.method,'PROPFIND');
  assert.deepEqual(sent.body,body);
  assert.equal(sent.options.headers.host,DOMAIN);
  assert.equal(sent.options.headers['x-breez-reverse-proxy-shared-secret'],SECRET);
  assert.equal(sent.options.headers['x-forwarded-for'],'192.0.2.10');
  assert.equal(sent.options.headers['content-length'],String(body.length));
  assert.equal(sent.options.headers.authorization,'Bearer test-sdk-api-key');
  assert.equal(sent.options.headers['x-sdk-version'],'test');
  for(const name of ['cookie','connection','x-hop','x-real-ip','forwarded','x-forwarded-host',
    'x-original-url','x-rewrite-url','x-vercel-protection-bypass','x-vercel-forwarded-for','x-http-method-override'])
    assert.equal(sent.options.headers[name],undefined,name);
});

test('public discovery, invoice and verification routes preserve non-preflight methods without email services',async()=>{
  const app=harness({env:{GETYOURSATS_NATIVE_HANDLES_ENABLED:undefined,UPSTASH_REDIS_REST_URL:undefined}});
  for(const url of ['/.well-known/lnurlp/alice','/lnurlp/alice','/lnurlp/alice/invoice',
    '/lnurlp/verify/'+'a'.repeat(64),'/lnurlp/verify/invoice']){
    for(const method of ['GET','HEAD','POST','PATCH','OPTIONS']){
      const response=await app.invoke({url,method,body:'',headers:{origin:undefined}});
      assert.equal(response.statusCode,200,url+' '+method);
      assert.equal(app.forwarded.at(-1).options.method,method);
    }
  }
  assert.equal(app.storage.length,0);
});

test('native v2 registration requires the matching verified identity and preserves original JSON bytes',async()=>{
  const payload=signedRegistration({description:' Pay to alice: snowman ☃\n'});
  const raw=Buffer.from(JSON.stringify(payload,null,2).replace('☃','\\u2603')+'\n');
  const app=harness();
  const result=await app.invoke({body:raw,url:BASE+'?one=a+b&one=a%20b',restored:true});
  assert.equal(result.statusCode,200);
  assert.deepEqual(app.forwarded[0].body,raw);
  assert.equal(app.forwarded[0].options.path,BASE+'?one=a+b&one=a%20b');
  assert.equal(result.headers['access-control-allow-origin'],ORIGIN);
  assert.equal(app.storage.length,1);
  assert.deepEqual(JSON.parse(app.storage[0].options.body),['GET','gys:email:v1:wallet:'+pubkey]);
  assert.equal(app.storage[0].options.headers.Authorization,'Bearer test-storage-token');
  assert.equal(app.storage[0].options.redirect,'error');
  assert.equal(app.storage[0].options.cache,'no-store');
});

test('accepts the pinned SDK canonical message with its independently specified description hash',async()=>{
  const message='breez-lnurl:v2\nregister\ngetyoursats.com\nalice\n'+
    '0261d8b11c7eba9f71ccf5180df58416d3b2d19ba917caf57ba4bacead3ce2c2\n1790000000';
  const app=harness();
  assert.equal((await app.invoke({body:JSON.stringify(signedRegistration({message}))})).statusCode,200);
  assert.equal(app.forwarded.length,1);
});

test('uses the integration read-only credential without mixing storage configuration pairs',async()=>{
  const integration={UPSTASH_REDIS_REST_URL:undefined,UPSTASH_REDIS_REST_TOKEN:undefined,
    KV_REST_API_URL:'https://integration-storage.example',KV_REST_API_TOKEN:'test-write-token',
    KV_REST_API_READ_ONLY_TOKEN:'test-read-token'};
  const app=harness({env:integration});
  assert.equal((await app.invoke()).statusCode,200);
  assert.equal(app.storage[0].url,'https://integration-storage.example/');
  assert.equal(app.storage[0].options.headers.Authorization,'Bearer test-read-token');
  const partial=harness({env:{...integration,UPSTASH_REDIS_REST_URL:'https://explicit-storage.example'}});
  assert.equal((await partial.invoke()).statusCode,503);
  assert.equal(partial.storage.length,0);
  assert.equal(partial.forwarded.length,0);
  const explicit=harness({env:{...integration,UPSTASH_REDIS_REST_URL:environment.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN:environment.UPSTASH_REDIS_REST_TOKEN}});
  assert.equal((await explicit.invoke()).statusCode,200);
  assert.equal(explicit.storage[0].options.headers.Authorization,'Bearer test-storage-token');
});

test('feature and storage configuration fail closed before forwarding registration',async()=>{
  for(const env of [{GETYOURSATS_NATIVE_HANDLES_ENABLED:'false'},{GETYOURSATS_NATIVE_HANDLES_ENABLED:undefined},
    {UPSTASH_REDIS_REST_URL:undefined},{UPSTASH_REDIS_REST_TOKEN:''}]){
    const app=harness({env});
    assert.equal((await app.invoke()).statusCode,503);
    assert.equal(app.forwarded.length,0);
    assert.equal(app.storage.length,0);
  }
});

test('missing, corrupt or unavailable verified-email records never grant registration',async()=>{
  for(const [options,status] of [
    [{redisResult:null},403],
    [{redisResult:'not-json'},503],
    [{redisResult:JSON.stringify({email:'unverified@example.com'})},503],
    [{redisResult:JSON.stringify({email:'',verifiedAt:NOW})},503],
    [{redisError:new Error('private storage failure '+SECRET)},503],
    [{env:{UPSTASH_REDIS_REST_URL:'http://test-storage.example'}},503]
  ]){
    const app=harness(options);
    assert.equal((await app.invoke()).statusCode,status);
    assert.equal(app.forwarded.length,0);
  }
});

test('invalid signature, wrong domain, legacy messages and changed signed fields fail before the email lookup',async()=>{
  const original=signedRegistration();
  const cases=[
    {...original,signature:'00'.repeat(70)},
    signedRegistration({domain:'breez.tips'}),
    signedRegistration({message:'alice-'+NOW}),
    {...original,username:'bob'},
    {...original,description:'Pay to a different recipient'},
    {...original,timestamp:NOW+1},
    signedRegistration({timestamp:NOW-601}),
    signedRegistration({timestamp:NOW+601})
  ];
  for(const payload of cases){
    const app=harness();
    assert.equal((await app.invoke({body:JSON.stringify(payload)})).statusCode,401);
    assert.equal(app.forwarded.length,0);
    assert.equal(app.storage.length,0);
  }
  for(const delta of [-600,600]){
    const app=harness();
    assert.equal((await app.invoke({body:JSON.stringify(signedRegistration({timestamp:NOW+delta}))})).statusCode,200);
  }
});

test('another wallet cannot claim with the verified wallet signature',async()=>{
  const other=generateKeyPairSync('ec',{namedCurve:'secp256k1'}).publicKey;
  const otherPub=ECDH.convertKey(other.export({type:'spki',format:'der'}).subarray(-65),'secp256k1',undefined,'hex','compressed');
  const app=harness();
  assert.equal((await app.invoke({url:'/lnurlpay/'+otherPub})).statusCode,401);
  assert.equal(app.storage.length,0);
  assert.equal(app.forwarded.length,0);
});

test('registration enforces the existing username policy and exact description limit',async()=>{
  for(const username of ['admin','support','security','billing','wallet','pay','api','help','contact','breez','getyoursats',
    'satoshi','root','system','staff','official','team','verify','login','auth','www','mail','postmaster','abuse',
    'ab','Alice',' alice ','1alice','alice-bob','alice_bob','a'.repeat(25)]){
    assert.equal(validUsername(username),false);
    const app=harness();
    assert.equal((await app.invoke({body:JSON.stringify(signedRegistration({username}))})).statusCode,400,username);
    assert.equal(app.forwarded.length,0);
  }
  for(const username of ['abc','alice','sats123','a'.repeat(24)]){
    assert.equal(validUsername(username),true);
    const app=harness();
    assert.equal((await app.invoke({body:JSON.stringify(signedRegistration({username,description:'☃'.repeat(255)}))})).statusCode,200);
  }
  const app=harness();
  assert.equal((await app.invoke({body:JSON.stringify(signedRegistration({description:'☃'.repeat(256)}))})).statusCode,400);
});

test('malformed JSON, timestamps, encoding and oversized bodies are rejected without forwarding',async()=>{
  for(const [body,headers,status] of [
    ['{',{},400],['[]',{},400],['null',{},400],[Buffer.from([0xff]),{},400],
    [JSON.stringify({...signedRegistration(),timestamp:'1790000000'}),{},400],
    [JSON.stringify({...signedRegistration(),timestamp:Number.MAX_SAFE_INTEGER+1}),{},400],
    [JSON.stringify(signedRegistration()),{'content-type':'text/plain'},415],
    [JSON.stringify(signedRegistration()),{'content-encoding':'gzip'},415],
    [' '.repeat(8193),{},413]
  ]){
    const app=harness();
    assert.equal((await app.invoke({body,headers})).statusCode,status);
    assert.equal(app.forwarded.length,0);
    assert.equal(app.storage.length,0);
  }
});

test('recovery, metadata, owner deletion and availability do not depend on registration flags or email storage',async()=>{
  const app=harness({env:{GETYOURSATS_NATIVE_HANDLES_ENABLED:'false',UPSTASH_REDIS_REST_URL:undefined,
    UPSTASH_REDIS_REST_TOKEN:undefined},redisError:new Error('Email outage')});
  const metadata=signedManagement('metadata');
  const cases=[
    {url:BASE+'/recover',method:'POST',body:JSON.stringify(signedManagement('recover'))},
    {url:BASE,method:'DELETE',body:JSON.stringify(signedManagement('unregister'))},
    {url:BASE+'/available',method:'POST',body:JSON.stringify(signedManagement('available'))},
    {url:'/lnurlpay/available/alice',method:'GET',body:''},
    {url:BASE+'/metadata?offset=0&limit=10&updated_after=0',method:'GET',body:'',
      headers:{origin:undefined,'x-breez-signature':metadata.signature,'x-breez-timestamp':String(metadata.timestamp)}}
  ];
  for(const request of cases){
    assert.equal((await app.invoke(request)).statusCode,200);
    assert.deepEqual(app.forwarded.at(-1).body,Buffer.from(request.body));
    assert.equal(app.forwarded.at(-1).options.path,request.url);
  }
  assert.equal(app.storage.length,0);
  assert.equal(app.forwarded.at(-1).options.headers['x-breez-signature'],metadata.signature);
  assert.equal(app.forwarded.at(-1).options.headers['x-breez-timestamp'],String(NOW));
});

test('transfer, unknown private routes and unsupported private methods cannot bypass registration gating',async()=>{
  for(const [url,method,status] of [
    [BASE+'/transfer','POST',403],[BASE+'/transfer','DELETE',403],
    [BASE+'/unexpected','POST',404],[BASE+'/recover/extra','POST',404],
    [BASE,'PUT',405],[BASE,'PATCH',405],[BASE+'/recover','DELETE',405],
    [BASE+'/metadata','POST',405],['/lnurlpay/available/alice','POST',405],
    ['/lnurlpay/'+'ff'.repeat(33),'POST',404],['/webhook','POST',404],
    ['/lnurlp/alice/administration','POST',404],['/verify/'+'a'.repeat(64),'GET',404]
  ]){
    const app=harness();
    assert.equal((await app.invoke({url,method})).statusCode,status,url);
    assert.equal(app.forwarded.length,0);
    assert.equal(app.storage.length,0);
  }
});

test('direct API requests and encoded or ambiguous paths cannot supply an upstream route',async()=>{
  for(const url of ['/api/breez-lnurl','/api/breez-lnurl?path='+BASE,
    '/api/breez-lnurl?url=https%3A%2F%2Fbreez.tips'+BASE,'/api/breez-lnurl?0='+BASE,
    '/lnurlp/%2e%2e/lnurlpay/'+pubkey,'/lnurlp/alice%2finvoice',
    '/lnurlp//alice','/lnurlp/../invoice','//breez.tips/lnurlp/alice',
    'https://breez.tips/lnurlp/alice','/lnurlp/alice#fragment','/lnurlp/alice\\invoice']){
    const app=harness();
    const result=await app.invoke({url,headers:{'x-original-url':BASE,'x-rewrite-url':BASE,'x-matched-path':BASE}});
    assert.ok([400,404].includes(result.statusCode),url);
    assert.equal(app.forwarded.length,0);
    assert.equal(app.storage.length,0);
  }
});

test('private CORS permits SDK preflight headers and rejects foreign origins or methods',async()=>{
  const app=harness({env:{BREEZ_LNURL_PROXY_SECRET:undefined,GETYOURSATS_NATIVE_HANDLES_ENABLED:'false'}});
  const result=await app.invoke({method:'OPTIONS',body:'',headers:{'access-control-request-method':'POST',
    'access-control-request-headers':'Authorization, Content-Type, X-Breez-Signature, X-Breez-Timestamp'}});
  assert.equal(result.statusCode,204);
  assert.equal(result.headers['access-control-allow-origin'],ORIGIN);
  assert.equal(result.headers['access-control-allow-headers'],'authorization, content-type, x-breez-signature, x-breez-timestamp');
  assert.equal(app.forwarded.length,0);
  for(const [headers,status] of [[{origin:'https://attacker.example'},403],[{origin:'null'},403],
    [{'access-control-request-method':'PATCH'},405],
    [{'access-control-request-headers':'X-Breez-Reverse-Proxy-Shared-Secret'},403]]){
    const denied=await app.invoke({method:'OPTIONS',headers:{'access-control-request-method':'POST',...headers}});
    assert.equal(denied.statusCode,status);
  }
  assert.equal((await app.invoke({headers:{origin:'https://attacker.example'}})).statusCode,403);
});

test('public CORS accepts external wallets and custom method preflight without credentials',async()=>{
  const app=harness();
  const result=await app.invoke({url:'/.well-known/lnurlp/alice',method:'OPTIONS',body:'',headers:{
    origin:'https://another-wallet.example','access-control-request-method':'PROPFIND','access-control-request-headers':'X-Wallet-Version'}});
  assert.equal(result.statusCode,204);
  assert.equal(result.headers['access-control-allow-origin'],'*');
  assert.equal(result.headers['access-control-allow-methods'],'PROPFIND');
  assert.equal(result.headers['access-control-allow-credentials'],undefined);
  assert.equal(app.forwarded.length,0);
});

test('a single Vercel client IP is required and other IP sources never substitute for it',async()=>{
  for(const value of [undefined,'','192.0.2.10, 192.0.2.20','not-an-ip',['192.0.2.10'],'[2001:db8::1]','fe80::1%eth0']){
    const app=harness();
    assert.equal((await app.invoke({url:'/lnurlp/alice',method:'GET',body:'',headers:{
      'x-vercel-forwarded-for':value,'x-forwarded-for':'192.0.2.10','x-real-ip':'192.0.2.10'}})).statusCode,503);
    assert.equal(app.forwarded.length,0);
  }
  const app=harness();
  assert.equal((await app.invoke({url:'/lnurlp/alice',method:'GET',body:'',headers:{'x-vercel-forwarded-for':'2001:db8::1'}})).statusCode,200);
  assert.equal(app.forwarded[0].options.headers['x-forwarded-for'],'2001:db8::1');
});

test('all proxy routes fail closed without the secret and never reveal it through transport errors',async()=>{
  for(const secret of [undefined,'','bad\nsecret']){
    const app=harness({env:{BREEZ_LNURL_PROXY_SECRET:secret}});
    assert.equal((await app.invoke({url:'/lnurlp/alice',method:'GET',body:''})).statusCode,503);
    assert.equal(app.forwarded.length,0);
  }
  const app=harness({upstreamError:new Error('TLS error with '+SECRET)});
  const result=await app.invoke({url:'/lnurlp/alice',method:'GET',body:''});
  assert.equal(result.statusCode,502);
  assert.equal(result.body.toString().includes('TLS error'),false);
});

test('upstream redirects and accidental secret echoes are rejected without forwarding redirect headers',async()=>{
  for(const options of [{upstreamStatus:302,upstreamHeaders:{location:'https://attacker.example/?secret='+SECRET}},
    {upstreamBody:Buffer.from(SECRET)},
    {upstreamBody:gzipSync(SECRET),upstreamHeaders:{'content-encoding':'gzip'}}]){
    const app=harness(options);
    const result=await app.invoke({url:'/lnurlp/alice',method:'GET',body:''});
    assert.equal(result.statusCode,502);
    assert.equal(result.headers.location,undefined);
    assert.equal(app.forwarded.length,1);
  }
});

test('compressed responses retain their original bytes and compression headers',async()=>{
  const bytes=gzipSync('{"ok":true}');
  const app=harness({upstreamBody:bytes,upstreamHeaders:{'content-encoding':'gzip'}});
  const result=await app.invoke({url:'/lnurlp/alice',method:'GET',body:''});
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.body,bytes);
  assert.equal(result.headers['content-encoding'],'gzip');
});

test('HEAD can retain compression headers with an empty upstream body',async()=>{
  const app=harness({upstreamBody:Buffer.alloc(0),upstreamHeaders:{'content-encoding':'gzip'}});
  const result=await app.invoke({url:'/lnurlp/alice',method:'HEAD',body:''});
  assert.equal(result.statusCode,200);
  assert.equal(result.body.length,0);
  assert.equal(result.headers['content-encoding'],'gzip');
});

test('Breez owns replay rejection and its status and body pass back unchanged',async()=>{
  const replay=Buffer.from('"signature has already been used"');
  const app=harness({upstream:attempt=>({status:attempt===1?200:409,body:attempt===1?'{}':replay,headers:{}})});
  const body=JSON.stringify(signedRegistration());
  assert.equal((await app.invoke({body})).statusCode,200);
  const result=await app.invoke({body});
  assert.equal(result.statusCode,409);
  assert.deepEqual(result.body,replay);
  assert.equal(app.forwarded.length,2);
  assert.deepEqual(app.forwarded[0].body,app.forwarded[1].body);
});

test('Vercel rewrites use a fixed function destination with no target query or named captures',async()=>{
  const config=JSON.parse(await readFile(new URL('../site/vercel.json',import.meta.url),'utf8'));
  assert.deepEqual(config.rewrites,[
    {source:'/.well-known/lnurlp/(.*)',destination:'/api/breez-lnurl'},
    {source:'/lnurlp/(.*)',destination:'/api/breez-lnurl'},
    {source:'/lnurlpay/(.*)',destination:'/api/breez-lnurl'}
  ]);
});
