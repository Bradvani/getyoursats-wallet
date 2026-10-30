import {createHash,createPublicKey,ECDH,verify} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {brotliDecompressSync,gunzipSync,inflateSync} from 'node:zlib';
import {createDirectRecipientDirectory} from './gysDirectRecipients.mjs';

const DOMAIN='getyoursats.com';
const WALLET_ORIGIN='https://wallet.getyoursats.com';
const EMAIL_ROOT='gys:email:v1:wallet:';
const SECRET_HEADER='x-breez-reverse-proxy-shared-secret';
const MAX_BODY_BYTES=1_000_000;
const MAX_RESPONSE_BYTES=4_000_000;
const PRIVATE_HEADERS=new Set(['accept','authorization','content-type','x-breez-signature','x-breez-timestamp']);
const BLOCKED_NAMES=new Set(['admin','support','security','billing','wallet','pay','api','help','contact','breez','getyoursats','satoshi','root','system','staff','official','team','verify','login','auth','www','mail','postmaster','abuse']);
const HOP_HEADERS=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const PRIVATE_PATH=/^\/lnurlpay\/((?:02|03)[0-9a-fA-F]{64})(?:\/(recover|available|metadata|transfer))?$/;
const NAME='[A-Za-z0-9_.-]{1,64}';
const LOOKUP_PATH=new RegExp('^/\\.well-known/lnurlp/('+NAME+')$');
const PAYMENT_PATH=new RegExp('^/lnurlp/('+NAME+')(?:/invoice)?$');
const AVAILABLE_PATH=new RegExp('^/lnurlpay/available/('+NAME+')$');
const METHOD=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

class ProxyError extends Error {
  constructor(status,message){super(message);this.status=status;}
}

