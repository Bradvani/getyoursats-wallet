import {StrictMode} from 'react';
import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import PaymentMotion from './PaymentMotion';
import TransferPulse from './TransferPulse';
import ResultStep from '../features/send/steps/ResultStep';
import {startTransferHaptics} from '../utils/transferHaptics';
import type {Payment} from '@breeztech/breez-sdk-spark';
const {cancel}=vi.hoisted(()=>({cancel:vi.fn()}));
vi.mock('../utils/transferHaptics',()=>({startTransferHaptics:vi.fn(()=>cancel)}));
let visibility='visible';
beforeEach(()=>{
 vi.useFakeTimers();visibility='visible';
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
});
afterEach(()=>{cleanup();vi.useRealTimers()});
const begin=()=>act(()=>{vi.advanceTimersByTime(1)});
const receipt=(id:string,status='completed')=>({id,status,amount:1234n,fees:1n,method:'spark',paymentType:'send'} as Payment);
describe('settlement-driven paired transfer pulse',()=>{
 it.each(['sent','received'] as const)('uses a full-viewport decorative portal for %s only after its owner confirms',direction=>{
  const {container}=render(<PaymentMotion state={direction} settlementId={`direction-${direction}`}/>);
  begin();
  expect(container.querySelector('[data-testid="transfer-pulse"]')).toBeNull();
  const pulse=screen.getByTestId('transfer-pulse');
  expect(pulse.parentElement).toBe(document.body);
  expect(pulse).toHaveAttribute('aria-hidden','true');
  expect(pulse).toHaveAttribute('data-direction',direction);
  act(()=>{vi.advanceTimersByTime(1300)});
  expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it.each(['sending','receiving','converting','failed'] as const)('never invents success for %s',state=>{
  render(<PaymentMotion state={state} settlementId={`not-completed-${state}`}/>);
  act(()=>{vi.advanceTimersByTime(60000)});
  expect(screen.queryByTestId('transfer-pulse')).toBeNull();
  expect(startTransferHaptics).not.toHaveBeenCalled();
 });
 it('historical, compact and unbound success artwork stays quiet',()=>{
  render(<><PaymentMotion state="received" settlementId="old" animate={false}/>
   <PaymentMotion state="received" settlementId="qr" compact/>
   <PaymentMotion state="sent"/></>);
  begin();expect(screen.queryByTestId('transfer-pulse')).toBeNull();
  expect(startTransferHaptics).not.toHaveBeenCalled();
 });
 it('deduplicates competing receipt owners and StrictMode replays',()=>{
  const {unmount}=render(<StrictMode><TransferPulse direction="received" paymentId="duplicate"/>
    <TransferPulse direction="received" paymentId="duplicate"/></StrictMode>);
  begin();expect(screen.getAllByTestId('transfer-pulse')).toHaveLength(1);
  expect(startTransferHaptics).toHaveBeenCalledTimes(1);
  unmount();render(<TransferPulse direction="received" paymentId="duplicate"/>);begin();
  expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('backgrounding cancels queued feedback and never replays on resume',()=>{
  render(<TransferPulse direction="sent" paymentId="background"/>);begin();
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
  expect(screen.queryByTestId('transfer-pulse')).toBeNull();expect(cancel).toHaveBeenCalled();
  act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'));vi.advanceTimersByTime(3000)});
  expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('does not start while hidden',()=>{
  visibility='hidden';render(<TransferPulse direction="received" paymentId="hidden"/>);begin();
  expect(startTransferHaptics).not.toHaveBeenCalled();expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('uses a short static border in reduced-motion mode',()=>{
  vi.mocked(window.matchMedia).mockReturnValueOnce({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as MediaQueryList);
  render(<TransferPulse direction="received" paymentId="reduced"/>);begin();
  expect(screen.getByTestId('transfer-pulse')).toHaveAttribute('data-reduced-motion','true');
  expect(startTransferHaptics).toHaveBeenCalledWith('received',true);
  act(()=>{vi.advanceTimersByTime(210)});expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('only a completed payment receipt gives the send result a pulse and exact amount',()=>{
  const {rerender}=render(<ResultStep result="unknown" payment={receipt('unknown','pending')} error={null} onClose={()=>{}}/>);
  begin();expect(screen.queryByTestId('transfer-pulse')).toBeNull();
  rerender(<ResultStep result="success" payment={receipt('completed-send')} error={null} onClose={()=>{}}/>);
  begin();expect(screen.getByTestId('transfer-pulse')).toHaveAttribute('data-direction','sent');
  expect(screen.getByTestId('sent-payment-amount')).toHaveTextContent('1 234 sats');
 });
 it.each(['auth','refund'] as const)('does not claim funds settlement for %s',operationType=>{
  render(<ResultStep result="success" operationType={operationType} error={null} onClose={()=>{}}/>);
  begin();expect(screen.queryByTestId('transfer-pulse')).toBeNull();expect(startTransferHaptics).not.toHaveBeenCalled();
 });
});
