import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import PaymentFiatAmount from './PaymentFiatAmount';
import PaymentCelebration from './PaymentCelebration';
import ConfirmStep from '../features/send/steps/ConfirmStep';
import ResultStep from '../features/send/steps/ResultStep';
import {formatPaymentFiat} from '../getyoursats/paymentFiat';
const state=vi.hoisted(()=>({currency:'INR',fetchedAt:0,rates:[{coin:'INR',value:9000000},{coin:'USD',value:100000},{coin:'EUR',value:90000},{coin:'JPY',value:15000000}]}));
vi.mock('../contexts/FiatDataContext',()=>({useFiatData:()=>({fiatRates:state.rates,fiatCurrencies:[],fetchedAt:state.fetchedAt})}));
vi.mock('../contexts/StableBalanceContext',()=>({useStableBalance:()=>({isActive:false,displayConfig:null})}));
vi.mock('../services/settings',()=>({getDisplayFiatCurrency:()=>state.currency}));
vi.mock('../hooks/usePresentation',()=>({usePresentation:()=>({language:'en'})}));
vi.mock('../utils/transferHaptics',()=>({notifyPaymentFeedback:vi.fn()}));
const receipt=(direction:'send'|'receive',amount=27n)=>({id:`fiat-${direction}`,paymentType:direction,status:'completed',method:'lightning',amount,fees:0n,timestamp:1700000000} as Payment);
beforeEach(()=>{state.currency='INR';state.fetchedAt=Date.now();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('indicative fiat display',()=>{
 it('uses Indian grouping for INR and preserves minor-unit precision',()=>{expect(formatPaymentFiat(100000000n,9000000,'INR','en')).toBe('₹90,00,000.00');expect(formatPaymentFiat(27n,9000000,'INR','en')).toBe('₹2.43');});
 it('handles zero-decimal and three-decimal currencies',()=>{expect(formatPaymentFiat(900n,15000000,'JPY','ja')).toBe('￥135');expect(formatPaymentFiat(100000000n,1.234,'KWD','en')).toContain('1.234');});
 it('does not make a positive sub-cent payment look like zero',()=>{expect(formatPaymentFiat(1n,90000,'USD','en')).toBe('< $0.01');});
 it.each([undefined,0,-1,Infinity,NaN])('refuses missing or invalid rates %s',rate=>{expect(formatPaymentFiat(900n,rate,'INR','en')).toBeNull();});
 it('refuses unsafe or invalid atomic amounts',()=>{expect(formatPaymentFiat(1.5,90000,'USD','en')).toBeNull();expect(formatPaymentFiat(-1n,90000,'USD','en')).toBeNull();expect(formatPaymentFiat(9007199254740993n,90000,'USD','en')).toBeNull();});
 it('uses the selected currency and reacts to a preference change',()=>{render(<PaymentFiatAmount sats={900n}/>);expect(screen.getByTestId('payment-fiat-amount')).toHaveTextContent('≈ ₹81.00 INR');act(()=>{state.currency='JPY';window.dispatchEvent(new Event('gys:fiat-pref-changed'));});expect(screen.getByTestId('payment-fiat-amount')).toHaveTextContent('≈ ¥135 JPY');});
 it('never silently substitutes USD for a missing preferred rate',()=>{state.currency='CHF';render(<PaymentFiatAmount sats={900n}/>);expect(screen.getByTestId('payment-fiat-amount')).toHaveTextContent('CHF · Rate unavailable');expect(screen.queryByText(/USD|\$/)).toBeNull();});
 it('does not price a payment from stale cached rates',()=>{state.fetchedAt=Date.now()-180000;render(<PaymentFiatAmount sats={900n}/>);expect(screen.getByTestId('payment-fiat-amount')).toHaveAttribute('data-rate-available','false');});
 it('never interprets token base units as satoshis',()=>{const payment={...receipt('receive',1000000n),details:{type:'token',metadata:{ticker:'USDC',decimals:6}}} as Payment;render(<PaymentFiatAmount payment={payment}/>);expect(screen.queryByTestId('payment-fiat-amount')).toBeNull();});
});
describe('payment money hierarchy and values',()=>{
 it.each([false,true])('prices the actual total deducted with feesIncluded=%s',feesIncluded=>{render(<ConfirmStep amountSats={900n} feesSat={5} feesIncluded={feesIncluded} balanceSats={10000} error={null} isLoading={false} onConfirm={()=>{}}/>);expect(screen.getByTestId('payment-fiat-amount')).toHaveTextContent(feesIncluded?'≈ ₹81.00 INR':'≈ ₹81.45 INR');expect(screen.getByTestId('send-confirm-button')).toBeEnabled();});
 it.each(['send','receive'] as const)('puts the %s receipt amount and fiat before progress, without the disclaimer',direction=>{
  vi.useFakeTimers();render(<PaymentCelebration payment={receipt(direction)} onClose={()=>{}}/>);act(()=>{vi.advanceTimersByTime(60)});
  const amount=screen.getByTestId('transfer-amount'),fiat=screen.getByTestId('payment-fiat-amount'),progress=screen.getByRole('progressbar');
  expect(amount).toHaveTextContent('27 sats');expect(fiat).toHaveTextContent('≈ ₹2.43 INR');
  expect(amount.compareDocumentPosition(fiat)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(fiat.compareDocumentPosition(progress)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(progress).toHaveAttribute('aria-valuenow','100');expect(screen.queryByText(/elapsed time|funds settled/)).toBeNull();expect(progress.getAttribute('aria-valuetext')).not.toMatch(/elapsed|funds settled/);
 });
 it('also prices the fallback completed send receipt',()=>{render(<ResultStep result="success" error={null} onClose={()=>{}} payment={receipt('send',900n)}/>);expect(screen.getByTestId('payment-fiat-amount')).toHaveTextContent('≈ ₹81.00 INR');});
});
