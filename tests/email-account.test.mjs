import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,ECDH} from 'node:crypto';
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
 for (const v of ['bad','user@example.com\nBcc:abc','a..b@example.com','x@','']) {
  assert.throws(()=>normalizeEmail(v));
 }
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
