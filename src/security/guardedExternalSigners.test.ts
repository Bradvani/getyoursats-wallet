import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {ExternalSigners} from '@breeztech/breez-sdk-spark';
import {guardExternalSigners} from './guardedExternalSigners';
import {rememberSignerIdentity,lockSpendingSession,clearSignerIdentity,unlockSpendingSession} from './spendApproval';
const seed={type:'mnemonic' as const,mnemonic:'disposable-test-identity'};
function fixtures(){
 const breez={free:vi.fn(),signHashSchnorr:vi.fn(async()=>({bytes:[1]}))};
 const spark={free:vi.fn(),isRemote:()=>false,prepareTransfer:vi.fn(async()=>({signed:true})),signFrost:vi.fn(async()=>[])};
 const container={breezSigner:breez,sparkSigner:spark,free:vi.fn()};
 return {breez,spark,container,guard:guardExternalSigners(container as unknown as ExternalSigners)};
}
beforeEach(async()=>{await rememberSignerIdentity(seed)});
afterEach(()=>clearSignerIdentity());
describe('external signer session veto',()=>{
 it('allows software signing while current and rejects every future callback after lock',async()=>{
  const f=fixtures();await f.guard.breezSigner.signHashSchnorr(new Uint8Array([2]),'m/1');
  expect(f.breez.signHashSchnorr).toHaveBeenCalledOnce();
  lockSpendingSession();
  await expect(f.guard.sparkSigner.prepareTransfer({} as never)).rejects.toThrow(/locked/);
  await expect(f.guard.sparkSigner.signFrost([])).rejects.toThrow(/locked/);
  expect(f.spark.prepareTransfer).not.toHaveBeenCalled();expect(f.spark.signFrost).not.toHaveBeenCalled();
  await f.guard.dispose();
 });
 it('never revives an old signing context when the same wallet is unlocked',async()=>{
  const f=fixtures();lockSpendingSession();await unlockSpendingSession(seed);
  await expect(f.guard.breezSigner.signHashSchnorr(new Uint8Array([2]),'m/1')).rejects.toThrow(/locked/);
  expect(f.breez.signHashSchnorr).not.toHaveBeenCalled();await f.guard.dispose();
 });
 it('withholds a signature that completes after backgrounding, then releases handles',async()=>{
  const f=fixtures();let resolve!:(value:{bytes:number[]})=>void;
  f.breez.signHashSchnorr.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
  const signing=f.guard.breezSigner.signHashSchnorr(new Uint8Array([2]),'m/1');
  const rejected=expect(signing).rejects.toThrow(/locked/);
  lockSpendingSession();const disposing=f.guard.dispose();
  expect(f.breez.free).not.toHaveBeenCalled();resolve({bytes:[3]});await rejected;await disposing;
  expect(f.breez.free).toHaveBeenCalledOnce();expect(f.spark.free).toHaveBeenCalledOnce();expect(f.container.free).toHaveBeenCalledOnce();
 });
 it('rejects a callback after a different wallet identity replaces the signer',async()=>{
  const f=fixtures();await rememberSignerIdentity({...seed,mnemonic:'different-disposable-identity'});
  await expect(f.guard.sparkSigner.prepareTransfer({} as never)).rejects.toThrow(/locked|replaced/);
  expect(f.spark.prepareTransfer).not.toHaveBeenCalled();await f.guard.dispose();
 });
});
