import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {BreezSdk} from '@breeztech/breez-sdk-spark';
import {createOperationGateway} from './operationGateway';
import {clearSignerIdentity,lockSpendingSession,rememberSignerIdentity} from './spendApproval';

const identity='02'+'11'.repeat(32),other='03'+'22'.repeat(32);
const message=(purpose='status',pubkey=identity)=>`gys-email-v1:${purpose}:${pubkey}:${'a'.repeat(36)}`;
const proof=()=>({pubkey:identity,signature:'f'.repeat(128)});
function harness(){
 const raw={getInfo:vi.fn(async()=>({identityPubkey:identity})),signMessage:vi.fn(async()=>proof()),sendPayment:vi.fn()};
 const wallet=createOperationGateway('mainnet').protect(raw as unknown as BreezSdk);
 return {raw,wallet};
}
beforeEach(async()=>{localStorage.clear();await rememberSignerIdentity({type:'mnemonic',mnemonic:'disposable-email-proof-fixture'});});
afterEach(()=>clearSignerIdentity());

describe('email proof capability on the guarded wallet',()=>{
 it.each(['send','status'])('signs only the active wallet scoped %s challenge',async purpose=>{
  const {raw,wallet}=harness();
  await expect(wallet.signMessage({message:message(purpose),compact:true})).resolves.toEqual(proof());
  expect(raw.signMessage).toHaveBeenCalledExactlyOnceWith({message:message(purpose),compact:true});
  expect(raw.sendPayment).not.toHaveBeenCalled();
 });
 it.each([
  {message:'arbitrary bytes',compact:true},
  {message:'gys-native-lnurl-session-v1',compact:true},
  {message:message('withdraw'),compact:true},
  {message:message(),compact:false},
  {message:message()+'\nextra-scope',compact:true},
 ])('rejects unrelated or malformed signatures %# before calling the signer',async request=>{
  const {raw,wallet}=harness();
  await expect(wallet.signMessage(request)).rejects.toThrow(/scoped email/);
  expect(raw.signMessage).not.toHaveBeenCalled();
 });
 it('rejects a challenge for another identity',async()=>{
  const {raw,wallet}=harness();
  await expect(wallet.signMessage({message:message('status',other),compact:true})).rejects.toThrow(/different wallet/);
  expect(raw.signMessage).not.toHaveBeenCalled();
 });
 it('does not sign after backgrounding interrupts identity lookup',async()=>{
  const {raw,wallet}=harness();
  const task=wallet.signMessage({message:message(),compact:true});
  lockSpendingSession('Wallet backgrounded');
  await expect(task).rejects.toThrow(/locked|session changed/);
  expect(raw.signMessage).not.toHaveBeenCalled();
 });
 it('does not return a proof produced after its session was revoked',async()=>{
  const {raw,wallet}=harness();
  raw.signMessage.mockImplementation(async()=>{lockSpendingSession('Wallet changed');return proof();});
  await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/locked|session changed/);
 });
 it('rejects an SDK proof with a different public identity',async()=>{
  const {raw,wallet}=harness();
  raw.signMessage.mockResolvedValue({...proof(),pubkey:other});
  await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/different wallet/);
 });
});
