import {afterEach,describe,it,expect,vi} from 'vitest';
import {PasskeyProvider} from '@breeztech/breez-sdk-spark/passkey-prf-provider';
import {WalletPurposePasskeyProvider} from './walletPurposePasskeyProvider';
import {LINKED_USER_PREFIX} from '../security/linkedPasskeyProtocol';
afterEach(()=>vi.restoreAllMocks());
describe('wallet/protection credential purpose boundary',()=>{
 it('requires the pinned installed SDK assertion interface',()=>{
  expect(Reflect.get(PasskeyProvider.prototype,'_performAssertion')).toBeTypeOf('function');
 });
 it('refuses a protection credential before returning it to wallet seed derivation',async()=>{
  const marker=new Uint8Array(LINKED_USER_PREFIX.length+32);marker.set(LINKED_USER_PREFIX);
  const base=PasskeyProvider.prototype as unknown as {_performAssertion:(p:unknown,o:unknown)=>Promise<PublicKeyCredential>};
  vi.spyOn(base,'_performAssertion').mockResolvedValue({response:{userHandle:marker.buffer}} as unknown as PublicKeyCredential);
  const provider=new WalletPurposePasskeyProvider({rpId:'localhost',rpName:'test'});
  await expect(provider._performAssertion({},{})).rejects.toThrow(/protects an imported wallet/);
 });
 it('preserves an ordinary wallet credential without reinterpreting its seed',async()=>{
  const credential={response:{userHandle:new Uint8Array(32).buffer}} as unknown as PublicKeyCredential;
  const base=PasskeyProvider.prototype as unknown as {_performAssertion:(p:unknown,o:unknown)=>Promise<PublicKeyCredential>};
  vi.spyOn(base,'_performAssertion').mockResolvedValue(credential);
  const provider=new WalletPurposePasskeyProvider({rpId:'localhost',rpName:'test'});
  await expect(provider._performAssertion({},{})).resolves.toBe(credential);
 });
});
