import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {GetInfoResponse,TokenMetadata} from '@breeztech/breez-sdk-spark';
import StableBalanceToggleFlow from './StableBalanceToggleFlow';
import StableBalanceSettings from './StableBalanceSettings';
import {USDB_TOKEN_IDENTIFIER} from '../constants/stableBalance';
const mock=vi.hoisted(()=>({toggle:vi.fn(),getInfo:vi.fn(),getSettings:vi.fn(),metadata:vi.fn(),refresh:vi.fn(),receive:vi.fn(),prepare:vi.fn(),label:null as string|null}));
vi.mock('../contexts/WalletContext',()=>({useWallet:()=>({getInfo:mock.getInfo,getUserSettings:mock.getSettings,getTokensMetadata:mock.metadata,receivePayment:mock.receive,prepareSendPayment:mock.prepare})}));
vi.mock('../contexts/StableBalanceContext',()=>({useStableBalance:()=>({toggleStableBalance:mock.toggle,activeLabel:mock.label,isActive:mock.label==='USDB',displayConfig:null,isToggling:false})}));
vi.mock('../contexts/FiatDataContext',()=>({useFiatData:()=>({refreshFiatData:mock.refresh})}));
vi.mock('../hooks/usePresentation',()=>({usePresentation:()=>({language:'en'})}));
const balance=(sats=100000,token=0n)=>({balanceSats:sats,tokenBalances:new Map([[USDB_TOKEN_IDENTIFIER,{balance:token}]])} as GetInfoResponse);
const metadata={identifier:USDB_TOKEN_IDENTIFIER,ticker:'USDB',decimals:6,name:'US Dollar'} as TokenMetadata;
beforeEach(()=>{
 vi.resetAllMocks();mock.label=null;Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 mock.getInfo.mockResolvedValue(balance());mock.getSettings.mockResolvedValue({stableBalanceActiveLabel:null});
 mock.metadata.mockResolvedValue({tokensMetadata:[metadata]});mock.refresh.mockImplementation(async()=>({fiatRates:[{coin:'USD',value:100000}],fiatCurrencies:[],fetchedAt:Date.now()}));
 mock.receive.mockResolvedValue({paymentRequest:'spark-test-self'});
 mock.prepare.mockResolvedValue({conversionEstimate:{amountIn:100000n,amountOut:99000000n,fee:1000000n,options:{conversionType:{type:'fromBitcoin'}}}});
 mock.toggle.mockResolvedValue(undefined);
});
afterEach(()=>{cleanup();vi.useRealTimers();});
function renderFlow(direction:'toToken'|'toBitcoin'='toToken'){
 const onComplete=vi.fn(),onCancel=vi.fn();render(<StableBalanceToggleFlow isOpen direction={direction} onComplete={onComplete} onCancel={onCancel}/>);return {onComplete,onCancel};
}
async function review(){fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Review estimated cost'}));await screen.findByTestId('stable-mode-review');await waitFor(()=>expect(screen.getByRole('button',{name:'Confirm balance mode'})).toBeEnabled());}
describe('intentional USDB conversion',()=>{
 it('never quotes or converts on mount, even after an earlier disclaimer was accepted',()=>{
  localStorage.setItem('stable_balance_disclaimer_accepted','true');renderFlow();
  expect(screen.getByText(/Switching back does not refund/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Review estimated cost'})).toBeDisabled();
  expect(mock.getInfo).not.toHaveBeenCalled();expect(mock.toggle).not.toHaveBeenCalled();
 });
 it('cancel leaves the wallet untouched',()=>{const {onCancel}=renderFlow();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(onCancel).toHaveBeenCalledOnce();expect(mock.toggle).not.toHaveBeenCalled();});
 it('reviews the estimate before an explicit mode change',async()=>{
  const {onComplete}=renderFlow();await review();expect(screen.getByText('Estimated conversion fee')).toBeInTheDocument();expect(mock.toggle).not.toHaveBeenCalled();
  expect(screen.getByTestId('stable-estimate-amounts')).toHaveTextContent('100 000 sats');
  expect(screen.getByText(/not necessarily your whole balance/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Confirm balance mode'}));await waitFor(()=>expect(mock.toggle).toHaveBeenCalledExactlyOnceWith('USDB'));expect(onComplete).toHaveBeenCalledOnce();
 });
 it.each(['provider error','no quote','stale rate'])('fails closed on %s',async problem=>{
  if(problem==='provider error')mock.prepare.mockRejectedValue(new Error('provider down'));
  if(problem==='no quote')mock.prepare.mockResolvedValue({});
  if(problem==='stale rate')mock.refresh.mockResolvedValue({fiatRates:[{coin:'USD',value:100000}],fiatCurrencies:[],fetchedAt:1});
  renderFlow();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Review estimated cost'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed');expect(screen.getByRole('button',{name:'Confirm balance mode'})).toBeDisabled();expect(mock.toggle).not.toHaveBeenCalled();
 });
 it('rechecks a changed balance and refuses a stale approval',async()=>{
  renderFlow();await review();mock.getInfo.mockResolvedValue(balance(200000));fireEvent.click(screen.getByRole('button',{name:'Confirm balance mode'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Review a new estimate');expect(mock.toggle).not.toHaveBeenCalled();
 });
 it('refuses a hidden-page confirmation',async()=>{
  renderFlow();await review();Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});fireEvent.click(screen.getByRole('button',{name:'Confirm balance mode'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Review a new estimate');expect(mock.toggle).not.toHaveBeenCalled();
 });
 it('rejects an expired review at execution, not only in the UI',async()=>{
  renderFlow();await review();const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+61000);
  fireEvent.click(screen.getByRole('button',{name:'Confirm balance mode'}));expect(mock.toggle).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Review a new estimate');clock.mockRestore();
 });
 it('an empty-wallet preference still warns about future conversions and fees',async()=>{
  mock.getInfo.mockResolvedValue(balance(0));renderFlow();await review();expect(screen.getByText(/future eligible conversions/)).toBeInTheDocument();expect(mock.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Confirm balance mode'}));await waitFor(()=>expect(mock.toggle).toHaveBeenCalledExactlyOnceWith('USDB'));
 });
 it('warns and reviews again when converting USDB back to Bitcoin',async()=>{
  mock.label='USDB';mock.getSettings.mockResolvedValue({stableBalanceActiveLabel:'USDB'});mock.getInfo.mockResolvedValue(balance(0,100000000n));
  mock.prepare.mockResolvedValue({conversionEstimate:{amountIn:100000000n,amountOut:99000n,fee:1000000n,options:{conversionType:{type:'toBitcoin',fromTokenIdentifier:USDB_TOKEN_IDENTIFIER}}}});
  renderFlow('toBitcoin');expect(screen.getByText(/Switching back does not refund/)).toBeInTheDocument();await review();fireEvent.click(screen.getByRole('button',{name:'Confirm balance mode'}));await waitFor(()=>expect(mock.toggle).toHaveBeenCalledExactlyOnceWith(null));
 });
 it('keeps a failed mode change open without claiming completion',async()=>{
  mock.toggle.mockRejectedValue(new Error('settings unavailable'));const {onComplete}=renderFlow();await review();fireEvent.click(screen.getByRole('button',{name:'Confirm balance mode'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Check the current mode and History');expect(onComplete).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Confirm balance mode'})).toBeDisabled();
 });
 it('does not double-submit a mode change',async()=>{
  let done!:()=>void;mock.toggle.mockImplementation(()=>new Promise<void>(r=>{done=r}));renderFlow();await review();const button=screen.getByRole('button',{name:'Confirm balance mode'});fireEvent.click(button);fireEvent.click(button);
  await waitFor(()=>expect(mock.toggle).toHaveBeenCalledOnce());await act(async()=>done());
 });
 it('Settings exposes a review action, not a conversion switch',()=>{
  mock.label='USDB';render(<StableBalanceSettings/>);expect(screen.getByText('USDB dollar balance')).toBeInTheDocument();expect(screen.queryByRole('switch')).toBeNull();expect(mock.toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Review conversion to Bitcoin'}));expect(screen.getByTestId('stable-mode-warning')).toBeInTheDocument();expect(mock.getInfo).not.toHaveBeenCalled();
 });
});
