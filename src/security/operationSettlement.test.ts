import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {BreezSdk,Payment,PrepareSendPaymentResponse,ProvisionalPayment} from '@breeztech/breez-sdk-spark';
import {createOperationGateway,getOperationReconciliation} from './operationGateway';
import {type PaymentObservation} from './paymentObservation';
import {readAllOperations} from './operationJournal';
import {clearSignerIdentity,finishSpendingApproval,getSpendingRequest,lockSpendingSession,rememberSignerIdentity} from './spendApproval';
import {installVaultTestLock} from './vaultTestLock';

type Route='spark'|'lightning'|'bitcoin';
const identity='02'+'11'.repeat(32),paymentId='11111111-1111-4111-8111-111111111111';
function harness(route:Route='spark'){
 const gate=createOperationGateway('mainnet');
 const details:ProvisionalPayment['details']=route==='spark'?{type:'spark',payRequest:'spark-fixture'}:
  route==='lightning'?{type:'lightning',invoice:'lnbc-fixture'}:{type:'bitcoin',withdrawalAddress:'bc1qfixture'};
 const method:PrepareSendPaymentResponse['paymentMethod']=route==='spark'?{type:'sparkAddress',address:'spark-fixture',fee:0n}:
  route==='lightning'?{type:'bolt11Invoice',lightningFeeSats:0,invoiceDetails:{invoice:{bolt11:'lnbc-fixture'},network:'bitcoin',timestamp:Date.now()/1000,expiry:3600}} as PrepareSendPaymentResponse['paymentMethod']:
  {type:'bitcoinAddress',address:{address:'bc1qfixture',network:'bitcoin',source:{}},feeQuote:{id:'quote',isEstimate:false,expiresAt:Date.now()/1000+300,
   speedFast:{userFeeSat:0,l1BroadcastFeeSat:0},speedMedium:{userFeeSat:0,l1BroadcastFeeSat:0},speedSlow:{userFeeSat:0,l1BroadcastFeeSat:0}}};
 const payment=(status:Payment['status']='completed'):Payment=>({id:paymentId,paymentType:'send',method:route==='bitcoin'?'withdraw':route,
  amount:100n,fees:0n,status,timestamp:1});
 const observation=(commitment:string,outcome:PaymentObservation['outcome']='completed'):PaymentObservation=>({paymentId,identityPubkey:identity,
  network:'mainnet',observedAt:Math.floor(Date.now()/1000),recipientCommitment:commitment,outcome,payment:payment(outcome==='returned'?'failed':'completed')});
 const raw={
  getInfo:vi.fn(async()=>({identityPubkey:identity})),parse:vi.fn(async()=>({type:'sparkAddress',identityPublicKey:identity,network:'bitcoin'})),
  prepareSendPayment:vi.fn(async()=>({amount:100n,feePolicy:'feesExcluded',paymentMethod:method})),
  sendPayment:vi.fn(async()=>{await gate.observer.beforeSend([{paymentId,amount:100n,details}]);return {payment:payment()};}),
  observeWalletState:vi.fn(),observePayment:vi.fn(async(request:{recipientCommitment:string})=>observation(request.recipientCommitment)),
 };
 const wallet=gate.protect(raw as unknown as BreezSdk);
 const send=async()=>{
  const prepared=await wallet.prepareSendPayment({paymentRequest:{type:'input',input:'synthetic recipient'}});
  return wallet.sendPayment({prepareResponse:prepared});
 };
 return {gate,raw,wallet,send,payment,observation,details};
}
async function approve(){await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());finishSpendingApproval(getSpendingRequest()!.id,true);}
beforeEach(async()=>{
 localStorage.clear();installVaultTestLock();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 await rememberSignerIdentity({type:'mnemonic',mnemonic:'synthetic settlement test identity'});
});
afterEach(()=>{clearSignerIdentity();vi.restoreAllMocks();});

