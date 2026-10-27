import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SdkEvent} from '@breeztech/breez-sdk-spark';
import IncomingPaymentNotice from './IncomingPaymentNotice';
let listener:((event:SdkEvent)=>void)|undefined;
const subscribe=(fn:(event:SdkEvent)=>void)=>{listener=fn;return()=>{listener=undefined;};};
vi.mock('../contexts/WalletContext',()=>({useSdkEvents:()=>subscribe}));
vi.mock('../services/passkeyService',()=>({isMigrationInProgress:()=>false}));
vi.mock('../utils/paymentDescription',()=>({isConversionPayment:(payment:{conversionDetails?:unknown})=>!!payment.conversionDetails}));
vi.mock('./PaymentMotion',()=>({default:()=> <span data-testid="incoming-contours"/>}));
afterEach(cleanup);
const emit=(type:string,id='incoming-1',paymentType='receive',conversionDetails?:unknown)=>act(()=>listener?.({type,payment:{id,paymentType,status:type==='paymentPending'?'pending':type==='paymentSucceeded'?'completed':'failed',conversionDetails}} as SdkEvent));
describe('early incoming-payment indication',()=>{
 it('starts at a real pending receive and ends on that exact settlement',()=>{
  render(<IncomingPaymentNotice/>);expect(screen.queryByTestId('incoming-payment-notice')).toBeNull();
  emit('paymentPending');expect(screen.getByText('Incoming payment')).toBeInTheDocument();expect(screen.queryByText('100%')).toBeNull();
  emit('paymentSucceeded','unrelated');expect(screen.getByTestId('incoming-payment-notice')).toBeInTheDocument();
  emit('paymentSucceeded');expect(screen.queryByTestId('incoming-payment-notice')).toBeNull();
 });
 it('ignores outgoing and conversion events, allows dismissal without a wallet action',()=>{
  render(<IncomingPaymentNotice/>);emit('paymentPending','outgoing','send');emit('paymentPending','conversion','receive',{});
  expect(screen.queryByTestId('incoming-payment-notice')).toBeNull();emit('paymentPending');
  fireEvent.click(screen.getByRole('button',{name:'Dismiss incoming payment indicator'}));emit('paymentPending');
  expect(screen.queryByTestId('incoming-payment-notice')).toBeNull();
 });
 it('holds visibility while locked and clears failed receipts',()=>{
  const {rerender}=render(<IncomingPaymentNotice visible={false}/>);emit('paymentPending');
  expect(screen.queryByTestId('incoming-payment-notice')).toBeNull();rerender(<IncomingPaymentNotice/>);
  expect(screen.getByTestId('incoming-payment-notice')).toBeInTheDocument();emit('paymentFailed');expect(screen.queryByTestId('incoming-payment-notice')).toBeNull();
 });
});
