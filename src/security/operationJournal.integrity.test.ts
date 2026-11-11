import {beforeEach,describe,expect,it} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {hasOperationRecords,isUnresolved,operationFromPayment,readAllOperations,readOperations,updateOperation,writeOperation,type OperationRecord} from './operationJournal';

const walletKey='a'.repeat(64);
const attempt=():OperationRecord=>({version:1,walletKey,operationId:'11111111-1111-4111-8111-111111111111',
 paymentId:'provider-payment',intentHash:'b'.repeat(64),recipientHash:'c'.repeat(64),network:'mainnet',route:'spark',
 amountSats:'100',feeLimitSats:'2',state:'submitting',createdAt:1000,updatedAt:1000});
beforeEach(()=>localStorage.clear());

describe('outgoing attempt integrity after interruption',()=>{
 it('preserves a pending attempt when an operation ID is accidentally reused',()=>{
  const pending=updateOperation(writeOperation(attempt()),{state:'pending'});
  expect(()=>writeOperation({...attempt(),amountSats:'200'})).toThrow(/already exists/);
  expect(readOperations(walletKey)).toEqual([pending]);
 });
 it('rejects a delayed failure callback after authoritative completion',()=>{
  const submitted=writeOperation(attempt());
  const completed=updateOperation(submitted,{state:'completed'});
  expect(()=>updateOperation(submitted,{state:'unknown'})).toThrow(/changed/);
  expect(readOperations(walletKey)).toEqual([completed]);
 });
 it.each(['completed','returned'] as const)('does not reopen a %s attempt or rebind its provider ID',state=>{
  const terminal=updateOperation(writeOperation(attempt()),{state});
  expect(()=>updateOperation(terminal,{state:'pending'})).toThrow(/cannot be replaced/);
  expect(()=>updateOperation(terminal,{paymentId:'different-provider-payment'})).toThrow(/cannot be replaced/);
  expect(readOperations(walletKey)).toEqual([terminal]);
 });
 it('rejects stale provider correlation while preserving the latest pending identity',()=>{
  const submitted=writeOperation(attempt());
  const correlated=updateOperation(submitted,{paymentId:'final-provider-id'});
  expect(()=>updateOperation(submitted,{state:'completed'})).toThrow(/changed/);
  expect(readOperations(walletKey)).toEqual([correlated]);
  expect(isUnresolved(correlated)).toBe(true);
 });
 it('refuses a replay into submitting after the attempt is uncertain',()=>{
  const uncertain=updateOperation(writeOperation(attempt()),{state:'unknown'});
  expect(()=>updateOperation(uncertain,{state:'submitting'})).toThrow(/cannot be replaced/);
  expect(readOperations(walletKey)).toEqual([uncertain]);
 });
 it.each(['amountSats','feeLimitSats','intentHash','recipientHash','network','route'] as const)(
  'rejects an altered %s from a stale in-memory record',field=>{
   const saved=writeOperation(attempt());
   const changes={amountSats:'101',feeLimitSats:'3',intentHash:'d'.repeat(64),recipientHash:'e'.repeat(64),network:'regtest',route:'lightning'};
   const changed={...saved,[field]:changes[field]} as OperationRecord;
   expect(()=>updateOperation(changed,{state:'completed'})).toThrow(/changed/);
   expect(readOperations(walletKey)).toEqual([saved]);
  });
 it('preserves incompatible journal versions and refuses to ignore their unresolved attempts',()=>{
  const k='gys:payment-journal:v2:'+walletKey+':future-attempt',bytes=JSON.stringify({...attempt(),version:2});
  localStorage.setItem(k,bytes);
  expect(hasOperationRecords()).toBe(true);
  expect(()=>readOperations(walletKey)).toThrow(/damaged/);
  expect(()=>readAllOperations()).toThrow(/damaged/);
  expect(localStorage.getItem(k)).toBe(bytes);
 });
 it.each([
  {amountSats:100},{feeLimitSats:2},{operationId:'-'.repeat(36)},
  {amountSats:'0'},{amountSats:'01'},{amountSats:'2100000000000001'},
  {feeLimitSats:'02'},{feeLimitSats:'2100000000000001'},
  {operationId:[attempt().operationId]},{intentHash:[attempt().intentHash]},{recipientHash:[attempt().recipientHash]},
 ])('preserves and rejects noncanonical journal fields %#',change=>{
  const malformed={...attempt(),state:'completed',...change};
  const k='gys:payment-journal:v1:'+walletKey+':'+malformed.operationId,bytes=JSON.stringify(malformed);
  localStorage.setItem(k,bytes);
  expect(()=>readAllOperations()).toThrow(/damaged/);
  expect(localStorage.getItem(k)).toBe(bytes);
 });
 it('rejects an unexpected conversion in an otherwise matching completion receipt',()=>{
  const saved=writeOperation(attempt());
  const p={id:saved.paymentId,paymentType:'send',method:'spark',status:'completed',amount:100n,fees:2n,timestamp:1,
   conversionDetails:{unexpected:true}} as unknown as Payment;
  expect(()=>operationFromPayment(saved,p)).toThrow(/does not match/);
  expect(readOperations(walletKey)).toEqual([saved]);
 });
});
