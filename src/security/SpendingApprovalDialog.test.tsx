import {describe,it,expect,afterEach,beforeEach,vi} from 'vitest';
import {requestSpendingApproval,finishSpendingApproval,getSpendingRequest,cancelSpendingApproval,createPaymentApprovalObserver,rememberSignerIdentity,clearSignerIdentity,lockSpendingSession,unlockSpendingSession} from './spendApproval';
const words='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
beforeEach(async()=>{await rememberSignerIdentity({type:'mnemonic',mnemonic:words})});
afterEach(()=>{cancelSpendingApproval();clearSignerIdentity();vi.useRealTimers()});
const payments=[{paymentId:'invoice:1',amount:125n,details:{type:'lightning' as const,invoice:'lnbc...'}}];
describe('SDK transaction authorization',()=>{
 it('requires explicit approval and permits one pending operation',async()=>{
  const promise=requestSpendingApproval(payments);
  const current=getSpendingRequest();expect(current?.payments[0].amount).toBe(125n);
  await expect(requestSpendingApproval(payments)).rejects.toThrow(/Another transaction/);
  finishSpendingApproval(current!.id,true);
  await expect(promise).resolves.toBeUndefined();
 });
 it('fails closed on cancellation or a mismatched id',async()=>{
  const promise=requestSpendingApproval(payments);
  finishSpendingApproval(999,true);expect(getSpendingRequest()).not.toBeNull();
  cancelSpendingApproval();
  await expect(promise).rejects.toThrow(/cancelled/);
 });
 it('freezes a copy of transaction details rather than holding mutable callback data',async()=>{
  const p=[{paymentId:'1',amount:125n,details:{type:'lightning' as const,invoice:'lnbc-original'}}];
  const pending=requestSpendingApproval(p);
  p[0].amount=900n;p[0].details.invoice='lnbc-modified';
  expect(getSpendingRequest()?.payments[0].amount).toBe(125n);
  expect(getSpendingRequest()?.payments[0].details).toMatchObject({invoice:'lnbc-original'});
  finishSpendingApproval(getSpendingRequest()!.id,true);await pending;
 });
 it('rejects an elapsed deadline even if the timeout task is delayed',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000);
  const promise=requestSpendingApproval(payments);
  const rejected=expect(promise).rejects.toThrow(/expired/);
  vi.setSystemTime(100_000);
  finishSpendingApproval(getSpendingRequest()!.id,true);
  await rejected;
 });
 it('refuses another transaction until the locked session is re-authenticated',async()=>{
  lockSpendingSession();
  await expect(requestSpendingApproval(payments)).rejects.toThrow(/locked/);
  await unlockSpendingSession({type:'mnemonic',mnemonic:words});
  const p=requestSpendingApproval(payments);
  finishSpendingApproval(getSpendingRequest()!.id,true);await p;
 });
 it('SDK observer must wait for approval before returning',async()=>{
  const action=vi.fn();
  const promise=createPaymentApprovalObserver().beforeSend(payments).then(action).catch(()=>{});
  expect(action).not.toHaveBeenCalled();
  cancelSpendingApproval();await promise;
  expect(action).not.toHaveBeenCalled();
 });
});
