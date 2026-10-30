import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Buffer} from 'node:buffer';
import {createHash,createHmac,generateKeyPairSync} from 'node:crypto';
import {POST as sparkHandler} from '../api/notifications/spark.js';
import {POST as lnurlHandler} from '../api/notifications/lnurl.js';

const wallet='02'+'45'.repeat(32);
const secret='s'.repeat(64);
const lnurlSecret='l'.repeat(64);
const endpoint='https://web.push.apple.com/test-device-webpush-id-123456';
function setup(endpointOwner=wallet){
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const priv=privateKey.export({format:'jwk'});
  const pub=publicKey.export({format:'jwk'});
  const vapidPublic=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),
    Buffer.from(pub.y,'base64url')]).toString('base64url');
  const before={...process.env};
  Object.assign(process.env,{
    GYS_PUSH_ENABLED:'true',GYS_BREEZ_LNURL_PUSH_ENABLED:'true',
    GYS_BREEZ_LNURL_WEBHOOK_SECRET:lnurlSecret,
    GYS_PUSH_VAPID_PUBLIC_KEY:vapidPublic,
    GYS_PUSH_VAPID_PRIVATE_KEY:priv.d,
    GYS_PUSH_VAPID_SUBJECT:'mailto:support@getyoursats.com',
    KV_REST_API_URL:'https://unit-test-redis.invalid',
    KV_REST_API_TOKEN:'test-redis-secret',
  });
  const savedFetch=globalThis.fetch;
  const table=new Map();
  const subscriptions={};
  const deviceId=createHash('sha256').update(endpoint).digest('hex');
  subscriptions[deviceId]=JSON.stringify({active:true,
    enabledAt:Date.now()-60000,endpoint});
  table.set('gys:notify:v1:endpoint:'+deviceId,endpointOwner);
  table.set('gys:notify:v1:wallet:'+wallet,JSON.stringify({
    secret,registered:true,webhookId:'provider-wh-id-123'
  }));
  let count=0;
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes('unit-test-redis.invalid')){
      const [command,...args]=JSON.parse(options.body);
      let value=null;
      if(command==='GET')value=table.get(args[0])??null;
      else if(command==='HGETALL')value=subscriptions;
      else if(command==='HGET')value=subscriptions[args[1]]??null;
      else if(command==='SET'){
        const [key,v,...rest]=args;
        if(rest.includes('NX')&&table.has(key))value=null;
        else {table.set(key,v);value='OK';}
      }else if(command==='EVAL'){
        const [script,,key,nonce]=args;
        if(table.get(key)!==nonce)value=0;
        else if(script.includes("'delivered'")){table.set(key,'delivered');value=1;}
        else {table.delete(key);value=1;}
      }
      else if(command==='HDEL')value=1;
      else throw new Error('Unexpected Redis command: '+command);
      return Response.json({result:value});
    }
    if(String(url)===endpoint){
      assert.equal(options.method,'POST');
      assert.equal(options.body,undefined);
      assert.match(options.headers.Authorization,/^vapid /);
      count++;
      return new Response(null,{status:201});
    }
    throw new Error('Unexpected network access');
  };
  return {
    get pushes(){return count;},
    restore(){
      globalThis.fetch=savedFetch;
      for(const key of Object.keys(process.env)){
        if(!(key in before))delete process.env[key];
      }
      for(const [k,v] of Object.entries(before))process.env[k]=v;
    }
  };
}
function signed(body,signatureKey){
  const text=JSON.stringify(body);
  return {text,hmac:createHmac('sha256',signatureKey).update(text).digest('hex')};
}
const sparkEvent=()=>({
  id:'018677b5-e419-99d1-0000-a7030393c9af',
  created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
  timestamp:new Date().toISOString(),
  network:'MAINNET',request_status:'SUCCEEDED',status:'TRANSFER_COMPLETED',
  type:'SPARK_LIGHTNING_RECEIVE_FINISHED',
  receiver_identity_public_key:wallet,
  invoice_amount:{value:5000,unit:'SATOSHI'}, payment_preimage:'11'.repeat(32),
});
test('signed, completed Spark receive sends once, replay stays idempotent',async()=>{
  const ctx=setup();
  try{
    const event=signed(sparkEvent(),secret);
    const request=()=>new Request('https://wallet.getyoursats.com/api/notifications/spark?wallet='+wallet,{
      method:'POST',headers:{'content-type':'application/json','x-spark-signature':event.hmac},
      body:event.text,
    });
    assert.equal((await sparkHandler(request())).status,200);
    assert.equal((await sparkHandler(request())).status,200);
    assert.equal(ctx.pushes,1);
    const wrong=new Request('https://wallet.getyoursats.com/api/notifications/spark?wallet='+wallet,{
      method:'POST',headers:{'x-spark-signature':'0'.repeat(64)},body:event.text,
    });
    assert.equal((await sparkHandler(wrong)).status,401);
    assert.equal(ctx.pushes,1);
  }finally{ctx.restore();}
});
test('signed but pending Lightning receive is not pushed',async()=>{
  const ctx=setup();
  try{
    const payload=signed({...sparkEvent(),request_status:'PENDING'},secret);
    const req=new Request('https://wallet.getyoursats.com/api/notifications/spark?wallet='+wallet,{
      method:'POST',headers:{'x-spark-signature':payload.hmac},body:payload.text,
    });
    assert.equal((await sparkHandler(req)).status,200);
    assert.equal(ctx.pushes,0);
  }finally{ctx.restore();}
});
test('configured LNURL webhook confirms branded Lightning Address once',async()=>{
  const ctx=setup();
  try{
    const event=signed({template:'spark_payment_received',data:{
      payment_hash:'a'.repeat(64),user_pubkey:wallet,
      lightning_address:'alice@getyoursats.com',timestamp:Date.now(),
      preimage:'not-for-push'
    }},lnurlSecret);
    const req=()=>new Request('https://wallet.getyoursats.com/api/notifications/lnurl',{
      method:'POST',headers:{'x-breez-signature':event.hmac},body:event.text,
    });
    assert.equal((await lnurlHandler(req())).status,200);
    assert.equal((await lnurlHandler(req())).status,200);
    assert.equal(ctx.pushes,1);
  }finally{ctx.restore();}
});

