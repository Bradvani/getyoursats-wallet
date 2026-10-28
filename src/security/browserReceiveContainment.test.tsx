import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import type {BreezSdk,LightningAddressInfo,Payment} from '@breeztech/breez-sdk-spark';
import type {ReactNode} from 'react';
import {WalletProvider} from '../contexts/WalletContext';
import {ToastProvider} from '../contexts/ToastContext';
import {FiatDataProvider} from '../contexts/FiatDataContext';
import {StableBalanceProvider} from '../contexts/StableBalanceContext';
import {ContactsProvider} from '../contexts/ContactsContext';
import PaymentDetailsDialog from '../components/PaymentDetailsDialog';
import {ArchivedExitDialog} from '../features/unilateral-exit/ArchivedExitDialog';
import {createMockClient} from '../test/mocks/mockWalletApi';
import {waitForSheetOpen} from '../test/utils/waitForSheetOpen';
import ReceivePaymentDialog from '../features/receive/ReceivePaymentDialog';
import PosPage from '../getyoursats/PosPage';
import {readPosOrders,savePosOrders,type PosOrder} from '../getyoursats/posLedger';
import {BROWSER_SPENDING_POLICY} from './browserReleasePolicy';
import {DEPOSIT_CLAIMS} from './depositClaimController';

const identity='02'+'11'.repeat(32);
const name:LightningAddressInfo={username:'savedname',lightningAddress:'savedname@getyoursats.com',description:'Saved name',
 lnurl:{bech32:'lnurl1savednamefixture',url:'https://getyoursats.com/lnurlp/savedname'}};
function client(){
 const sdk=createMockClient({getLightningAddress:vi.fn().mockResolvedValue(name),
  getInfo:vi.fn().mockResolvedValue({identityPubkey:identity,balanceSats:0n,tokenBalances:new Map()})});
 Reflect.set(sdk,BROWSER_SPENDING_POLICY,true);
 return sdk;
}
function view(sdk:BreezSdk,children:ReactNode){
 return render(<ToastProvider><WalletProvider client={sdk} isConnected><FiatDataProvider><StableBalanceProvider>
  {children}
 </StableBalanceProvider></FiatDataProvider></WalletProvider></ToastProvider>);
}
const order=():PosOrder=>({id:'saved-order',invoice:'lnbc1'+'q'.repeat(50),amountSats:100,unit:'sats',description:'Saved receipt',
 createdAt:Date.now(),feeSats:0,originalAmount:'100',expiresAt:Date.now()+3_600_000});

