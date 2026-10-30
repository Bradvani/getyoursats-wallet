import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createECDH,createPrivateKey,generateKeyPairSync,sign,createHmac} from 'node:crypto';
import {startRedis} from './helpers/disposable-redis.mjs';
import device from '../api/notifications/device.js';
import {POST as lnurl} from '../api/notifications/lnurl.js';
import {saveSubscription,activateSubscription,ensureWallet,getWallet,getSubscription,
  removeSubscription,endpointKey,subKey,walletKey,subscriptionId,receiptKey} from '../server/pushStore.mjs';

const origin='https://wallet.getyoursats.com';
const secret='test-only-domain-secret-'.repeat(3);
function identity(){
  const ecdh=createECDH('secp256k1');ecdh.generateKeys();
  const point=ecdh.getPublicKey(undefined,'uncompressed');
  const key=createPrivateKey({key:{kty:'EC',crv:'secp256k1',
    x:point.subarray(1,33).toString('base64url'),y:point.subarray(33).toString('base64url'),
    d:ecdh.getPrivateKey().toString('base64url')},format:'jwk'});
  return {pub:ecdh.getPublicKey('hex','compressed'),
    sign:message=>sign('sha256',Buffer.from(message),{key,dsaEncoding:'ieee-p1363'}).toString('hex')};
}
function subscription(id){return {endpoint:'https://web.push.apple.com/test-device-'+id,keys:{
  p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url'),
}};}
async function invoke(body,method='POST'){
  const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};
  await device({method,headers:{origin,'content-type':'application/json','x-vercel-forwarded-for':'192.0.2.1'},body},res);
  return res;
}