describe('terminal outgoing settlement evidence',()=>{
 it.each(['spark','lightning','bitcoin'] as const)('keeps %s uncertain when an SDK completion has no fresh proof',async route=>{
  const h=harness(route);h.raw.observePayment.mockRejectedValue(new Error('Observation unavailable'));
  const sending=h.send(),rejected=expect(sending).rejects.toThrow(/outcome is unknown/);await approve();await rejected;
  expect(readAllOperations()[0].state).toBe('unknown');
  await expect(h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'again'}})).rejects.toThrow(/outcome is unknown/);
  expect(h.raw.sendPayment).toHaveBeenCalledOnce();
 });
 it.each(['spark','lightning','bitcoin'] as const)('commits %s completion only after fresh recipient-bound proof',async route=>{
  const h=harness(route);
  h.raw.observePayment.mockImplementation(async request=>{
   expect(readAllOperations()[0].state).toBe('pending');
   return h.observation(request.recipientCommitment);
  });
  const sending=h.send();await approve();await expect(sending).resolves.toMatchObject({payment:{status:'completed'}});
  expect(h.raw.observePayment).toHaveBeenCalledOnce();expect(readAllOperations()[0].state).toBe('completed');
 });
 it.each(['recipient','identity','network','amount','fee','stale','missing','unresolved'] as const)('does not accept a %s proof mismatch as successful delivery',async kind=>{
  const h=harness('bitcoin');
  h.raw.observePayment.mockImplementation(async request=>{
   const o={...h.observation(request.recipientCommitment)};
   if(kind==='recipient')o.recipientCommitment='f'.repeat(64);
   if(kind==='identity')o.identityPubkey='03'+'22'.repeat(32);
   if(kind==='network')o.network='regtest';
   if(kind==='amount')o.payment={...o.payment!,amount:101n};
   if(kind==='fee')o.payment={...o.payment!,fees:1n};
   if(kind==='stale')o.observedAt-=300;
   if(kind==='missing'){o.outcome='notFound';o.payment=undefined;}
   if(kind==='unresolved')o.outcome='unresolved';
   return o;
  });
  const sending=h.send(),rejected=expect(sending).rejects.toThrow(/outcome is unknown/);await approve();await rejected;
  expect(readAllOperations()[0].state).toBe('unknown');expect(h.raw.sendPayment).toHaveBeenCalledOnce();
 });
 it('does not release the journal when the session locks before SDK completion returns',async()=>{
  const h=harness();h.raw.sendPayment.mockImplementation(async()=>{
   await h.gate.observer.beforeSend([{paymentId,amount:100n,details:h.details}]);
   lockSpendingSession('Backgrounded');return {payment:h.payment()};
  });
  const sending=h.send(),rejected=expect(sending).rejects.toThrow(/outcome is unknown/);await approve();await rejected;
  expect(readAllOperations()[0].state).toBe('unknown');expect(h.raw.observePayment).not.toHaveBeenCalled();
 });
 it('does not release the journal when proof arrives after session revocation',async()=>{
  const h=harness();h.raw.observePayment.mockImplementation(async request=>{
   lockSpendingSession('Backgrounded during observation');return h.observation(request.recipientCommitment);
  });
  const sending=h.send(),rejected=expect(sending).rejects.toThrow(/outcome is unknown/);await approve();await rejected;
  expect(readAllOperations()[0].state).toBe('unknown');
 });
 it('keeps an ordinary pending SDK result pending without creating a successful receipt',async()=>{
  const h=harness();h.raw.sendPayment.mockImplementation(async()=>{
   await h.gate.observer.beforeSend([{paymentId,amount:100n,details:h.details}]);return {payment:h.payment('pending')};
  });
  const sending=h.send();await approve();await expect(sending).resolves.toMatchObject({payment:{status:'pending'}});
  expect(readAllOperations()[0].state).toBe('pending');
 });
 it('reconciles a lost completion response after restart without a second send',async()=>{
  const h=harness();h.raw.observePayment.mockRejectedValueOnce(new Error('lost proof'));
  const sending=h.send(),rejected=expect(sending).rejects.toThrow(/outcome is unknown/);await approve();await rejected;
  const resumed=harness();await getOperationReconciliation(resumed.wallet)!.reconcile();
  expect(readAllOperations()[0].state).toBe('completed');expect(resumed.raw.sendPayment).not.toHaveBeenCalled();
 });
 it('returns a failed result only with exact fresh returned-ownership evidence',async()=>{
  const h=harness('lightning');h.raw.sendPayment.mockImplementation(async()=>{
   await h.gate.observer.beforeSend([{paymentId,amount:100n,details:h.details}]);return {payment:h.payment('failed')};
  });
  h.raw.observePayment.mockImplementation(async request=>h.observation(request.recipientCommitment,'returned'));
  const sending=h.send();await approve();await expect(sending).resolves.toMatchObject({payment:{status:'failed'}});
  expect(readAllOperations()[0].state).toBe('returned');expect(h.raw.sendPayment).toHaveBeenCalledOnce();
 });
});