function routeFor(target){
  if(typeof target!=='string'||target.length>16_384||!target.startsWith('/')||
      /[\u0000-\u0020\u007f-\uffff#\\]/.test(target))throw new ProxyError(400,'Invalid request target');
  const path=target.split('?',1)[0];
  const direct=path.match(/^\/\.well-known\/gys\/([a-z][a-z0-9]{2,23})$/);
  if(direct&&target===path)return {public:true,directName:direct[1]};
  const publicName=path.match(LOOKUP_PATH)||path.match(PAYMENT_PATH);
  if(publicName&&!['.','..'].includes(publicName[1]))return {public:true};
  if(/^\/lnurlp\/verify\/[0-9a-fA-F]{64}$/.test(path))return {public:true};
  const available=path.match(AVAILABLE_PATH);
  if(available&&!['.','..'].includes(available[1]))return {public:false,methods:['GET']};
  const match=path.match(PRIVATE_PATH);
  if(!match)throw new ProxyError(404,'LNURL route not found');
  if(match[2]==='transfer')throw new ProxyError(403,'Username transfers are not available');
  return {
    public:false,pubkey:match[1].toLowerCase(),operation:match[2]||'registration',
    methods:match[2]==='metadata'?['GET']:match[2]?['POST']:['POST','DELETE']
  };
}

function setNoCache(res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
}

function respondError(res,status,message){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify({status:'ERROR',reason:message}));
}

function configureCors(req,res,route){
  const origin=req.headers.origin;
  if(!route.public&&origin!==undefined&&origin!==WALLET_ORIGIN)
    throw new ProxyError(403,'Unsupported origin');
  res.setHeader('Access-Control-Allow-Origin',route.public?'*':WALLET_ORIGIN);
  res.setHeader('Vary','Origin');
  const requestedMethod=req.headers['access-control-request-method'];
  if(req.method!=='OPTIONS'||(route.public&&requestedMethod===undefined))return false;
  if(typeof requestedMethod!=='string'||!METHOD.test(requestedMethod)||
      (!route.public&&!route.methods.includes(requestedMethod)))
    throw new ProxyError(405,'Method not allowed');
  const raw=req.headers['access-control-request-headers'];
  if(raw!==undefined&&typeof raw!=='string')throw new ProxyError(400,'Invalid preflight');
  const headers=raw?raw.split(',').map(value=>value.trim().toLowerCase()):[];
  if(headers.some(value=>!METHOD.test(value)||(!route.public&&!PRIVATE_HEADERS.has(value))))
    throw new ProxyError(403,'Unsupported request headers');
  res.setHeader('Access-Control-Allow-Methods',route.public?requestedMethod:route.methods.join(', '));
  if(headers.length)res.setHeader('Access-Control-Allow-Headers',headers.join(', '));
  res.setHeader('Vary','Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  res.statusCode=204;
  res.end();
  return true;
}

function clientIp(req){
  // Vercel injects this value. A forwarded chain or a socket's proxy IP is not a client identity.
  const value=req.headers['x-vercel-forwarded-for'];
  if(typeof value!=='string'||/[\s,%\[\]]/.test(value)||!isIP(value))
    throw new ProxyError(503,'Client address unavailable');
  return value;
}

function readRawBody(req,limit){
  return new Promise((resolve,reject)=>{
    const chunks=[];
    let size=0,failed=false;
    const fail=error=>{if(!failed){failed=true;reject(error);}};
    // Vercel's Node helpers restore these events after reading the original stream.
    // Reading req.body or using its async iterator would lose that raw representation.
    req.on('data',chunk=>{
      if(failed)return;
      if(!Buffer.isBuffer(chunk)&&!(chunk instanceof Uint8Array)){
        fail(new ProxyError(400,'Raw request body required'));return;
      }
      size+=chunk.length;
      if(size>limit){fail(new ProxyError(413,'Request too large'));return;}
      chunks.push(Buffer.from(chunk));
    });
    req.on('end',()=>{if(!failed)resolve(Buffer.concat(chunks,size));});
    req.on('error',()=>fail(new ProxyError(400,'Request interrupted')));
    req.on('aborted',()=>fail(new ProxyError(400,'Request interrupted')));
  });
}

function validUsername(value){
  return typeof value==='string'&&/^[a-z][a-z0-9]{2,23}$/.test(value)&&!BLOCKED_NAMES.has(value);
}

function registrationPayload(raw,pubkey,now){
  let body;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw new ProxyError(400,'Invalid registration request');}
  if(!body||typeof body!=='object'||Array.isArray(body)||!validUsername(body.username)||
      typeof body.description!=='string'||[...body.description].length>255||
      !Number.isSafeInteger(body.timestamp)||body.timestamp<0||
      typeof body.signature!=='string'||!/^(?:[0-9a-f]{2}){8,72}$/i.test(body.signature))
    throw new ProxyError(400,'Invalid registration request');
  if(Math.abs(Math.floor(now()/1000)-body.timestamp)>600)
    throw new ProxyError(401,'Registration signature expired');
  const descriptionHash=createHash('sha256').update(body.description,'utf8').digest('hex');
  const message=['breez-lnurl:v2','register',DOMAIN,body.username,descriptionHash,String(body.timestamp)].join('\n');
  let authenticated=false;
  try{
    const uncompressed=ECDH.convertKey(pubkey,'secp256k1','hex','hex','uncompressed');
    const spki=Buffer.concat([
      Buffer.from('3056301006072a8648ce3d020106052b8104000a03420004','hex'),
      Buffer.from(uncompressed.slice(2),'hex')
    ]);
    const key=createPublicKey({key:spki,format:'der',type:'spki'});
    authenticated=verify('sha256',Buffer.from(message,'utf8'),{key,dsaEncoding:'der'},Buffer.from(body.signature,'hex'));
  }catch{/* Invalid keys and signatures have the same public error. */}
  if(!authenticated)throw new ProxyError(401,'Wallet authentication failed');
}

function registrationStorage(env){
  if(env.UPSTASH_REDIS_REST_URL||env.UPSTASH_REDIS_REST_TOKEN)
    return {url:env.UPSTASH_REDIS_REST_URL,token:env.UPSTASH_REDIS_REST_TOKEN};
  return {url:env.KV_REST_API_URL,token:env.KV_REST_API_READ_ONLY_TOKEN||env.KV_REST_API_TOKEN};
}

function registrationEnabled(env){
  const storage=registrationStorage(env);
  if(env.GETYOURSATS_NATIVE_HANDLES_ENABLED!=='true'||!storage.url||!storage.token)
    throw new ProxyError(503,'Username registration is not available');
}

async function requireVerifiedEmail(pubkey,env,fetchImpl){
  let record;
  try{
    const storage=registrationStorage(env);
    const url=new URL(storage.url);
    if(url.protocol!=='https:'||url.username||url.password)throw new Error();
    const response=await fetchImpl(url.href,{
      method:'POST',headers:{Authorization:'Bearer '+storage.token,'Content-Type':'application/json'},
      body:JSON.stringify(['GET',EMAIL_ROOT+pubkey]),
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7000)
    });
    if(!response.ok)throw new Error();
    const result=await response.json();
    if(result.error||!Object.hasOwn(result,'result'))throw new Error();
    if(result.result===null)throw new ProxyError(403,'Verify email before claiming a username');
    record=JSON.parse(result.result);
    if(!record||typeof record.email!=='string'||!record.email.trim()||
        !Number.isSafeInteger(record.verifiedAt)||record.verifiedAt<=0)throw new Error();
  }catch(error){
    if(error instanceof ProxyError)throw error;
    throw new ProxyError(503,'Account verification unavailable');
  }
}

