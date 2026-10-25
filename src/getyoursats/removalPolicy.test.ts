import {describe,it,expect,vi} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {runVerifiedRemoval} from './removalPolicy';
const payment=(status:Payment['status'])=>({id:'public-test',status}) as Payment;
describe('cancel-safe removal execution boundary',()=>{
 it('never erases when pending payment exists',async()=>{const erase=vi.fn();expect(await runVerifiedRemoval({read:async()=>({payments:[payment('pending')]}),isCurrent:()=>true,erase})).toBe('blocked');expect(erase).not.toHaveBeenCalled();});
 it('never erases when the user cancels during status lookup',async()=>{let active=true;const erase=vi.fn();expect(await runVerifiedRemoval({read:async()=>{active=false;return {payments:[]};},isCurrent:()=>active,erase})).toBe('cancelled');expect(erase).not.toHaveBeenCalled();});
 it('never erases when the SDK lookup fails',async()=>{const erase=vi.fn();expect(await runVerifiedRemoval({read:async()=>{throw Error('offline');},isCurrent:()=>true,erase})).toBe('unavailable');expect(erase).not.toHaveBeenCalled();});
 it('checks older pages before erasing',async()=>{const erase=vi.fn();const read=vi.fn(async(offset:number)=>({payments:offset===0?Array.from({length:100},()=>payment('completed')):[payment('pending')]}));expect(await runVerifiedRemoval({read,isCurrent:()=>true,erase})).toBe('blocked');expect(read).toHaveBeenCalledTimes(2);expect(erase).not.toHaveBeenCalled();});
 it('erases once after a successful current-status check',async()=>{const erase=vi.fn();expect(await runVerifiedRemoval({read:async()=>({payments:[payment('completed')]}),isCurrent:()=>true,erase})).toBe('removed');expect(erase).toHaveBeenCalledOnce();});
});
