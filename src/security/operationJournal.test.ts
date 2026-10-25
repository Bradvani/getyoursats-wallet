import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {journalDigest,operationWalletKey,readOperations,writeOperation,operationFromPayment,isUnresolved,withOperationLock,type OperationRecord} from './operationJournal';
const walletKey='a'.repeat(64);
const record=():OperationRecord=>({version:1,walletKey,operationId:'11111111-1111-4111-8111-111111111111',paymentId:'payment-1',intentHash:'b'.repeat(64),network:'mainnet',route:'lightning',amountSats:'100',feeLimitSats:'2',state:'unknown',createdAt:1000,updatedAt:1000});
const payment=():Payment=>({id:'payment-1',paymentType:'send',method:'lightning',status:'completed',amount:100n,fees:2n,timestamp:1});
beforeEach(()=>{localStorage.clear()});
describe('durable operation journal',()=>{
 it('persists operation evidence without retaining recipient, invoice or secret input',async()=>{
  const intent={invoice:'lnbc-secret-fixture',recipient:'someone@example.invalid',amount:100n};
  writeOperation({...record(),intentHash:await journalDigest(intent),...intent} as OperationRecord);
  const serialized=localStorage.getItem(localStorage.key(0)!)!;
  expect(serialized).not.toContain(intent.invoice);expect(serialized).not.toContain(intent.recipient);
  expect(readOperations(walletKey)[0].state).toBe('unknown');
 });
 it('changes the intent hash for changed economic fields independent of object key order',async()=>{
  expect(await journalDigest({recipient:'a',amount:100n})).toBe(await journalDigest({amount:100n,recipient:'a'}));
  expect(await journalDigest({recipient:'a',amount:100n})).not.toBe(await journalDigest({recipient:'b',amount:100n}));
 });
 it('isolates journal keys by connected wallet identity and network',async()=>{
  expect(await operationWalletKey('mainnet','one')).not.toBe(await operationWalletKey('mainnet','two'));
  expect(await operationWalletKey('mainnet','one')).not.toBe(await operationWalletKey('regtest','one'));
 });
 it('fails closed on malformed durable records without deleting them',()=>{
  const key='gys:payment-journal:v1:'+walletKey+':bad';localStorage.setItem(key,'{damaged');
  expect(()=>readOperations(walletKey)).toThrow(/damaged/);expect(localStorage.getItem(key)).toBe('{damaged');
 });
 it('retains uncertainty for a generic SDK failed status',()=>{
  writeOperation(record());const updated=operationFromPayment(record(),{...payment(),status:'failed'});
  expect(updated.state).toBe('unknown');expect(isUnresolved(updated)).toBe(true);
 });
 it('clears uncertainty only for a matching completed payment within the approved bounds',()=>{
  writeOperation(record());const updated=operationFromPayment(record(),payment());
  expect(updated.state).toBe('completed');expect(isUnresolved(updated)).toBe(false);
 });
 it.each([{id:'another-payment'},{amount:101n},{fees:3n},{paymentType:'receive' as const},{method:'token' as const}])('rejects mismatched settlement evidence %#',change=>{
  writeOperation(record());expect(()=>operationFromPayment(record(),{...payment(),...change})).toThrow(/does not match/);
  expect(readOperations(walletKey)[0].state).toBe('unknown');
 });
 it('storage failures cannot be treated as a successful record commit',()=>{
  const spy=vi.spyOn(localStorage,'setItem').mockImplementationOnce(()=>{throw new DOMException('quota','QuotaExceededError')});
  try{expect(()=>writeOperation(record())).toThrow(/quota/)}finally{spy.mockRestore()}
 });
 it('refuses spending coordination when Web Locks are unavailable',async()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
  const action=vi.fn();await expect(withOperationLock(walletKey,action)).rejects.toThrow(/cannot safely coordinate/);
  expect(action).not.toHaveBeenCalled();
 });
 it('does not execute a second tab when the browser reports its wallet lock is held',async()=>{
  const action=vi.fn();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_name:string,_options:unknown,cb:(lock:null)=>unknown)=>cb(null)}});
  await expect(withOperationLock(walletKey,action)).rejects.toThrow(/Another tab/);expect(action).not.toHaveBeenCalled();
 });
});