test('notification enrollment and retry isolation against real disposable Redis',async t=>{
  const redis=await startRedis(t);
  const before={...process.env},oldFetch=globalThis.fetch;
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const pub=publicKey.export({format:'jwk'});
  Object.assign(process.env,{GYS_PUSH_ENABLED:'true',GYS_BREEZ_LNURL_PUSH_ENABLED:'true',
    GYS_BREEZ_LNURL_WEBHOOK_SECRET:secret,KV_REST_API_URL:'https://push-disposable.invalid/',KV_REST_API_TOKEN:'test-only',
    GYS_PUSH_VAPID_PRIVATE_KEY:privateKey.export({format:'jwk'}).d,
    GYS_PUSH_VAPID_PUBLIC_KEY:Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url'),
  });
  let failEndpoint=null;
  const sent=[];
  globalThis.fetch=async(url,options)=>{
    if(String(url)==='https://push-disposable.invalid/')return Response.json({result:await redis(...JSON.parse(options.body))});
    if(String(url).startsWith('https://web.push.apple.com/test-device-')){
      assert.equal(options.body,undefined);sent.push(String(url));
      return new Response(null,{status:url===failEndpoint?503:201});
    }
    throw new Error('No external network is allowed in notification acceptance');
  };
  t.after(()=>{
    globalThis.fetch=oldFetch;
    for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];
    Object.assign(process.env,before);
  });
  const a=identity(),b=identity();
  async function authorized(who,action,extra,mutate={}){
    const challenge=await invoke({...extra,action:'challenge',purpose:action,walletPubkey:who.pub});
    assert.equal(challenge.statusCode,200);
    const body={...extra,action,walletPubkey:who.pub,challengeId:challenge.body.challengeId,
      signature:who.sign(challenge.body.message),...mutate};
    return {body,res:await invoke(body)};
  }
  async function receive(hash='ab'.repeat(32)){
    const raw=JSON.stringify({template:'spark_payment_received',data:{user_pubkey:a.pub,
      lightning_address:null,payment_hash:hash,timestamp:Date.now()}});
    return lnurl(new Request(origin+'/api/notifications/lnurl',{method:'POST',body:raw,
      headers:{'x-breez-signature':createHmac('sha256',secret).update(raw).digest('hex')}}));
  }
  await t.test('configuration reports domain availability without exposing its secret',async()=>{
    const res=await invoke(null,'GET');assert.equal(res.body.lightningAddressPushAvailable,true);
    assert(!JSON.stringify(res.body).includes(secret));
    delete process.env.GYS_BREEZ_LNURL_WEBHOOK_SECRET;
    assert.equal((await invoke(null,'GET')).body.lightningAddressPushAvailable,false);
    process.env.GYS_BREEZ_LNURL_WEBHOOK_SECRET=secret;
  });
  await t.test('a signed challenge cannot be retargeted or replayed',async()=>{
    const first=subscription('first'),other=subscription('other');
    const swapped=await authorized(a,'subscribe',{subscription:first},{subscription:other});
    assert.equal(swapped.res.statusCode,401);
    assert.equal(await getSubscription(a.pub,other.endpoint),null);
    const valid=await authorized(a,'subscribe',{subscription:first});assert.equal(valid.res.statusCode,200);
    assert.equal((await invoke(valid.body)).statusCode,409);
  });
  await t.test('Breez address alerts activate without asserting a Spark registration',async()=>{
    const first=subscription('first');
    const result=await authorized(a,'activate',{endpoint:first.endpoint,webhookId:''});
    assert.equal(result.res.statusCode,200);assert.equal(result.res.body.webhookRegistered,false);
    assert.equal((await getWallet(a.pub)).registered,false);
    assert.equal((await getSubscription(a.pub,first.endpoint)).active,true);
    assert((await redis('TTL',subKey(a.pub)))>0);assert((await redis('TTL',walletKey(a.pub)))>0);
    const status=await authorized(a,'status',{endpoint:first.endpoint});assert.equal(status.res.body.enabled,true);
  });
  await t.test('partial fanout retries do not alert a successful device again',async()=>{
    const second=subscription('second');await saveSubscription(a.pub,second);await activateSubscription(a.pub,second.endpoint,'');
    sent.length=0;failEndpoint=second.endpoint;
    assert.equal((await receive()).status,503);
    assert.equal(sent.filter(x=>x===subscription('first').endpoint).length,1);
    failEndpoint=null;
    assert.equal((await receive()).status,200);
    assert.equal((await receive()).status,200);
    assert.equal(sent.filter(x=>x===subscription('first').endpoint).length,1);
    assert.equal(sent.filter(x=>x===second.endpoint).length,2);
    assert.equal(await redis('GET',receiptKey(a.pub,'lightning:'+'ab'.repeat(32))),'delivered');
  });
  await t.test('device-cap rejection cannot remove the previous wallet subscription',async()=>{
    await ensureWallet(b.pub);
    for(let i=0;i<5;i++)await saveSubscription(b.pub,subscription('b-'+i));
    const first=subscription('first');
    await assert.rejects(saveSubscription(b.pub,first),{status:409});
    assert.equal(await redis('GET',endpointKey(first.endpoint)),a.pub);
    assert.equal((await getSubscription(a.pub,first.endpoint)).active,true);
  });
  await t.test('opt-out and wallet changes stop subsequent sends to the old device',async()=>{
    const first=subscription('first'),second=subscription('second');
    await removeSubscription(a.pub,first.endpoint);
    await removeSubscription(b.pub,subscription('b-0').endpoint);
    await saveSubscription(b.pub,second);await activateSubscription(b.pub,second.endpoint,'');
    sent.length=0;assert.equal((await receive('cd'.repeat(32))).status,200);assert.deepEqual(sent,[]);
    assert.equal(await getSubscription(a.pub,second.endpoint),null);
    assert.equal(await redis('GET',endpointKey(second.endpoint)),b.pub);
  });
  await t.test('activation cannot resurrect a subscription revoked during its update',async()=>{
    const target=subscription('race');await saveSubscription(a.pub,target);
    const inner=globalThis.fetch;
    globalThis.fetch=async(url,options)=>{
      const cmd=String(url)==='https://push-disposable.invalid/'?JSON.parse(options.body):[];
      if(cmd[0]==='EVAL'&&cmd[1].includes("local wallet=cjson.decode"))
        await redis('HDEL',subKey(a.pub),subscriptionId(target.endpoint));
      return inner(url,options);
    };
    try{await assert.rejects(activateSubscription(a.pub,target.endpoint,''),{status:409});}
    finally{globalThis.fetch=inner;}
    assert.equal(await getSubscription(a.pub,target.endpoint),null);
  });
});
