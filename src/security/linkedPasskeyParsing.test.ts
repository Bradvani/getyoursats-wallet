import {describe,it,expect} from 'vitest';
import {p256Signature,isLinkedUserHandle,LINKED_USER_PREFIX,source,unb64,b64} from './linkedPasskeyProtocol';
import {toDer} from '../test/linkedPasskeyAuthenticator';
describe('linked-passkey signature and identifier parsing',()=>{
 it('roundtrips actual Web Crypto signatures through strict DER parsing',async()=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']) as CryptoKeyPair;
  const data=new Uint8Array([1,2,3]);
  for(let i=0;i<8;i++){
   const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,data);
   const converted=p256Signature(toDer(signature));
   expect(Array.from(converted)).toEqual(Array.from(new Uint8Array(signature)));
   expect(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,source(converted),data)).toBe(true);
  }
 });
 it.each([
  {bytes:[48,6,2,1,128,2,1,1]}, {bytes:[48,7,2,2,0,1,2,1,1]},
  {bytes:[48,6,2,1,1,2,1,1,0]}, {bytes:[49,6,2,1,1,2,1,1]},
 ])('refuses invalid signature structure $bytes',({bytes})=>expect(()=>p256Signature(new Uint8Array(bytes).buffer)).toThrow());
 it('rejects noncanonical or wrongly sized base64url fields',()=>{
  for(const text of ['abc=','++','a','not valid',''])expect(()=>unb64(text,32,32)).toThrow();
  expect(unb64(b64(new Uint8Array(32)),32,32)).toEqual(new Uint8Array(32));
 });
 it('identifies the explicit protection-credential purpose marker',()=>{
  const id=new Uint8Array(LINKED_USER_PREFIX.length+32);id.set(LINKED_USER_PREFIX);
  expect(isLinkedUserHandle(source(id))).toBe(true);id[0]^=1;
  expect(isLinkedUserHandle(source(id))).toBe(false);expect(isLinkedUserHandle(null)).toBe(false);
 });
});
