import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Capacitor} from '@capacitor/core';
import {Haptics} from '@capacitor/haptics';
import {startTransferHaptics,setPaymentHapticsEnabled} from './transferHaptics';
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:vi.fn(()=>false)}}));
vi.mock('@capacitor/haptics',()=>({Haptics:{impact:vi.fn().mockResolvedValue(undefined)},ImpactStyle:{Light:'LIGHT'}}));
let visibility='visible';let stop=()=>{};
const vibrate=vi.fn((duration:number)=>duration>=0);
beforeEach(()=>{
 vi.useFakeTimers();visibility='visible';
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
 Object.defineProperty(navigator,'vibrate',{configurable:true,value:vibrate});
 Object.defineProperty(navigator,'userActivation',{configurable:true,value:{hasBeenActive:true}});
});
afterEach(()=>{stop();vi.useRealTimers()});
describe('transfer haptic choreography',()=>{
 it('pairs two restrained native impacts with the outbound pulse',()=>{
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  stop=startTransferHaptics('sent');expect(Haptics.impact).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(649);expect(Haptics.impact).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);expect(Haptics.impact).toHaveBeenCalledTimes(2);
 });
 it('uses short supported web vibration only after user activation',()=>{
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  stop=startTransferHaptics('received');expect(vibrate).toHaveBeenCalledWith(12);
  vi.advanceTimersByTime(760);expect(vibrate.mock.calls.filter(x=>x[0]===12)).toHaveLength(2);
 });
 it('cancels the second accent on backgrounding',()=>{
  stop=startTransferHaptics('received');const count=vi.mocked(Haptics.impact).mock.calls.length+vibrate.mock.calls.length;
  visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(2000);
  expect(vi.mocked(Haptics.impact).mock.calls.length+vibrate.mock.calls.filter(x=>x[0]!==0).length).toBe(count);
 });
 it('honors the user opt-out',()=>{
  setPaymentHapticsEnabled(false);stop=startTransferHaptics('sent');vi.advanceTimersByTime(2000);
  expect(Haptics.impact).not.toHaveBeenCalled();expect(vibrate).not.toHaveBeenCalled();
 });
 it('does not vibrate a web page with no user activation',()=>{
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  Object.defineProperty(navigator,'userActivation',{configurable:true,value:{hasBeenActive:false}});
  stop=startTransferHaptics('sent');vi.advanceTimersByTime(2000);expect(vibrate).not.toHaveBeenCalled();
 });
 it('reduces to one accent for reduced motion and tolerates a missing engine',async()=>{
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);vi.mocked(Haptics.impact).mockRejectedValueOnce(new Error('no engine'));
  expect(()=>{stop=startTransferHaptics('sent',true)}).not.toThrow();
  await Promise.resolve();vi.advanceTimersByTime(2000);expect(Haptics.impact).toHaveBeenCalledTimes(1);
 });
});
