import {createHash,ECDH} from 'node:crypto';
import {bech32,bech32m} from '@scure/base';

const DOMAIN='getyoursats.com';
const ROOT='gys:direct:v1:';
const TTL=30*24*60*60;
const NAME=/^[a-z][a-z0-9]{2,23}$/;
const KEY=/^(02|03)[0-9a-f]{64}$/;

// Different authenticated owners never silently replace an existing destination.
// A conflicting name stays unavailable until an operator reviews its history.
const SAVE=`local old=redis.call('GET',KEYS[1])
if old then
  local previous=cjson.decode(old)
  if previous.blocked or previous.identityPublicKey~=ARGV[1] then
    redis.call('SET',KEYS[1],'{"blocked":true}')
    return 0
  end
end
redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3])
return 1`;

function storage(env){
  return env.UPSTASH_REDIS_REST_URL
    ? {url:env.UPSTASH_REDIS_REST_URL,token:env.UPSTASH_REDIS_REST_TOKEN}
    : {url:env.KV_REST_API_URL,token:env.KV_REST_API_TOKEN};
}

async function command(env,fetchImpl,args){
  const {url,token}=storage(env);
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password||!token)throw new Error('Directory unavailable');
  const response=await fetchImpl(target.href,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(args),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(2500)
  });
  if(!response.ok)throw new Error('Directory unavailable');
  const result=await response.json();
  if(result.error||!Object.hasOwn(result,'result'))throw new Error('Directory unavailable');
  return result.result;
}

export function sparkAddressForIdentity(pubkey){
  if(!KEY.test(pubkey))throw new Error('Invalid identity');
  ECDH.convertKey(pubkey,'secp256k1','hex','hex','compressed');
  // Spark's simple address is protobuf field 1 (33-byte compressed identity), bech32m.
  return bech32m.encode('spark',bech32m.toWords(Buffer.from('0a21'+pubkey,'hex')));
}

function nativeName(result){
  const address=result?.lightning_address;
  if(typeof address!=='string')return null;
  const [name,domain,...extra]=address.split('@');
  if(extra.length||domain!==DOMAIN||!NAME.test(name)||
      (result.username!==undefined&&result.username!==name))return null;
  // The SDK accepts both native endpoint paths and decodes bech32 LNURLs.
  // Check the decoded destination, not one provider serialization of it.
  let lnurl=result.lnurl;
  if(typeof lnurl!=='string'||lnurl.length>2048)return null;
  try{
    if(/^lnurl1/i.test(lnurl)){
      const decoded=bech32.decode(lnurl,2048);
      if(decoded.prefix!=='lnurl')return null;
      lnurl=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bech32.fromWords(decoded.words)));
    }
  }catch{return null;}
  const allowed=['https','lnurlp'].flatMap(scheme=>[
    `${scheme}://${DOMAIN}/lnurlp/${name}`,
    `${scheme}://${DOMAIN}/.well-known/lnurlp/${name}`
  ]);
  if(!allowed.includes(lnurl))return null;
  return name;
}

function fingerprint(name,lookup){
  if(lookup?.tag!=='payRequest'||lookup.callback!==`https://${DOMAIN}/lnurlp/${name}/invoice`||
      lookup.allowsNostr!==true||typeof lookup.nostrPubkey!=='string'||
      !/^[0-9a-f]{64}$/.test(lookup.nostrPubkey))throw new Error('Recipient unavailable');
  const metadata=JSON.parse(lookup.metadata);
  if(!Array.isArray(metadata)||!metadata.some(entry=>Array.isArray(entry)&&
      entry[0]==='text/identifier'&&entry[1]===`${name}@${DOMAIN}`))throw new Error('Recipient unavailable');
  // This is an opaque provider owner fingerprint, NOT the Spark identity key.
  return lookup.nostrPubkey;
}

export function createDirectRecipientDirectory({env,fetchImpl,lookup,now=Date.now}){
  const enabled=()=>env.GETYOURSATS_DIRECT_PAYMENTS_ENABLED==='true';
  return {
    async capture(pubkey,result){
      if(!enabled())return 'disabled';
      const name=nativeName(result);
      if(!name)return 'invalid_address';
      sparkAddressForIdentity(pubkey);
      const ownerFingerprint=fingerprint(name,await lookup(name));
      const record={identityPublicKey:pubkey,ownerFingerprint};
      const saved=await command(env,fetchImpl,['EVAL',SAVE,1,ROOT+name,pubkey,JSON.stringify(record),TTL]);
      return saved===1?'registered':'conflict';
    },
    async resolve(name){
      if(!enabled()||!NAME.test(name))return {available:false};
      const raw=await command(env,fetchImpl,['GET',ROOT+name]);
      if(!raw)return {available:false,reason:'not_activated'};
      const record=JSON.parse(raw);
      if(record.blocked)return {available:false,reason:'owner_conflict'};
      const sparkAddress=sparkAddressForIdentity(record.identityPublicKey);
      const ownerFingerprint=fingerprint(name,await lookup(name));
      if(ownerFingerprint!==record.ownerFingerprint)return {available:false,reason:'owner_changed'};
      const bindingId=createHash('sha256').update([name,record.identityPublicKey,ownerFingerprint].join('\n')).digest('hex');
      return {available:true,lightningAddress:`${name}@${DOMAIN}`,identityPublicKey:record.identityPublicKey,
        sparkAddress,bindingId,expiresAt:now()+60_000};
    }
  };
}