function forwardedHeaders(req,secret,ip,body){
  const headers={};
  const connection=String(req.headers.connection||'').toLowerCase().split(',').map(value=>value.trim());
  for(const [name,value] of Object.entries(req.headers)){
    const key=name.toLowerCase();
    if(value===undefined||HOP_HEADERS.has(key)||connection.includes(key)||
        ['host','content-length','cookie',SECRET_HEADER,'forwarded','x-real-ip','x-original-url','x-rewrite-url','x-matched-path','x-now-route-matches'].includes(key)||
        key.startsWith('x-forwarded-')||key.startsWith('x-vercel-')||
        key.startsWith('x-http-method')||key==='x-method-override')continue;
    headers[key]=value;
  }
  headers.host=DOMAIN;
  headers[SECRET_HEADER]=secret;
  headers['x-forwarded-for']=ip;
  // Identity encoding keeps the response inspectable and usable by every client.
  headers['accept-encoding']='identity';
  if(body.length||req.headers['content-length']!==undefined||req.headers['transfer-encoding']!==undefined)
    headers['content-length']=String(body.length);
  return headers;
}

function forward(req,body,headers,requestImpl,timeout=15000){
  return new Promise((resolve,reject)=>{
    const request=requestImpl({
      protocol:'https:',hostname:'breez.tips',port:443,servername:'breez.tips',
      method:req.method,path:req.url,headers,rejectUnauthorized:true,
      signal:AbortSignal.timeout(timeout)
    },response=>{
      const chunks=[];
      let size=0;
      response.on('data',chunk=>{
        size+=chunk.length;
        if(size>MAX_RESPONSE_BYTES){
          response.destroy();reject(new ProxyError(502,'LNURL response too large'));return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks,size)}));
      response.on('error',()=>reject(new ProxyError(502,'LNURL service unavailable')));
      response.on('aborted',()=>reject(new ProxyError(502,'LNURL service unavailable')));
    });
    request.on('error',()=>reject(new ProxyError(502,'LNURL service unavailable')));
    request.end(body);
  });
}

function responseContainsSecret(upstream,secret){
  if(!upstream.body.length)return false;
  let decoded=upstream.body;
  const encodings=String(upstream.headers['content-encoding']||'identity').toLowerCase().split(',').reverse();
  for(const encoding of encodings){
    const name=encoding.trim();
    const decompress=name==='gzip'?gunzipSync:name==='deflate'?inflateSync:name==='br'?brotliDecompressSync:null;
    if(name==='identity')continue;
    if(!decompress)throw new ProxyError(502,'Unsupported LNURL response encoding');
    try{decoded=decompress(decoded,{maxOutputLength:MAX_RESPONSE_BYTES});}
    catch{throw new ProxyError(502,'Invalid LNURL response encoding');}
  }
  return decoded.includes(Buffer.from(secret));
}

