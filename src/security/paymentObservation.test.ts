import {beforeEach,describe,it,expect} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {applyPaymentObservation,observationSdk,type PaymentObservation} from './paymentObservation';
import {writeOperation,updateOperation,readOperations,operationWalletKey,isUnresolved,type OperationRecord} from './operationJournal';
const identity='disposable-observation-identity';
let record:OperationRecord;
const payment=(status:'completed'|'pending'|'failed'='completed'):Payment=>({
 id:'payment-1',paymentType:'send',method:'spark',status,amount:100n,fees:2n,timestamp:1,
});
const observation=(outcome:PaymentObservation['outcome']='completed'):PaymentObservation=>({
 paymentId:'payment-1',recipientCommitment:'c'.repeat(64),identityPubkey:identity,network:'mainnet',observedAt:Math.floor(Date.now()/1000),
 outcome,payment:outcome==='notFound'?undefined:payment(outcome==='returned'?'failed':'completed'),
});
beforeEach(async()=>{
 localStorage.clear();record={version:1,walletKey:await operationWalletKey('mainnet',identity),
 operationId:'11111111-1111-4111-8111-111111111111',paymentId:'payment-1',intentHash:'b'.repeat(64),recipientHash:'c'.repeat(64),
 network:'mainnet',route:'spark',amountSats:'100',feeLimitSats:'2',state:'unknown',createdAt:1,updatedAt:1};
 record=updateOperation(writeOperation({...record,state:'submitting'}),{state:'unknown'});
});
describe('fresh operator/provider observation',()=>{
 it('clears the duplicate-payment guard on matching fresh completion',async()=>{
  const result=await applyPaymentObservation(record,observation(),Date.now());
  expect(result.state).toBe('completed');expect(isUnresolved(result)).toBe(false);
 });
 it('retains explicit returned evidence instead of calling it paid',async()=>{
  const result=await applyPaymentObservation(record,observation('returned'),Date.now());
  expect(result.state).toBe('returned');expect(isUnresolved(result)).toBe(false);
  expect(readOperations(record.walletKey)[0].state).toBe('returned');
 });
 it.each(['notFound','unresolved'] as const)('never releases retry protection for %s',async outcome=>{
  const result=await applyPaymentObservation(record,observation(outcome),Date.now());
  expect(isUnresolved(result)).toBe(true);
 });
 it('retains unknown for a generic failed status with no returned-ownership proof',async()=>{
  const result=await applyPaymentObservation(record,{...observation('unresolved'),payment:payment('failed')},Date.now());
  expect(result.state).toBe('unknown');
 });
 it.each([
  {paymentId:'another-payment'}, {recipientCommitment:'d'.repeat(64)}, {identityPubkey:'another-wallet'}, {network:'regtest' as const},
  {observedAt:1},{observedAt:Math.floor(Date.now()/1000)+60}, {observedAt:NaN},
 ])('rejects mismatched/stale evidence %# without changing durable state',async change=>{
  await expect(applyPaymentObservation(record,{...observation(),...change},Date.now())).rejects.toThrow();
  expect(readOperations(record.walletKey)[0].state).toBe('unknown');
 });
 it.each([
  {id:'different'}, {amount:101n}, {fees:3n}, {fees:-1n}, {paymentType:'receive' as const},
  {method:'token' as const}, {status:'failed' as const},
 ])('rejects a contradictory completion receipt %#',async change=>{
  await expect(applyPaymentObservation(record,{...observation(),payment:{...payment(),...change}},Date.now())).rejects.toThrow();
  expect(readOperations(record.walletKey)[0].state).toBe('unknown');
 });
 it('does not treat a withdrawal failed status as returned funds',async()=>{
  localStorage.clear();
  const withdrawal=updateOperation(writeOperation({...record,route:'bitcoin',state:'submitting'}),{state:'unknown'});
  await expect(applyPaymentObservation(withdrawal,{...observation('returned'),payment:{...payment('failed'),method:'withdraw'}},Date.now())).rejects.toThrow();
 });
 it('never substitutes a legacy active sync method for the observation extension',()=>{
  expect(()=>observationSdk({syncWallet:()=>{throw Error('must not run')}} as never)).toThrow(/does not support/);
 });
});