test('the same payment delivered by Spark and Breez LNURL generates only one alert',async()=>{
  const ctx=setup();
  try{
    const spark=signed(sparkEvent(),secret);
    const sparkRequest=new Request('https://wallet.getyoursats.com/api/notifications/spark?wallet='+wallet,{
      method:'POST',headers:{'x-spark-signature':spark.hmac},body:spark.text,
    });
    assert.equal((await sparkHandler(sparkRequest)).status,200);
    const hash=createHash('sha256').update(Buffer.from('11'.repeat(32),'hex')).digest('hex');
    const data=signed({template:'spark_payment_received',data:{
      payment_hash:hash,user_pubkey:wallet,lightning_address:'alice@getyoursats.com',
      timestamp:Date.now(),amount_sat:5000,
    }},lnurlSecret);
    const lnurlRequest=new Request('https://wallet.getyoursats.com/api/notifications/lnurl',{
      method:'POST',headers:{'x-breez-signature':data.hmac},body:data.text,
    });
    assert.equal((await lnurlHandler(lnurlRequest)).status,200);
    assert.equal(ctx.pushes,1);
  }finally{ctx.restore();}
});

test('moving a push endpoint to another wallet blocks the old wallet callback',async()=>{
  const ctx=setup('03'+'22'.repeat(32));
  try{
    const event=signed(sparkEvent(),secret);
    const request=new Request('https://wallet.getyoursats.com/api/notifications/spark?wallet='+wallet,{
      method:'POST',headers:{'x-spark-signature':event.hmac},body:event.text,
    });
    assert.equal((await sparkHandler(request)).status,200);
    assert.equal(ctx.pushes,0);
  }finally{ctx.restore();}
});

test('Breez nullable address is authenticated by its domain secret and receiver key',async()=>{
  const ctx=setup();
  try{
    const event=signed({template:'spark_payment_received',data:{
      payment_hash:'b'.repeat(64),user_pubkey:wallet,lightning_address:null,timestamp:Date.now(),
    }},lnurlSecret);
    const response=await lnurlHandler(new Request('https://wallet.getyoursats.com/api/notifications/lnurl',{
      method:'POST',headers:{'x-breez-signature':event.hmac},body:event.text,
    }));
    assert.equal(response.status,200);assert.equal(ctx.pushes,1);
  }finally{ctx.restore();}
});

test('Breez rejects invalid signatures, raw-byte changes and malformed signed events without pushing',async()=>{
  const ctx=setup();
  const data={payment_hash:'c'.repeat(64),user_pubkey:wallet,
    lightning_address:'alice@getyoursats.com',timestamp:Date.now()};
  const invoke=(body,signature,headers={})=>lnurlHandler(new Request('https://wallet.getyoursats.com/api/notifications/lnurl',{
    method:'POST',headers:{...headers,...(signature?{'x-breez-signature':signature}:{})},body,
  }));
  try{
    const original=signed({template:'spark_payment_received',data},lnurlSecret);
    for(const signature of [undefined,'f'.repeat(64),'f'.repeat(63),'z'.repeat(64)])
      assert.equal((await invoke(original.text,signature)).status,401);
    assert.equal((await invoke(original.text+' ',original.hmac)).status,401);
    for(const patch of [{lightning_address:'alice@breez.tips'}, {lightning_address:'a@getyoursats.com.evil.test'},
      {lightning_address:undefined},{user_pubkey:'bad'},{payment_hash:'bad'},
      {timestamp:Date.now()+301_000},{timestamp:Date.now()-8*86400_000}]){
      const event=signed({template:'spark_payment_received',data:{...data,...patch}},lnurlSecret);
      assert.equal((await invoke(event.text,event.hmac)).status,400);
    }
    for(const bytes of [Buffer.from('{'),Buffer.from([0xff,0xfe])]){
      const hmac=createHmac('sha256',lnurlSecret).update(bytes).digest('hex');
      assert.equal((await invoke(bytes,hmac)).status,400);
    }
    assert.equal((await invoke('x'.repeat(16385),'f'.repeat(64))).status,413);
    assert.equal((await invoke(original.text,original.hmac,{'content-length':'999999'})).status,413);
    assert.equal(ctx.pushes,0);
  }finally{ctx.restore();}
});

test('Breez disabled or unprovisioned endpoints fail closed before delivery',async()=>{
  const ctx=setup();
  try{
    const event=signed({template:'spark_payment_received',data:{
      payment_hash:'d'.repeat(64),user_pubkey:wallet,lightning_address:null,timestamp:Date.now(),
    }},lnurlSecret);
    const invoke=()=>lnurlHandler(new Request('https://wallet.getyoursats.com/api/notifications/lnurl',{
      method:'POST',headers:{'x-breez-signature':event.hmac},body:event.text,
    }));
    process.env.GYS_BREEZ_LNURL_PUSH_ENABLED='false';
    assert.equal((await invoke()).status,503);
    process.env.GYS_BREEZ_LNURL_PUSH_ENABLED='true';delete process.env.GYS_BREEZ_LNURL_WEBHOOK_SECRET;
    assert.equal((await invoke()).status,503);assert.equal(ctx.pushes,0);
  }finally{ctx.restore();}
});
