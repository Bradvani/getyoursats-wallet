import {describe,it,expect,afterEach,vi} from 'vitest';
import {requestSpendingApproval,finishSpendingApproval,getSpendingRequest,cancelSpendingApproval,createPaymentApprovalObserver} from './spendApproval';
afterEach(()=>cancelSpendingApproval());
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
 it('SDK observer must wait for approval before returning',async()=>{
  const action=vi.fn();
  const promise=createPaymentApprovalObserver().beforeSend(payments).then(action).catch(()=>{});
  expect(action).not.toHaveBeenCalled();
  cancelSpendingApproval();await promise;
  expect(action).not.toHaveBeenCalled();
 });
});
