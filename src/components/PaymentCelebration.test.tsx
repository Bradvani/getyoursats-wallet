import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import PaymentCelebration from './PaymentCelebration';
vi.mock('../contexts/StableBalanceContext',()=>({useStableBalance:()=>({displayConfig:null})}));
vi.mock('../contexts/FiatDataContext',()=>({useFiatData:()=>({fiatCurrencies:[]})}));
vi.mock('./SatAmount',()=>({SatAmount:({sats}:{sats:number})=><span>{sats} sats</span>}));
vi.mock('../utils/transferHaptics',()=>({notifyPaymentFeedback:vi.fn()}));
const payment=(status:'pending'|'completed')=>({id:'receive-event-guard',paymentType:'receive',status,method:'spark',amount:10n,fees:0n,timestamp:1700000000} as Payment);
beforeEach(()=>{vi.useFakeTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});});
afterEach(()=>{cleanup();vi.useRealTimers()});
describe('receive success evidence',()=>{
 it('does not render or time out a pending payment as a success',()=>{
  const onClose=vi.fn();render(<PaymentCelebration payment={payment('pending')} onClose={onClose}/>);
  act(()=>{vi.advanceTimersByTime(6000)});
  expect(screen.queryByTestId('transfer-pulse')).toBeNull();expect(screen.queryByText('Payment Received!')).toBeNull();expect(onClose).not.toHaveBeenCalled();
 });
 it('starts when the same payment is actually completed, then closes its receipt',()=>{
  const onClose=vi.fn();const {rerender}=render(<PaymentCelebration payment={payment('pending')} onClose={onClose}/>);
  rerender(<PaymentCelebration payment={payment('completed')} onClose={onClose}/>);
  act(()=>{vi.advanceTimersByTime(50)});act(()=>{vi.advanceTimersByTime(1)});
  expect(screen.getByTestId('transfer-pulse')).toHaveAttribute('data-direction','received');
  act(()=>{vi.advanceTimersByTime(6000)});expect(onClose).not.toHaveBeenCalled();
  act(()=>{vi.advanceTimersByTime(2400)});expect(onClose).toHaveBeenCalledTimes(1);
 });
});
