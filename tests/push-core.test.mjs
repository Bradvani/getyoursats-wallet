import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Buffer} from 'node:buffer';
import {
  createECDH, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync,
  sign, verify
} from 'node:crypto';
import {
  walletPubkey, verifyOwnership, pushEndpoint, checkedSubscription,
  verifySparkWebhook, vapidConfig, createVapidToken, sendEmptyWebPush
} from '../server/pushCore.mjs';

test('wallet signature is bound to one notification purpose and signer',()=>{
  const ecdh=createECDH('secp256k1');ecdh.generateKeys();
  const pub=ecdh.getPublicKey('hex','compressed');
  const point=ecdh.getPublicKey(undefined,'uncompressed');
  const key=createPrivateKey({key:{
    kty:'EC',crv:'secp256k1',
    x:point.subarray(1,33).toString('base64url'),
    y:point.subarray(33).toString('base64url'),
    d:ecdh.getPrivateKey().toString('base64url'),
  },format:'jwk'});
  const nonce='ab'.repeat(16);
  const message='gys-push-v1:subscribe:'+pub+':'+nonce;
  const signature=sign('sha256',Buffer.from(message),{key,dsaEncoding:'ieee-p1363'}).toString('hex');
  assert.equal(walletPubkey(pub.toUpperCase()),pub);
  assert.equal(verifyOwnership(message,pub,signature),true);
  assert.equal(verifyOwnership(message.replace('subscribe','unsubscribe'),pub,signature),false);
  assert.equal(verifyOwnership(message,pub,'00'.repeat(64)),false);
  assert.equal(verifyOwnership('gys-email-v1:subscribe:'+pub+':'+nonce,pub,signature),false);
});
test('push subscriptions reject untrusted destinations and unsupported key material',()=>{
  for(const bad of [
    'https://push.apple.com.evil.test/test',
    'https://127.0.0.1/push',
    'http://web.push.apple.com/push',
    'https://user@web.push.apple.com/token',
    'https://web.push.apple.com:8443/token',
    'https://web.push.apple.com/token#frag',
  ])assert.throws(()=>pushEndpoint(bad));
  const destination='https://web.push.apple.com/Qf7Q4i1ZeN';
  assert.equal(pushEndpoint(destination),destination);
  const valid={endpoint:destination,keys:{
    p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),
    auth:Buffer.alloc(16,2).toString('base64url')
  }};
  assert.deepEqual(checkedSubscription(valid),valid);
  assert.throws(()=>checkedSubscription({...valid,keys:{...valid.keys,auth:'invalid'}}));
});
test('Spark webhook authenticates exact raw bytes and successful mainnet inbound completion',()=>{
  const pub='02'+'45'.repeat(32),secret='f'.repeat(64);
  const evt={id:'018677b5-e419-99d1-0000-a7030393c9af',
    created_at:new Date().toISOString(),timestamp:new Date().toISOString(),
    type:'SPARK_LIGHTNING_RECEIVE_FINISHED',network:'MAINNET',
    request_status:'COMPLETED',status:'TRANSFER_COMPLETED',
    receiver_identity_public_key:pub,payment_preimage:'should-not-leak'};
  const raw=Buffer.from(JSON.stringify(evt));
  const hmac=(bytes)=>createHmac('sha256',secret).update(bytes).digest('hex');
  const value=verifySparkWebhook(raw,pub,secret,hmac(raw));
  assert.equal(value.ok,true);assert.equal(value.notify,true);assert.equal(value.id,evt.id);
  assert.equal(verifySparkWebhook(Buffer.from(JSON.stringify({...evt,network:'SIGNET'})),pub,secret,hmac(raw)).ok,false);
  const signet=Buffer.from(JSON.stringify({...evt,network:'SIGNET'}));
  assert.equal(verifySparkWebhook(signet,pub,secret,hmac(signet)).ok,false);
  const pending=Buffer.from(JSON.stringify({...evt,status:'HTLC_RECEIVED'}));
  assert.equal(verifySparkWebhook(pending,pub,secret,hmac(pending)).notify,false);
  const outgoing=Buffer.from(JSON.stringify({...evt,type:'SPARK_LIGHTNING_SEND_FINISHED'}));
  assert.equal(verifySparkWebhook(outgoing,pub,secret,hmac(outgoing)).notify,false);
  const other=Buffer.from(JSON.stringify({...evt,receiver_identity_public_key:'03'+'11'.repeat(32)}));
  assert.equal(verifySparkWebhook(other,pub,secret,hmac(other)).ok,false);
});
test('VAPID signing uses restricted push-service audience and correct P-256 JWT',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const pub=publicKey.export({format:'jwk'}),priv=privateKey.export({format:'jwk'});
  const publicVapid=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),
    Buffer.from(pub.y,'base64url')]).toString('base64url');
  const config=vapidConfig({GYS_PUSH_VAPID_PUBLIC_KEY:publicVapid,
    GYS_PUSH_VAPID_PRIVATE_KEY:priv.d,GYS_PUSH_VAPID_SUBJECT:'mailto:support@getyoursats.com'});
  const endpoint='https://fcm.googleapis.com/fcm/send/test-token-001';
  const header=createVapidToken(endpoint,config);
  const match=/^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert(match);assert.equal(match[2],publicVapid);
  const parts=match[1].split('.');
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
  assert.equal(claims.aud,'https://fcm.googleapis.com');
  assert.equal(claims.sub,'mailto:support@getyoursats.com');
  assert(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),
    {key:createPublicKey(config.key),dsaEncoding:'ieee-p1363'},
    Buffer.from(parts[2],'base64url')));
  let calls=0;
  const result=await sendEmptyWebPush(endpoint,config,async(url,options)=>{
    calls++;assert.equal(url,endpoint);
    assert.equal(options.method,'POST');assert.equal(options.headers.TTL,'90');
    assert.equal(options.body,undefined);return {ok:true,status:201};
  });
  assert.equal(result.delivered,true);assert.equal(calls,1);
});
