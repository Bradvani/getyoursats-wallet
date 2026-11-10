import type {ReactNode} from 'react';
import {beforeEach, afterEach, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import RampnowBuyDialog from './RampnowBuyDialog';
import {RAMPNOW_PREVIEW_ORIGIN} from './rampnowPurchase';

const mocks=vi.hoisted(()=>({receivePayment:vi.fn(),parse:vi.fn(),signMessage:vi.fn(),availability:vi.fn(),prepare:vi.fn(),submit:vi.fn(),reconcile:vi.fn(),open:vi.fn()}));
vi.mock('../../contexts/WalletContext',()=>({useWallet:()=>mocks}));
vi.mock('../../utils/externalLink',()=>({openExternalUrl:mocks.open}));
vi.mock('../../services/rampnow',async importOriginal=>({...await importOriginal<object>(),createRampnowBrowserClient:()=>mocks}));
vi.mock('../../components/ui',()=>({
  BottomSheetContainer:({children}:{children:ReactNode})=><div>{children}</div>,
  BottomSheetCard:({children}:{children:ReactNode})=><div>{children}</div>,
  DialogHeader:({title}:{title:string})=><h1>{title}</h1>,
  FormError:({error}:{error:string})=><p role="alert">{error}</p>,
  PrimaryButton:({children,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>)=><button {...props}>{children}</button>,
  SecondaryButton:({children,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>)=><button {...props}>{children}</button>,
}));
const pub='02'+'a'.repeat(64),id='12345678-1234-4234-9234-123456789abc';
const completed={externalOrderUid:id,phase:'bound',orderUid:'p1',checkoutUrl:'https://app.sandbox.rampnow.io/checkout',providerStatus:'completed',dstFillAmount:'0.0001',needsReconciliation:true,walletReceiptVerified:false};
beforeEach(()=>{
  vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('location',new URL(RAMPNOW_PREVIEW_ORIGIN));
  mocks.availability.mockResolvedValue({available:true});
  mocks.receivePayment.mockResolvedValue({paymentRequest:'tb1qfromwallet',fee:42n});
  mocks.parse.mockResolvedValue({type:'bitcoinAddress',network:'signet',address:'tb1qfromwallet'});
  mocks.prepare.mockImplementation(async input=>({externalOrderUid:id,quoteHash:'ab'.repeat(32),expiresAt:Date.now()+120000,
    destination:input.destination,network:'signet',quote:{srcCurrency:'INR',srcAmount:'1000',dstAmount:'0.0001',paymentMode:'card',feeDetails:[
      {type:'platform',fee:'20',currency:'INR',isInclusive:true},{type:'network',fee:'1',currency:'USDT',isInclusive:false}]}}));
  mocks.submit.mockResolvedValue({...completed,providerStatus:'created'});mocks.reconcile.mockResolvedValue(completed);mocks.open.mockResolvedValue(undefined);
});
afterEach(()=>vi.unstubAllGlobals());
function open(returnIntent?:string){return render(<RampnowBuyDialog walletPubkey={pub} network="signet" returnIntent={returnIntent} onClose={vi.fn()}/>);}
async function fill(){
  fireEvent.change(await screen.findByLabelText('Amount (INR)'),{target:{value:'1000'}});
  for(const [label,value]of [['First name','Test'],['Last name','Buyer'],['Email','test@example.invalid'],['Phone with country code','+447700900123'],['Date of birth','1990-01-01']]) fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'Review purchase'}));
  await screen.findByRole('region',{name:'Purchase review'});
}
it('does not collect profile or request an address when the server is unavailable',async()=>{
  mocks.availability.mockResolvedValue({available:false});open();
  await screen.findByText(/Bitcoin purchases are currently unavailable/);
  expect(screen.queryByLabelText('First name')).toBeNull();expect(mocks.receivePayment).not.toHaveBeenCalled();
});
it('binds the wallet destination and shows fees before a single explicit submission',async()=>{
  open();await fill();
  expect(mocks.receivePayment).toHaveBeenCalledWith({paymentMethod:{type:'bitcoinAddress',newAddress:true}});
  expect(mocks.prepare.mock.calls[0][0].destination).toBe('tb1qfromwallet');
  expect(screen.getByText('20 INR (included)')).toBeInTheDocument();expect(screen.getByText('1 USDT (additional)')).toBeInTheDocument();
  expect(screen.getByText('42 sats')).toBeInTheDocument();
  const button=screen.getByRole('button',{name:'Create checkout'});expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);
  await screen.findByRole('button',{name:'Continue to secure checkout'});
  expect(mocks.submit).toHaveBeenCalledTimes(1);expect(mocks.open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Continue to secure checkout'}));
  expect(mocks.open).toHaveBeenCalledWith(completed.checkoutUrl);
});
it('reload and provider return reconcile without creating or claiming receipt',async()=>{
  open(id);fireEvent.click(await screen.findByRole('button',{name:'Check purchase status'}));
  await screen.findByText(/Bitcoin receipt in your wallet is still unverified/);
  expect(mocks.reconcile).toHaveBeenCalledWith(id);expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Continue to secure checkout'})).toBeNull();
});
it('uncertain submission removes the submit action and preserves recovery',async()=>{
  mocks.submit.mockRejectedValue(new Error('lost response'));open();await fill();
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Create checkout'}));
  await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Create checkout'})).toBeNull();
  expect(screen.getByRole('button',{name:'Check purchase status'})).toBeEnabled();
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it('refuses a different network destination before signing a purchase',async()=>{
  mocks.parse.mockResolvedValue({type:'bitcoinAddress',network:'bitcoin',address:'bc1qwrong'});open();
  fireEvent.change(await screen.findByLabelText('Amount (INR)'),{target:{value:'1000'}});
  fireEvent.submit(screen.getByRole('button',{name:'Review purchase'}).closest('form')!);
  await waitFor(()=>expect(screen.getByRole('alert')).toBeInTheDocument());expect(mocks.prepare).not.toHaveBeenCalled();
});
it('recovers an unsubmitted saved quote with a new intent while retaining the old reference',async()=>{
  const unsubmitted={...completed,phase:'prepared',orderUid:null,checkoutUrl:null,providerStatus:null,dstFillAmount:null,reconciliation:'not_submitted'};
  mocks.reconcile.mockResolvedValue(unsubmitted);
  const nextId='22345678-1234-4234-9234-123456789abc';
  const originalPrepare=mocks.prepare.getMockImplementation()!;
  mocks.prepare.mockImplementation(async input=>({...await originalPrepare(input),externalOrderUid:nextId}));
  open(id);fireEvent.click(await screen.findByRole('button',{name:'Check purchase status'}));
  fireEvent.click(await screen.findByRole('button',{name:'Review a new quote'}));
  await fill();
  const refs=JSON.parse(localStorage.getItem('gys:rampnow:sandbox:signet:v1:'+pub)!);
  expect(refs.map((row:{id:string})=>row.id)).toEqual([nextId,id]);
  expect(mocks.reconcile).toHaveBeenCalledTimes(2);expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Create checkout'}));
  await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(mocks.submit.mock.calls[0][0].externalOrderUid).toBe(nextId);
});
it.each(['not_found','mismatch','ambiguous'])('does not reopen checkout or allow a fresh quote after %s reconciliation',async reconciliation=>{
  mocks.reconcile.mockResolvedValue({...completed,providerStatus:'created',reconciliation});
  open(id);fireEvent.click(await screen.findByRole('button',{name:'Check purchase status'}));
  await waitFor(()=>expect(mocks.reconcile).toHaveBeenCalledWith(id));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check purchase status'})).toBeEnabled());
  expect(screen.queryByRole('button',{name:'Continue to secure checkout'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Review a new quote'})).toBeNull();expect(mocks.open).not.toHaveBeenCalled();
});
it('does not reopen checkout during provider processing',async()=>{
  mocks.reconcile.mockResolvedValue({...completed,providerStatus:'processing',reconciliation:'matched'});
  open(id);fireEvent.click(await screen.findByRole('button',{name:'Check purchase status'}));
  await waitFor(()=>expect(mocks.reconcile).toHaveBeenCalledWith(id));
  expect(screen.queryByRole('button',{name:'Continue to secure checkout'})).toBeNull();
});
it('hides old wallet checkout controls and history immediately on an owner change',async()=>{
  mocks.reconcile.mockResolvedValue({...completed,providerStatus:'created',reconciliation:'matched'});
  const view=open(id);fireEvent.click(await screen.findByRole('button',{name:'Check purchase status'}));
  await screen.findByRole('button',{name:'Continue to secure checkout'});
  let resolve!: (value:{available:boolean})=>void;
  mocks.availability.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  view.rerender(<RampnowBuyDialog walletPubkey={'03'+'b'.repeat(64)} network="signet" onClose={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Continue to secure checkout'})).toBeNull();
  expect(screen.queryByRole('region',{name:'Saved purchases'})).toBeNull();
  resolve({available:true});await screen.findByLabelText('Amount (INR)');
  expect(screen.queryByText('Reference: '+id)).toBeNull();expect(mocks.open).not.toHaveBeenCalled();
});
it('reports hosted-browser failure without creating another checkout',async()=>{
  mocks.open.mockRejectedValue(new Error('browser unavailable'));
  open();await fill();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Create checkout'}));
  fireEvent.click(await screen.findByRole('button',{name:'Continue to secure checkout'}));
  await screen.findByRole('alert');expect(mocks.submit).toHaveBeenCalledTimes(1);
});
