import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Capacitor} from '@capacitor/core';
import {Haptics} from '@capacitor/haptics';
import {playPaymentFeedback,notifyPaymentFeedback,setPaymentHapticsEnabled,paymentVibrationSupported} from './transferHaptics';
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:vi.fn(()=>false)}}));
vi.mock('@capacitor/haptics',()=>({Haptics:{notification:vi.fn().mockResolvedValue(undefined)},NotificationType:{Success:'SUCCESS',Error:'ERROR'}}));
const vibrate=vi.fn((_pattern:number|number[])=>true);
beforeEach(()=>{
 vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);vibrate.mockReturnValue(true);
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 Object.defineProperty(navigator,'vibrate',{configurable:true,value:vibrate});
 Object.defineProperty(navigator,'userActivation',{configurable:true,value:{hasBeenActive:true}});
});
describe('payment result feedback independent of decorative clocks',()=>{
 it('uses perceptible distinct web success/error patterns and a direct user test',async()=>{
  expect(await playPaymentFeedback('success')).toBe('accepted');expect(vibrate).toHaveBeenLastCalledWith(70);
  await playPaymentFeedback('error');expect(vibrate).toHaveBeenLastCalledWith([80,60,100]);
  await playPaymentFeedback('test');expect(vibrate).toHaveBeenLastCalledWith(120);
 });
 it('uses native notification feedback, not a barely perceptible light impact',async()=>{
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  await playPaymentFeedback('success');expect(Haptics.notification).toHaveBeenCalledWith({type:'SUCCESS'});
  await playPaymentFeedback('error');expect(Haptics.notification).toHaveBeenCalledWith({type:'ERROR'});
  expect(vibrate).not.toHaveBeenCalled();
 });
 it('honors opt-out and hidden pages',async()=>{
  setPaymentHapticsEnabled(false);expect(await playPaymentFeedback('success')).toBe('disabled');
  setPaymentHapticsEnabled(true);Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  expect(await playPaymentFeedback('error')).toBe('hidden');expect(vibrate).not.toHaveBeenCalled();
 });
 it('handles absent userActivation without falsely disabling supported browsers',async()=>{
  Object.defineProperty(navigator,'userActivation',{configurable:true,value:undefined});
  expect(await playPaymentFeedback('success')).toBe('accepted');
 });
 it('reports API absence and browser rejection rather than claiming motor delivery',async()=>{
  vibrate.mockReturnValue(false);expect(await playPaymentFeedback('test')).toBe('blocked');
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:undefined});
  expect(paymentVibrationSupported()).toBe(false);expect(await playPaymentFeedback('test')).toBe('unsupported');
 });
 it('does not bypass activation restrictions',async()=>{
  Object.defineProperty(navigator,'userActivation',{configurable:true,value:{hasBeenActive:false}});
  expect(await playPaymentFeedback('success')).toBe('blocked');expect(vibrate).not.toHaveBeenCalled();
 });
 it('deduplicates event and receipt owners, independently for a later definitive failure',async()=>{
  notifyPaymentFeedback('success','unique-feedback-1');notifyPaymentFeedback('success','unique-feedback-1');
  await Promise.resolve();expect(vibrate).toHaveBeenCalledTimes(1);
  notifyPaymentFeedback('error','unique-feedback-1');expect(vibrate).toHaveBeenCalledTimes(2);
 });
 it('native engine errors never escape into payment execution',async()=>{
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(Haptics.notification).mockRejectedValueOnce(new Error('no hardware'));
  expect(await playPaymentFeedback('success')).toBe('error');
 });
});
