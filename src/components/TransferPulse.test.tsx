import {StrictMode} from 'react';
import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import PaymentMotion from './PaymentMotion';
import TransferPulse,{TRANSFER_PULSE_DURATION_MS} from './TransferPulse';
import TransferProgress from './TransferProgress';
import ResultStep from '../features/send/steps/ResultStep';
import type {Payment} from '@breeztech/breez-sdk-spark';
let visibility='visible';
beforeEach(()=>{vi.useFakeTimers();visibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});});
afterEach(()=>{cleanup();vi.useRealTimers()});
const begin=()=>act(()=>{vi.advanceTimersByTime(1)});
const receipt=(id:string,status='completed')=>({id,status,amount:1234n,fees:1n,method:'spark',paymentType:'send'} as Payment);
describe('logo-anchored directional contours',()=>{
 it.each(['sent','received'] as const)('renders six masked contours with no duplicate logo or screen wash for %s',direction=>{
  const {container}=render(<PaymentMotion state={direction} settlementId={`contours-${direction}`}/>);begin();
  const pulse=screen.getByTestId('transfer-pulse');expect(pulse.parentElement).toBe(document.body);
  expect(pulse.querySelectorAll('.gys-pulse__contour')).toHaveLength(6);
  expect(pulse.querySelector('image,img')).toBeNull();expect(pulse.querySelector('mask')).not.toBeNull();
  expect(container.querySelectorAll('.gys-contour-mark')).toHaveLength(1);
  act(()=>{vi.advanceTimersByTime(1500)});expect(screen.getByTestId('transfer-pulse')).toBeInTheDocument();
  act(()=>{vi.advanceTimersByTime(TRANSFER_PULSE_DURATION_MS)});expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it.each(['sending','receiving','converting'] as const)('sustains %s as pending rather than manufacturing a confirmation',state=>{
  render(<PaymentMotion state={state}/>);begin();act(()=>{vi.advanceTimersByTime(12000)});
  expect(screen.getByTestId('transfer-flow')).toBeInTheDocument();expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('static receipts, compact artwork and failure remain quiet',()=>{
  render(<><PaymentMotion state="received" settlementId="old" animate={false}/><PaymentMotion state="received" settlementId="small" compact/><PaymentMotion state="failed"/></>);
  begin();expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('deduplicates completed receipts including StrictMode remounts',()=>{
  const {unmount}=render(<StrictMode><TransferPulse direction="received" paymentId="dedup-v2"/><TransferPulse direction="received" paymentId="dedup-v2"/></StrictMode>);
  begin();expect(screen.getAllByTestId('transfer-pulse')).toHaveLength(1);
  unmount();render(<TransferPulse direction="received" paymentId="dedup-v2"/>);begin();expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('pauses pending when hidden and resumes without a success claim',()=>{
  render(<PaymentMotion state="sending"/>);begin();
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});expect(screen.queryByTestId('transfer-flow')).toBeNull();
  act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'))});expect(screen.getByTestId('transfer-flow')).toBeInTheDocument();
 });
 it('does not replay completed motion after returning from background',()=>{
  render(<TransferPulse direction="sent" paymentId="background-v2"/>);begin();
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));visibility='visible';document.dispatchEvent(new Event('visibilitychange'))});
  expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('uses a static reduced-motion accent',()=>{
  vi.mocked(window.matchMedia).mockReturnValueOnce({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as MediaQueryList);
  render(<TransferPulse direction="received" paymentId="reduced-v2"/>);begin();
  expect(screen.getByTestId('transfer-pulse')).toHaveAttribute('data-reduced-motion','true');
  act(()=>{vi.advanceTimersByTime(301)});expect(screen.queryByTestId('transfer-pulse')).toBeNull();
 });
 it('never counts up a percentage with elapsed time; only a verified receipt yields 100%',()=>{
  const {rerender}=render(<TransferProgress/>);act(()=>{vi.advanceTimersByTime(120000)});
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');expect(screen.queryByText('100%')).toBeNull();
  rerender(<ResultStep result="unknown" payment={receipt('unknown-v2','pending')} error={null} onClose={()=>{}}/>);begin();
  expect(screen.queryByText('100%')).toBeNull();
  rerender(<ResultStep result="success" payment={receipt('done-v2')} error={null} onClose={()=>{}}/>);begin();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');expect(screen.getByTestId('sent-payment-amount')).toHaveTextContent('1 234 sats');
 });
 it.each(['auth','refund'] as const)('does not claim transfer completion for %s',operationType=>{
  render(<ResultStep result="success" operationType={operationType} error={null} onClose={()=>{}}/>);begin();
  expect(screen.queryByTestId('transfer-pulse')).toBeNull();expect(screen.queryByText('100%')).toBeNull();
 });
});
