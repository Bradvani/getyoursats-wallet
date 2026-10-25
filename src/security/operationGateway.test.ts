import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk,PrepareSendPaymentResponse,ProvisionalPayment,PrepareLnurlPayResponse,SendPaymentRequest} from '@breeztech/breez-sdk-spark';
import {createOperationGateway} from './operationGateway';
import {rememberSignerIdentity,clearSignerIdentity,getSpendingRequest,finishSpendingApproval,cancelSpendingApproval,lockSpendingSession} from './spendApproval';
const seed={type:'mnemonic' as const,mnemonic:'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'};
const response=():PrepareSendPaymentResponse=>({amount:100n,feePolicy:'feesExcluded',paymentMethod:{type:'sparkAddress',address:'spark-recipient',fee:0n}});
const transfer:ProvisionalPayment={paymentId:'sdk-id',amount:100n,details:{type:'spark',payRequest:'spark-recipient'}};
function harness(override?:ProvisionalPayment[]) {
 const gate=createOperationGateway('mainnet');
 const send=vi.fn(async(_request:SendPaymentRequest)=>{await gate.observer.beforeSend(override??[transfer]);return {payment:{id:'settled'}}});
 const prepare=vi.fn(async()=>response());
 const refund=vi.fn();
 const raw={prepareSendPayment:prepare,sendPayment:send,refundDeposit:refund,getInfo:vi.fn(async()=>({balanceSats:200n}))} as unknown as BreezSdk;
 return {gate,wallet:gate.protect(raw),send,prepare,refund};
}
async function approve(){finishSpendingApproval(getSpendingRequest()!.id,true);}
beforeEach(async()=>{await rememberSignerIdentity(seed)});
afterEach(()=>{cancelSpendingApproval();clearSignerIdentity();vi.useRealTimers()});
describe('connection operation gateway',()=>{
 it('authorizes before invoking SDK and supplies its own idempotency key',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'spark-recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p,idempotencyKey:'caller-key'});
  expect(h.send).not.toHaveBeenCalled();
  expect(getSpendingRequest()?.intent).toMatchObject({Network:'mainnet',Recipient:'spark-recipient',Amount:'100 sats','Maximum quoted fee':'0 sats'});
  await approve(); await sending;
  expect(h.send).toHaveBeenCalledOnce();
  expect(h.send.mock.calls[0][0].idempotencyKey).not.toBe('caller-key');
  expect(h.send.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
 });
 it('rejects an old connection after another signer is selected',async()=>{
  const h=harness();await rememberSignerIdentity({...seed,mnemonic:'different disposable fixture'});
  await expect(h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}})).rejects.toThrow(/connection identity changed/);
  expect(h.prepare).not.toHaveBeenCalled();
 });
 it('an observer permit cannot be reused inside the same SDK execution',async()=>{
  const h=harness();h.send.mockImplementationOnce(async()=>{
   await h.gate.observer.beforeSend([transfer]);
   await expect(h.gate.observer.beforeSend([transfer])).rejects.toThrow(/single-use/);
   return {payment:{id:'settled'}};
  });
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});await approve();await sending;
 });
 it('cancellation prevents the SDK call and consumes the prepared transaction',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p}); const rejected=expect(sending).rejects.toThrow(/cancelled/);
  cancelSpendingApproval();await rejected;expect(h.send).not.toHaveBeenCalled();
  await expect(h.wallet.sendPayment({prepareResponse:p})).rejects.toThrow(/Prepare a new/);
 });
 it('rejects fabricated and cloned preparation responses',async()=>{
  const h=harness();await expect(h.wallet.sendPayment({prepareResponse:response()})).rejects.toThrow(/Prepare a new/);
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  await expect(h.wallet.sendPayment({prepareResponse:{...p}})).rejects.toThrow(/Prepare a new/);
  expect(h.send).not.toHaveBeenCalled();
 });
 it('cannot mutate the prepared destination or fee',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  expect(()=>{p.amount=900n}).toThrow();
  expect(()=>{Object.assign(p.paymentMethod,{address:'attacker',fee:900n})}).toThrow();
 });
 it('rejects concurrent duplicate submissions before SDK execution',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const first=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(first).rejects.toThrow(/cancelled/);
  await expect(h.wallet.sendPayment({prepareResponse:p})).rejects.toThrow(/in progress/);
  cancelSpendingApproval();await rejected;expect(h.send).not.toHaveBeenCalled();
 });
 it.each([
  {...transfer,amount:101n},
  {...transfer,details:{type:'spark' as const,payRequest:'attacker'}},
 ])('observer vetoes changed execution details %#',async bad=>{
  const h=harness([bad]),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/differs/);
  await approve();await rejected;
 });
 it('observer rejects autonomous transfers with no approved operation',async()=>{
  await expect(harness().gate.observer.beforeSend([transfer])).rejects.toThrow(/No single-use/);
 });
 it('background lock during approval prevents SDK execution',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/backgrounded/);
  lockSpendingSession('backgrounded');await rejected;expect(h.send).not.toHaveBeenCalled();
 });
 it('lock immediately after approval prevents SDK execution',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/session changed/);
  finishSpendingApproval(getSpendingRequest()!.id,true);lockSpendingSession();
  await rejected;expect(h.send).not.toHaveBeenCalled();
 });
 it('rejects expired preparations even when the timeout callback is delayed',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000);
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  vi.setSystemTime(62000);await expect(h.wallet.sendPayment({prepareResponse:p})).rejects.toThrow(/expired/);
  expect(h.send).not.toHaveBeenCalled();
 });
 it('rechecks preparation expiry after approval',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000);
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/expired during approval/);
  vi.setSystemTime(62000);await approve();await rejected;expect(h.send).not.toHaveBeenCalled();
 });
 it.each(['refundDeposit','recoverFunds','getTokenIssuer','createTokenAllowance','pullPayment','sendBatch','publishSignedTransferPackage','signMessage','updateUserSettings','futureSpendMethod'])('denies unreviewed capability %s',method=>{
  const h=harness();expect(()=>Reflect.get(h.wallet,method)({})).toThrow(/unavailable pending/);expect(h.refund).not.toHaveBeenCalled();
 });
 it('does not expose SDK through prototype or property mutation',()=>{
  const h=harness();expect(Object.getPrototypeOf(h.wallet)).toBeNull();expect(Object.keys(h.wallet)).toEqual([]);
  expect(()=>Object.defineProperty(h.wallet,'sendPayment',{value:()=>{}})).toThrow();
  expect(()=>Object.setPrototypeOf(h.wallet,{})).toThrow();
 });
 it('denies unsupported payment routes before approval or SDK execution',async()=>{
  const h=harness();h.prepare.mockResolvedValueOnce({...response(),tokenIdentifier:'token'});
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  await expect(h.wallet.sendPayment({prepareResponse:p})).rejects.toThrow(/additional review/);
  expect(getSpendingRequest()).toBeNull();expect(h.send).not.toHaveBeenCalled();
 });
 it('Bitcoin approval binds address, chosen fee, speed and quote ID',async()=>{
  const h=harness([{paymentId:'bitcoin',amount:100n,details:{type:'bitcoin',withdrawalAddress:'bc1-test'}}]);
  h.prepare.mockResolvedValueOnce({amount:100n,feePolicy:'feesExcluded',paymentMethod:{type:'bitcoinAddress',
   address:{address:'bc1-test',network:'bitcoin',source:{}},feeQuote:{id:'quote-1',expiresAt:Date.now()/1000+300,isEstimate:false,
    speedFast:{userFeeSat:5,l1BroadcastFeeSat:3},speedMedium:{userFeeSat:3,l1BroadcastFeeSat:2},speedSlow:{userFeeSat:2,l1BroadcastFeeSat:1}}}});
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'bc1-test'}});
  const sending=h.wallet.sendPayment({prepareResponse:p,options:{type:'bitcoinAddress',confirmationSpeed:'medium'}});
  expect(getSpendingRequest()?.intent).toMatchObject({Recipient:'bc1-test','Maximum quoted fee':'5 sats','Confirmation speed':'medium','Quote ID':'quote-1'});
  await approve();await sending;
 });
 it('LNURL binds resolved invoice, contact, amount, fees and comment',async()=>{
  const gate=createOperationGateway('mainnet');
  const p={amountSats:100,feeSats:2,feePolicy:'feesExcluded',comment:'hello',payRequest:{domain:'recipient.example'},invoiceDetails:{invoice:{bolt11:'lnbc-test'},network:'bitcoin',timestamp:Date.now()/1000,expiry:3600}} as PrepareLnurlPayResponse;
  const send=vi.fn(async()=>{await gate.observer.beforeSend([{...transfer,details:{type:'lightning',invoice:'lnbc-test'}}]);return {payment:{id:'ok'}}});
  const wallet=gate.protect({prepareLnurlPay:async()=>p,lnurlPay:send} as unknown as BreezSdk);
  const prep=await wallet.prepareLnurlPay({} as never);const sending=wallet.lnurlPay({prepareResponse:prep});
  expect(send).not.toHaveBeenCalled();expect(getSpendingRequest()?.intent).toMatchObject({Recipient:'recipient.example',Invoice:'lnbc-test','Maximum debit':'102 sats',Comment:'hello'});
  await approve();await sending;expect(send).toHaveBeenCalledOnce();
 });
});
