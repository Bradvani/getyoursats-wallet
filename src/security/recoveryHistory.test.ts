import {describe,it,expect,vi} from 'vitest';
import type {Payment,ListPaymentsRequest} from '@breeztech/breez-sdk-spark';
import {readRecoveryHistory} from './recoveryHistory';
const payment=(i:number):Payment=>({id:`public-fixture-${i}`,paymentType:'receive',method:'spark',status:'completed',amount:BigInt(i+1),fees:0n,timestamp:i});
const reader=(rows:Payment[])=>({listPayments:vi.fn(async(q:ListPaymentsRequest)=>({payments:rows.slice(q.offset??0,(q.offset??0)+(q.limit??100))}))});
describe('complete local recovery-history pagination',()=>{
 it.each([0,1,99,100,101,200,301])('checks all %i local rows including the last-page boundary',async count=>{
  const client=reader(Array.from({length:count},(_,i)=>payment(i))),assert=vi.fn();
  const result=await readRecoveryHistory(client,assert);
  expect(result.count).toBe(count);expect(result.payments).toHaveLength(count);
  expect(result.digest).toMatch(/^[0-9a-f]{64}$/);expect(client.listPayments).toHaveBeenCalledTimes(Math.floor(count/100)+1);
 });
 it('refuses a repeated page instead of silently dropping duplicates',async()=>{
  const client=reader([]);client.listPayments.mockResolvedValue({payments:Array.from({length:100},(_,i)=>payment(i))});
  await expect(readRecoveryHistory(client,()=>{})).rejects.toThrow(/repeated/);
 });
 it('propagates a second-page error rather than accepting the first 100 rows',async()=>{
  const client=reader([]);client.listPayments.mockResolvedValueOnce({payments:Array.from({length:100},(_,i)=>payment(i))}).mockRejectedValueOnce(new Error('page unavailable'));
  await expect(readRecoveryHistory(client,()=>{})).rejects.toThrow('page unavailable');
 });
 it('checks session state between pages and stops further reads',async()=>{
  const client=reader(Array.from({length:201},(_,i)=>payment(i)));let active=true;
  client.listPayments.mockImplementationOnce(async()=>{active=false;return {payments:Array.from({length:100},(_,i)=>payment(i))};});
  await expect(readRecoveryHistory(client,()=>{if(!active)throw new Error('locked');})).rejects.toThrow('locked');
  expect(client.listPayments).toHaveBeenCalledOnce();
 });
 it.each([null,undefined,{},'wrong',[]])('refuses malformed payment rows %j',async row=>{
  await expect(readRecoveryHistory({listPayments:vi.fn(async()=>({payments:[row] as Payment[]}))},()=>{})).rejects.toThrow(/invalid record/);
 });
 it.each([{id:''},{amount:-1n},{amount:1},{fees:-1n},{timestamp:NaN},{status:'unknown'},{paymentType:'other'},{method:'other'}])('refuses invalid economic/history fields %#',async change=>{
  await expect(readRecoveryHistory(reader([{...payment(1),...change} as Payment]),()=>{})).rejects.toThrow(/invalid record/);
 });
 it('commits to details and exact amounts, not just payment IDs',async()=>{
  const a=await readRecoveryHistory(reader([payment(1)]),()=>{});
  const b=await readRecoveryHistory(reader([{...payment(1),amount:3n}]),()=>{});
  expect(a.digest).not.toBe(b.digest);
 });
 it('is independent of page ordering while retaining display ordering',async()=>{
  const a=await readRecoveryHistory(reader([payment(1),payment(2)]),()=>{});
  const b=await readRecoveryHistory(reader([payment(2),payment(1)]),()=>{});
  expect(a.digest).toBe(b.digest);expect(a.payments[0].id).not.toBe(b.payments[0].id);
 });
});