describe('browser receive containment',()=>{
 it('does not offer a saved Lightning name or prewarm an unclaimable Bitcoin address, and keeps direct Spark usable',async()=>{
  const sdk=client();view(sdk,<ReceivePaymentDialog isOpen onClose={vi.fn()}/>);
  await waitForSheetOpen();
  expect(await screen.findByText(/Lightning receiving is unavailable/)).toBeInTheDocument();
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
  expect(sdk.getLightningAddress).toHaveBeenCalled();
  expect(sdk.receivePayment).not.toHaveBeenCalled();
  expect(screen.queryByTestId('lightning-address-text')).toBeNull();
  expect(screen.queryByTestId('show-amount-panel-button')).toBeNull();
  expect(screen.queryByText(name.lightningAddress)).toBeNull();
  fireEvent.click(screen.getByTestId('bitcoin-tab'));
  expect(await screen.findByText(/Bitcoin receiving is unavailable/)).toBeInTheDocument();
  expect(screen.queryByTestId('bitcoin-address-text')).toBeNull();
  expect(sdk.receivePayment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('direct-spark-receive-entry'));
  const panel=await screen.findByTestId('direct-spark-receive-panel');
  expect(await within(panel).findByTestId('spark-address-text')).toBeInTheDocument();
  expect(sdk.receivePayment).toHaveBeenCalledExactlyOnceWith({paymentMethod:{type:'sparkAddress'}});
 });
 it('retains an explicitly exposed regtest deposit receive capability with a valueless-funds label and no automatic claim',async()=>{
  const sdk=client(),claim=vi.fn();
  Reflect.set(sdk,DEPOSIT_CLAIMS,{list:vi.fn(),reconcile:vi.fn(),claim});
  view(sdk,<ReceivePaymentDialog isOpen onClose={vi.fn()}/>);
  await waitForSheetOpen();
  fireEvent.click(await screen.findByTestId('bitcoin-tab'));
  expect(await screen.findByText(/valueless test funds only/)).toBeInTheDocument();
  expect(await screen.findByTestId('bitcoin-address-text')).toBeInTheDocument();
  expect(vi.mocked(sdk.receivePayment).mock.calls.every(([request])=>request.paymentMethod.type==='bitcoinAddress')).toBe(true);
  expect(claim).not.toHaveBeenCalled();
 });
 it('blocks new merchant charges before an invoice request or a fiat refresh',async()=>{
  const sdk=client();view(sdk,<PosPage onClose={vi.fn()}/>);
  expect(await screen.findByText(/Lightning receiving is unavailable/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'1'}));
  const charge=screen.getByRole('button',{name:'Charge'});
  expect(charge).toBeDisabled();fireEvent.click(charge);
  expect(sdk.receivePayment).not.toHaveBeenCalled();
 });
 it.each([false,true])('preserves merchant records but refuses cached receipts without a live provider observer (completed=%s)',async completed=>{
  const sdk=client(),saved=order();expect(savePosOrders(identity,[saved])).toBe(true);
  if(completed)vi.mocked(sdk.listPayments).mockResolvedValue({payments:[{id:'receipt',paymentType:'receive',status:'completed',
   amount:100n,fees:0n,timestamp:Math.floor(Date.now()/1000),method:'lightning',details:{type:'lightning',invoice:saved.invoice}} as Payment]});
  view(sdk,<PosPage onClose={vi.fn()}/>);
  await waitFor(()=>expect(sdk.getInfo).toHaveBeenCalled());
  // Without our explicit provider observer the guarded wallet must not
  // elevate cached completed records into a merchant settlement claim.
  expect(sdk.listPayments).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Payment history'}));
  const record=await screen.findByRole('button',{name:/100 sats · Saved receipt/});
  fireEvent.click(record);
  await screen.findByText(/expires:/i);
  expect(screen.queryByText('Payment received')).toBeNull();
  expect(screen.getByText('Payment has not been verified')).toBeInTheDocument();
  expect(screen.queryByTestId('pos-invoice-qr')).toBeNull();
  expect(screen.queryByRole('button',{name:'Copy invoice'})).toBeNull();
  expect(screen.queryByText('Scan to pay')).toBeNull();
  expect(readPosOrders(identity)).toEqual([saved]);
  expect(sdk.receivePayment).not.toHaveBeenCalled();
 });
 it.each(['pending','completed'] as const)('keeps payment details while withholding an unresolved incoming invoice (status=%s)',async status=>{
  const sdk=client(),saved=order();
  const payment={id:'stored-payment',paymentType:'receive',status,amount:100n,fees:0n,
   timestamp:Math.floor(Date.now()/1000),method:'lightning',details:{type:'lightning',invoice:saved.invoice}} as Payment;
  view(sdk,<ContactsProvider><PaymentDetailsDialog optionalPayment={payment} onClose={vi.fn()}/></ContactsProvider>);
  await waitForSheetOpen();
  if(status==='pending'){
   expect(screen.getByText(/Lightning receiving is unavailable/)).toBeInTheDocument();
   expect(screen.queryByRole('button',{name:'Invoice'})).toBeNull();
  }else{
   fireEvent.click(screen.getByRole('button',{name:'Invoice'}));
   expect(await screen.findByText(saved.invoice)).toBeInTheDocument();
  }
  expect(payment.details).toEqual({type:'lightning',invoice:saved.invoice});
  expect(sdk.receivePayment).not.toHaveBeenCalled();
 });
 it('keeps an archived exit fee address as receipt evidence with an explicit no-funding warning',async()=>{
  const sdk=client(),exit={id:'ab'.repeat(32),destination:'bcrt1saved-destination',deliveredSat:100,
   completedAt:Date.now(),exitFeeAddress:'bcrt1saved-fee-address'};
  view(sdk,<ArchivedExitDialog exit={exit} onClose={vi.fn()} fundingUnavailable/>);
  await waitForSheetOpen();
  expect(screen.getByText(/Do not send additional bitcoin to this fee address/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Exit Fee Address'}));
  expect(await screen.findByText(exit.exitFeeAddress)).toBeInTheDocument();
  expect(sdk.receivePayment).not.toHaveBeenCalled();
 });
});