export function createBreezLnurlProxy({env=process.env,requestImpl=httpsRequest,fetchImpl=globalThis.fetch,now=Date.now}={}){
  return async function handler(req,res){
    setNoCache(res);
    try{
      // Only the original LNURL path is accepted. A direct /api call cannot supply a target.
      const route=routeFor(req.url);
      if(typeof req.method!=='string'||!METHOD.test(req.method))throw new ProxyError(400,'Invalid method');
      if(configureCors(req,res,route))return;
      if(!route.public&&!route.methods.includes(req.method)){
        res.setHeader('Allow',route.methods.join(', '));
        throw new ProxyError(405,'Method not allowed');
      }
      const secret=env.BREEZ_LNURL_PROXY_SECRET;
      if(typeof secret!=='string'||!secret.length||secret.length>4096||!/^[\x21-\x7e]+$/.test(secret))
        throw new ProxyError(503,'LNURL service is not configured');
      const ip=clientIp(req);
      const directory=createDirectRecipientDirectory({env,fetchImpl,now,lookup:async name=>{
        const request={method:'GET',url:'/.well-known/lnurlp/'+name,headers:{accept:'application/json'}};
        const result=await forward(request,Buffer.alloc(0),forwardedHeaders(request,secret,ip,Buffer.alloc(0)),requestImpl,2500);
        if(result.status!==200||responseContainsSecret(result,secret)||
            !['identity',''].includes(String(result.headers['content-encoding']||'')))throw new Error('Recipient unavailable');
        return JSON.parse(result.body.toString('utf8'));
      }});
      if(route.directName){
        if(req.method!=='GET')throw new ProxyError(405,'Method not allowed');
        let result;
        try{result=await directory.resolve(route.directName);}
        catch{throw new ProxyError(503,'Recipient unavailable');}
        res.setHeader('Content-Type','application/json; charset=utf-8');
        res.end(JSON.stringify(result));
        return;
      }
      const registration=route.operation==='registration'&&req.method==='POST';
      if(registration){
        registrationEnabled(env);
        const contentType=req.headers['content-type'];
        if(typeof contentType!=='string'||contentType.split(';')[0].trim().toLowerCase()!=='application/json'||
            (req.headers['content-encoding']&&req.headers['content-encoding']!=='identity'))
          throw new ProxyError(415,'Unencoded JSON required');
      }
      const body=await readRawBody(req,registration?8192:MAX_BODY_BYTES);
      if(registration){
        registrationPayload(body,route.pubkey,now);
        await requireVerifiedEmail(route.pubkey,env,fetchImpl);
      }
      const upstream=await forward(req,body,forwardedHeaders(req,secret,ip,body),requestImpl);
      if(!Number.isInteger(upstream.status)||upstream.status<200||upstream.status>599||
          (upstream.status>=300&&upstream.status<400)||responseContainsSecret(upstream,secret))
        throw new ProxyError(502,'Unexpected LNURL response');
      // Only Breez's successful authenticated register/recover response establishes ownership.
      // Public LNURL metadata or a client-supplied username never establishes a destination.
      if(upstream.status===200&&req.method==='POST'&&
          ['registration','recover'].includes(route.operation)&&
          ['identity',''].includes(String(upstream.headers['content-encoding']||''))){
        try{await directory.capture(route.pubkey,JSON.parse(upstream.body.toString('utf8')));}
        catch{/* Optional routing must not turn a successful address recovery into a failure. */}
      }
      for(const name of ['content-type','content-encoding','content-language','retry-after','allow']){
        const value=upstream.headers[name];
        if(value!==undefined&&!String(value).includes(secret))res.setHeader(name,value);
      }
      res.statusCode=upstream.status;
      res.end(upstream.body);
    }catch(error){
      respondError(res,error instanceof ProxyError?error.status:502,
        error instanceof ProxyError?error.message:'LNURL service unavailable');
    }
  };
}
