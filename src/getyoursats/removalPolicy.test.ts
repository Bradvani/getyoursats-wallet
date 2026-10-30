import {describe,it,expect,vi} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {runVerifiedRemoval} from './removalPolicy';
import {checkGysPaymentIntent} from '@/services/gysPaymentIntent';
const payment=(status:Payment['status'])=>({id:'public-test',status}) as Payment;
describe('cancel-safe removal execution boundary',()=>{
 it('allows removal after the matching terminal direct receipt is reconciled',async()=>{
  const identity='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  localStorage.setItem('gys:payment-intent:v1:'+identity,'{"id":"public-test"}');
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,_options:unknown,run:()=>Promise<void>)=>run()}});
  const erase=vi.fn();
  expect(await runVerifiedRemoval({read:async()=>({payments:[]}),isCurrent:()=>true,erase,reconcileDirect:async()=>{
   try{await checkGysPaymentIntent(identity,async()=>({payment:payment('completed')}));}catch{/* Review pause is handled by removal confirmation. */}
  }})).toBe('removed');
  expect(erase).toHaveBeenCalledOnce();
 });
 it('blocks an unresolved direct intent even when SDK history is empty',async()=>{
  localStorage.setItem('gys:payment-intent:v1:disposable','{"id":"unknown"}');
  const erase=vi.fn();
  expect(await runVerifiedRemoval({read:async()=>({payments:[]}),isCurrent:()=>true,erase})).toBe('blocked');
  expect(erase).not.toHaveBeenCalled();
 });
 it('rechecks direct intent state after the asynchronous history lookup',async()=>{
  const erase=vi.fn();
  expect(await runVerifiedRemoval({read:async()=>{
   localStorage.setItem('gys:payment-intent:v1:disposable','corrupt');return {payments:[]};
  },isCurrent:()=>true,erase})).toBe('blocked');
  expect(erase).not.toHaveBeenCalled();
 });
 it('never erases when pending payment exists',async()=>{const erase=vi.fn();expect(await runVerifiedRemoval({read:async()=>({payments:[payment('pending')]}),isCurrent:()=>true,erase})).toBe('blocked');expect(erase).not.toHaveBeenCalled();});
 it('never erases when the user cancels during status lookup',async()=>{let active=true;const erase=vi.fn();expect(await runVerifiedRemoval({read:async()=>{active=false;return {payments:[]};},isCurrent:()=>active,erase})).toBe('cancelled');expect(erase).not.toHaveBeenCalled();});
 it('never erases when the SDK lookup fails',async()=>{const erase=vi.fn();expect(await runVerifiedRemoval({read:async()=>{throw Error('offline');},isCurrent:()=>true,erase})).toBe('unavailable');expect(erase).not.toHaveBeenCalled();});
 it('checks older pages before erasing',async()=>{const erase=vi.fn();const read=vi.fn(async(offset:number)=>({payments:offset===0?Array.from({length:100},()=>payment('completed')):[payment('pending')]}));expect(await runVerifiedRemoval({read,isCurrent:()=>true,erase})).toBe('blocked');expect(read).toHaveBeenCalledTimes(2);expect(erase).not.toHaveBeenCalled();});
 it('erases once after a successful current-status check',async()=>{const erase=vi.fn();expect(await runVerifiedRemoval({read:async()=>({payments:[payment('completed')]}),isCurrent:()=>true,erase})).toBe('removed');expect(erase).toHaveBeenCalledOnce();});
});
