import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {BreezSdk,InputType,ReceivePaymentResponse} from '@breeztech/breez-sdk-spark';
import {createStandardRegtestInvoiceIssuer} from './regtestStandardInvoice';

const identity='02'+'11'.repeat(32),hash='aa'.repeat(32),invoice='lnbcrt1'+'q'.repeat(95);
const now=()=>Math.floor(Date.now()/1000);
function harness(network:'regtest'|'mainnet'|'signet'='regtest'){
 let current=true;
 const getInfo=vi.fn(async()=>({identityPubkey:identity}));
 const receivePayment=vi.fn(async():Promise<ReceivePaymentResponse>=>({paymentRequest:invoice,fee:0n}));
 const parse=vi.fn(async():Promise<InputType>=>({type:'bolt11Invoice',amountMsat:100000,description:'Disposable regtest test',
  expiry:600,network:'regtest',timestamp:now(),paymentHash:hash,payeePubkey:identity,
  invoice:{bolt11:invoice,source:{}},paymentSecret:'bb'.repeat(32),minFinalCltvExpiryDelta:18,routingHints:[]}));
 const issuer=createStandardRegtestInvoiceIssuer({network,raw:()=>({getInfo,receivePayment,parse}) as unknown as BreezSdk,
  assertCurrent:()=>{if(!current)throw Error('wallet session locked')}});
 return {getInfo,receivePayment,parse,issuer,revoke:()=>{current=false}};
}
beforeEach(()=>{vi.useRealTimers()});
describe('non-HODL public regtest invoice acceptance',()=>{
 it('sends only standard invoice fields and checks decoded economics and identity',async()=>{
  const h=harness();const r=await h.issuer.issue({amountSats:100,description:'Disposable regtest test',expirySecs:600});
  expect(r).toMatchObject({identityPubkey:identity,paymentRequest:invoice,paymentHash:hash,amountSats:100,quotedFeeSats:'0'});
  expect(h.receivePayment).toHaveBeenCalledExactlyOnceWith({paymentMethod:{
    type:'bolt11Invoice',description:'Disposable regtest test',amountSats:100,expirySecs:600}});
  expect(h.parse).toHaveBeenCalledWith(invoice);
 });
 it.each(['mainnet','signet'] as const)('never creates invoices on %s',async network=>{
  const h=harness(network);await expect(h.issuer.issue({amountSats:100,description:'test'})).rejects.toThrow(/not supported/);
  expect(h.receivePayment).not.toHaveBeenCalled();
 });
 it.each([
  {amountSats:99,description:'test'},{amountSats:10001,description:'test'},
  {amountSats:NaN,description:'test'},{amountSats:100,description:''},
  {amountSats:100,description:'bad\nnewlines'},
  {amountSats:100,description:'test',expirySecs:3601},
  {amountSats:100,description:'test',expirySecs:0},
  {amountSats:100,description:'test',paymentHash:hash},
  {amountSats:100,description:'test',receiverIdentityPublicKey:identity},
 ])('rejects unbounded/custom invoice request %# without calling SDK',async input=>{
  const h=harness();await expect(h.issuer.issue(input)).rejects.toThrow();
  expect(h.receivePayment).not.toHaveBeenCalled();
 });
 it('rejects a stopped or changed session before a remote request',async()=>{
  const h=harness();h.revoke();
  await expect(h.issuer.issue({amountSats:100,description:'test'})).rejects.toThrow(/locked/);
  expect(h.receivePayment).not.toHaveBeenCalled();
 });
 it('rejects session revocation while a provider request is in flight',async()=>{
  const h=harness();h.receivePayment.mockImplementationOnce(async()=>{h.revoke();return {paymentRequest:invoice,fee:0n};});
  await expect(h.issuer.issue({amountSats:100,description:'test'})).rejects.toThrow(/locked/);
  expect(h.parse).not.toHaveBeenCalled();
 });
 it('does not publish an invoice whose SDK parse fails or amount differs',async()=>{
  const h=harness();h.parse.mockResolvedValueOnce({...await h.parse(),amountMsat:90000} as InputType);
  await expect(h.issuer.issue({amountSats:100,description:'test'})).rejects.toThrow(/decoded invoice/);
 });
 it('does not publish an invoice after identity drift during an asynchronous operation',async()=>{
  const h=harness();h.getInfo.mockResolvedValueOnce({identityPubkey:identity})
    .mockResolvedValueOnce({identityPubkey:'03'+'22'.repeat(32)});
  await expect(h.issuer.issue({amountSats:100,description:'test'})).rejects.toThrow(/identity changed/);
 });
 it('fails closed on negative or oversized provider quote',async()=>{
  const h=harness();h.receivePayment.mockResolvedValueOnce({paymentRequest:invoice,fee:-1n});
  await expect(h.issuer.issue({amountSats:100,description:'test'})).rejects.toThrow(/malformed/);
 });
});
