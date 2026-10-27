import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useTransferSequence} from './useTransferSequence';
import {TRANSFER_SEQUENCE_DURATION_MS,type TransferPhase} from '../utils/transferSequence';
let visibility='visible';let ticket=0;let next=0;
let callbacks=new Map<number,FrameRequestCallback>();
const frame=(time:number)=>act(()=>{const queued=[...callbacks.values()];callbacks.clear();queued.forEach(fn=>fn(time));});
const flush=()=>act(()=>{vi.advanceTimersByTime(0)});
beforeEach(()=>{
 vi.useFakeTimers();visibility='visible';callbacks=new Map();
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{const id=++ticket;callbacks.set(id,callback);return id;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>{callbacks.delete(id);});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe('elapsed-foreground transfer animation clock',()=>{
 it('reaches its confirmed target on time even when rendering drops frames',()=>{
  const id=`foreground-confirmed-${++next}`;
  const {result}=renderHook(()=>useTransferSequence('sent',id,'confirmed',id));flush();
  frame(1000);frame(1000+TRANSFER_SEQUENCE_DURATION_MS);
  expect(result.current.visual).toBe(1);
  expect(result.current.finished).toBe(true);
  expect(callbacks.size).toBe(0);
 });
 it('cannot turn a stalled pending payment into confirmation after a long frame',()=>{
  const id=`foreground-pending-${++next}`;
  const {result}=renderHook(()=>useTransferSequence('sent',id,'processing'));flush();
  frame(1000);frame(121000);
  expect(result.current.visual).toBe(.46);
  expect(result.current.percent).toBe(50);
  expect(result.current.finished).toBe(false);
  expect(callbacks.size).toBe(0);
 });
 it('does not count time spent in the background as visual progress',()=>{
  const id=`foreground-hidden-${++next}`;
  const {result}=renderHook(()=>useTransferSequence('received',id,'confirming'));flush();
  frame(1000);frame(2000);const before=result.current.visual;
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));});
  expect(callbacks.size).toBe(0);
  act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
  frame(122000);expect(result.current.visual).toBe(before);
  frame(122560);expect(result.current.visual).toBeCloseTo(before+.1,6);
 });
 it.each(['failed','unknown'] as const)('a %s event cancels the remaining trajectory regardless of a late frame',phase=>{
  const id=`foreground-interrupted-${++next}`;
  const {result,rerender}=renderHook(({state}:{state:TransferPhase})=>useTransferSequence('sent',id,state),{initialProps:{state:'processing' as TransferPhase}});flush();
  frame(1000);frame(1800);const before=result.current.visual;
  rerender({state:phase});flush();frame(120000);
  expect(result.current.phase).toBe(phase);
  expect(result.current.visual).toBe(before);
  expect(result.current.percent).toBe(50);
  expect(result.current.finished).toBe(false);
  expect(callbacks.size).toBe(0);
 });
});
