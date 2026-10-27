import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import TransferExperience from './TransferExperience';
import {TRANSFER_SEQUENCE_DURATION_MS,sequenceTarget,finalFillProgress,bitcoinFill} from '../utils/transferSequence';
let visibility='visible';let next=0;
beforeEach(()=>{vi.useFakeTimers();visibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});});
afterEach(()=>{cleanup();vi.useRealTimers();});
const advance=(ms:number)=>act(()=>{vi.advanceTimersByTime(ms);});
const id=()=>`sequence-unit-${++next}`;
describe('one evidence-bound transfer screen',()=>{
 it('shows milestone percentages without a clock ever completing the payment',()=>{
  const props={operationId:id(),direction:'sent' as const,onClose:vi.fn()};
  const {rerender}=render(<TransferExperience {...props} phase="preparing"/>);advance(1);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','25');
  rerender(<TransferExperience {...props} phase="processing"/>);advance(12000);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50');
  const held=screen.getByTestId('transfer-experience').getAttribute('data-visual-progress');advance(60000);
  expect(screen.getByTestId('transfer-experience')).toHaveAttribute('data-visual-progress',held);
  expect(screen.getByTestId('sequence-orange-fill')).toHaveAttribute('opacity','0');
  expect(screen.queryByText('100')).toBeNull();
 });
 it.each(['failed','unknown'] as const)('freezes %s at its last verified step, without an orange completion',phase=>{
  const props={operationId:id(),direction:'sent' as const,onClose:vi.fn()};
  const {rerender}=render(<TransferExperience {...props} phase="processing"/>);advance(1600);
  rerender(<TransferExperience {...props} phase={phase}/>);advance(1);
  const value=screen.getByTestId('transfer-experience').getAttribute('data-visual-progress');advance(20000);
  expect(screen.getByTestId('transfer-experience')).toHaveAttribute('data-visual-progress',value);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50');
  expect(screen.getByRole('alert')).toHaveTextContent(phase==='failed'?'Payment failed':'Payment status unknown');
  expect(screen.getByTestId('sequence-orange-fill')).toHaveAttribute('opacity','0');
 });
 it.each(['sent','received'] as const)('completes once for %s and changes only the Bitcoin glyph colour',direction=>{
  render(<TransferExperience operationId={id()} direction={direction} phase="confirmed" receiptId="verified-fixture-receipt" onClose={()=>{}}/>);
  advance(TRANSFER_SEQUENCE_DURATION_MS+200);
  expect(screen.getByTestId('transfer-experience')).toHaveAttribute('data-full-orange','true');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
  const svg=document.querySelector('.gys-contour-mark')!;
  expect(svg).toHaveAttribute('data-bitcoin-fill',direction==='sent'?'0.000':'1.000');
  expect(svg.querySelector('image,img,filter,animate')).toBeNull();
  const settled=screen.getByTestId('sequence-orange-fill').getAttribute('d');advance(15000);
  expect(screen.getByTestId('sequence-orange-fill')).toHaveAttribute('d',settled);
 });
 it('continues the same incoming operation after pending owner hands over to completed receipt',()=>{
  const operationId=id();const props={operationId,direction:'received' as const,onClose:()=>{}};
  const first=render(<TransferExperience {...props} phase="confirming"/>);advance(2400);
  const value=Number(screen.getByTestId('transfer-experience').getAttribute('data-visual-progress'));
  first.unmount();render(<TransferExperience {...props} phase="confirmed" receiptId={operationId}/>);advance(1);
  expect(Number(screen.getByTestId('transfer-experience').getAttribute('data-visual-progress'))).toBeGreaterThanOrEqual(value);
 });
 it('cannot complete without a receipt identifier',()=>{
  render(<TransferExperience operationId={id()} direction="sent" phase="confirmed" onClose={()=>{}}/>);advance(12000);
  expect(screen.getByTestId('transfer-experience')).toHaveAttribute('data-phase','unknown');
  expect(screen.getByTestId('sequence-orange-fill')).toHaveAttribute('opacity','0');
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow','100');
 });
 it('returning to the wallet closes presentation only',()=>{
  const onClose=vi.fn();render(<TransferExperience operationId={id()} direction="sent" phase="processing" onClose={onClose}/>);
  fireEvent.click(screen.getByRole('button',{name:'Return to wallet'}));expect(onClose).toHaveBeenCalledOnce();
 });
 it('pauses when hidden instead of burning through a completion',()=>{
  render(<TransferExperience operationId={id()} direction="received" phase="confirmed" receiptId="verified-fixture-receipt" onClose={()=>{}}/>);advance(1000);
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
  const value=screen.getByTestId('transfer-experience').getAttribute('data-visual-progress');advance(12000);
  expect(screen.getByTestId('transfer-experience')).toHaveAttribute('data-visual-progress',value);
 });
 it('keeps reduced-motion confirmation immediate but avoids a sweeping orange fill',()=>{
  vi.mocked(window.matchMedia).mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as MediaQueryList);
  render(<TransferExperience operationId={id()} direction="received" phase="confirmed" receiptId="verified-fixture-receipt" onClose={()=>{}}/>);advance(1);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
  expect(screen.getByTestId('sequence-orange-fill')).toHaveAttribute('opacity','0');
 });
});
describe('progress is evidence, not probability',()=>{
 it('keeps the final wave outside all pending stages',()=>{
  for(const phase of ['preparing','processing','confirming'] as const){expect(sequenceTarget(phase)).toBeLessThan(.72);expect(finalFillProgress(phase,1)).toBe(0);}
  expect(finalFillProgress('unknown',1)).toBe(0);expect(finalFillProgress('failed',1)).toBe(0);
 });
 it('fills and drains the same B geometry symmetrically',()=>{
  for(const p of [0,.2,.5,.8,1])expect(bitcoinFill('sent',p)+bitcoinFill('received',p)).toBeCloseTo(1);
 });
});
