import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk,PrepareSendPaymentResponse,ProvisionalPayment,PrepareLnurlPayResponse,SendPaymentRequest,ReceivePaymentRequest,Network} from '@breeztech/breez-sdk-spark';
import {createOperationGateway,getOperationReconciliation} from './operationGateway';
import {getDepositClaims} from './depositClaimController';
import {writeOperation,updateOperation,operationWalletKey,readAllOperations} from './operationJournal';
import type {ObservationSdk,PaymentObservation} from './paymentObservation';
import {rememberSignerIdentity,clearSignerIdentity,getSpendingRequest,finishSpendingApproval,cancelSpendingApproval,lockSpendingSession} from './spendApproval';
const seed={type:'mnemonic' as const,mnemonic:'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'};
const response=():PrepareSendPaymentResponse=>({amount:100n,feePolicy:'feesExcluded',paymentMethod:{type:'sparkAddress',address:'spark-recipient',fee:0n}});
function installOperationTestLock(){
 const held=new Set<string>();
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_options:unknown,cb:(lock:unknown)=>Promise<unknown>)=>{
  if(held.has(name))return cb(null);
  held.add(name);try{return await cb({name})}finally{held.delete(name)}
 }}});
}
const payment=(id:string,method:'spark'|'lightning'|'withdraw'='spark')=>({id,paymentType:'send' as const,status:'completed' as const,amount:100n,fees:0n,timestamp:Date.now()/1000,method});
const transfer:ProvisionalPayment={paymentId:'sdk-id',amount:100n,details:{type:'spark',payRequest:'spark-recipient'}};
function harness(override?:ProvisionalPayment[],network:Network='mainnet') {
 const gate=createOperationGateway(network);
 const send=vi.fn(async(_request:SendPaymentRequest)=>{const expected=override?.[0]??transfer;await gate.observer.beforeSend(override??[transfer]);return {payment:payment(expected.paymentId,expected.details.type==='bitcoin'?'withdraw':expected.details.type as 'spark'|'lightning')}});
 const prepare=vi.fn(async()=>response());
 const refund=vi.fn();
 const observePayment=vi.fn(async(request:{paymentId:string;recipientCommitment:string}):Promise<PaymentObservation>=>{
  const expected=override?.[0]??transfer;
  return {paymentId:request.paymentId,recipientCommitment:request.recipientCommitment,identityPubkey:'wallet-identity-fixture',network,
   observedAt:Math.floor(Date.now()/1000),outcome:'completed',payment:payment(request.paymentId,expected.details.type==='bitcoin'?'withdraw':expected.details.type as 'spark'|'lightning')};
 });
 const raw={prepareSendPayment:prepare,sendPayment:send,refundDeposit:refund,parse:vi.fn(async()=>({type:'sparkAddress',address:'spark-recipient',identityPublicKey:'02'+'11'.repeat(32),network:network==='mainnet'?'bitcoin':network,source:{}})),getInfo:vi.fn(async()=>({identityPubkey:'wallet-identity-fixture',balanceSats:200n})),getPayment:vi.fn(async()=>{throw new Error('cached lookup must not be used')}),observeWalletState:vi.fn(async()=>({identityPubkey:'wallet-identity-fixture',balanceSats:200n})),observePayment} as unknown as ObservationSdk;
 return {gate,wallet:gate.protect(raw),send,prepare,refund,raw};
}
async function approvalReady(){await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());}
async function approve(){await approvalReady();finishSpendingApproval(getSpendingRequest()!.id,true);}
beforeEach(async()=>{localStorage.clear();installOperationTestLock();await rememberSignerIdentity(seed)});
afterEach(()=>{cancelSpendingApproval();clearSignerIdentity();vi.useRealTimers();vi.unstubAllEnvs()});
describe('connection operation gateway',()=>{
 it.each(['mainnet','signet'] as const)('keeps mature claims unavailable on %s',network=>{
  expect(getDepositClaims(harness(undefined,network).wallet)).toBeNull();
 });
 it('exposes mature claims only in development regtest, without exposing raw SDK methods',async()=>{
  vi.stubEnv('DEV',true);
  const wallet=harness(undefined,'regtest').wallet;
  expect(getDepositClaims(wallet)).not.toBeNull();
  expect(()=>wallet.claimDeposit({txid:'00'.repeat(32),vout:0})).toThrow(/unavailable/);
  expect(()=>Reflect.get(wallet,'claimMatureDepositOnce')({txid:'00'.repeat(32),vout:0,identityPubkey:'wallet',network:'regtest',amountSats:100,maxFeeSats:1,expiresAt:1})).toThrow(/unavailable/);
  expect(()=>Reflect.get(wallet,'continueMatureDepositClaim')({txid:'00'.repeat(32),vout:0,identityPubkey:'wallet',network:'regtest',amountSats:100,maxFeeSats:1,expiresAt:1})).toThrow(/unavailable/);
  vi.stubEnv('DEV',false);
  expect(getDepositClaims(wallet)).toBeNull();
 });
 it('does not treat an adapter generic unknown-symbol function as a reconciliation controller',()=>{
  const sdk=new Proxy({} as BreezSdk,{get:()=>async()=>undefined});
  expect(getOperationReconciliation(sdk)).toBeNull();
  expect(getOperationReconciliation({} as BreezSdk)).toBeNull();
 });
 it('authorizes before invoking SDK and supplies its own idempotency key',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'spark-recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p,idempotencyKey:'caller-key'});
  expect(h.send).not.toHaveBeenCalled();
  await approvalReady();expect(getSpendingRequest()?.intent).toMatchObject({Network:'mainnet',Recipient:'spark-recipient',Amount:'100 sats','Maximum quoted fee':'0 sats'});
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
   return {payment:payment('sdk-id')};
  });
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});await approve();await sending;
 });
 it('cancellation prevents the SDK call and consumes the prepared transaction',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p}); const rejected=expect(sending).rejects.toThrow(/cancelled/);
  await approvalReady();cancelSpendingApproval();await rejected;expect(h.send).not.toHaveBeenCalled();
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
  await approvalReady();cancelSpendingApproval();await rejected;expect(h.send).not.toHaveBeenCalled();
 });
 it.each([
  {...transfer,amount:101n},
  {...transfer,details:{type:'spark' as const,payRequest:'attacker'}},
 ])('observer vetoes changed execution details %#',async bad=>{
  const h=harness([bad]),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/outcome is unknown/);
  await approve();await rejected;
 });
 it('observer rejects autonomous transfers with no approved operation',async()=>{
  await expect(harness().gate.observer.beforeSend([transfer])).rejects.toThrow(/No single-use/);
 });
 it('background lock during approval prevents SDK execution',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/backgrounded/);
  await approvalReady();lockSpendingSession('backgrounded');await rejected;expect(h.send).not.toHaveBeenCalled();
 });
 it('lock immediately after approval prevents SDK execution',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/session changed/);
  await approvalReady();finishSpendingApproval(getSpendingRequest()!.id,true);lockSpendingSession();
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
  await approvalReady();vi.setSystemTime(62000);await approve();await rejected;expect(h.send).not.toHaveBeenCalled();
 });
 it.each(['signRefundDeposit','verifyRefundTransaction','inspectRecoveryTransaction','recoverFunds','getTokenIssuer','createTokenAllowance','pullPayment','sendBatch','publishSignedTransferPackage','updateUserSettings','lnurlWithdraw','futureSpendMethod'])('denies unreviewed capability %s',method=>{
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
  await approvalReady();expect(getSpendingRequest()?.intent).toMatchObject({Recipient:'bc1-test','Maximum quoted fee':'5 sats','Confirmation speed':'medium','Quote ID':'quote-1'});
  await approve();await sending;
 });
 it('persists uncertainty before SDK invocation and blocks another connection after a dropped response',async()=>{
  const h=harness();
  h.send.mockImplementationOnce(async()=>{
   const saved=await getOperationReconciliation(h.wallet)!.status();
   expect(saved[0].state).toBe('submitting');expect(saved[0].intentHash).toMatch(/^[0-9a-f]{64}$/);
   throw new Error('Connection lost after remote commit');
  });
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/outcome is unknown/);
  await approve();await rejected;
  expect((await getOperationReconciliation(h.wallet)!.status())[0].state).toBe('unknown');
  const reloaded=harness();
  await expect(reloaded.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}})).rejects.toThrow(/outcome is unknown/);
  expect(reloaded.prepare).not.toHaveBeenCalled();expect(reloaded.send).not.toHaveBeenCalled();
 });
 it('missing or failed SDK records do not authorize repayment; exact completed evidence clears the guard',async()=>{
  const h=harness();h.send.mockRejectedValueOnce(new Error('unknown delivery'));
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/outcome is unknown/);
  await approve();await rejected;
  const controller=getOperationReconciliation(h.wallet)!;
  vi.mocked(h.raw.observePayment).mockRejectedValueOnce(new Error('not found'));
  const record=(await controller.reconcile())[0];expect(record.state).toBe('unknown');
  vi.mocked(h.raw.observePayment).mockResolvedValueOnce({paymentId:record.paymentId,identityPubkey:'wallet-identity-fixture',network:'mainnet',observedAt:Math.floor(Date.now()/1000),outcome:'unresolved',recipientCommitment:record.recipientHash,payment:{...payment(record.paymentId),status:'failed'}});
  expect((await controller.reconcile())[0].state).toBe('unknown');
  vi.mocked(h.raw.observePayment).mockResolvedValueOnce({paymentId:record.paymentId,identityPubkey:'wallet-identity-fixture',network:'mainnet',observedAt:Math.floor(Date.now()/1000),outcome:'completed',recipientCommitment:record.recipientHash,payment:payment(record.paymentId)});
  expect((await controller.reconcile())[0].state).toBe('completed');
  await expect(h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'new recipient'}})).resolves.toBeDefined();
  expect(h.send).toHaveBeenCalledOnce();
 });
 it('journal write failure prevents execution',async()=>{
  const h=harness(),p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/quota/);
  await approvalReady();
  const spy=vi.spyOn(localStorage,'setItem').mockImplementationOnce(()=>{throw new DOMException('quota','QuotaExceededError')});
  try{await approve();await rejected;expect(h.send).not.toHaveBeenCalled()}finally{spy.mockRestore()}
 });
 it('another connection cannot approve while this wallet lock is held',async()=>{
  const h=harness(),other=harness();
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const q=await other.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/cancelled/);
  await approvalReady();
  await expect(other.wallet.sendPayment({prepareResponse:q})).rejects.toThrow(/Another tab/);
  cancelSpendingApproval();await rejected;expect(h.send).not.toHaveBeenCalled();expect(other.send).not.toHaveBeenCalled();
 });
 it('removal cannot erase records while another connection is approving a payment',async()=>{
  const h=harness(),other=harness();
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/cancelled/);
  await approvalReady();
  const remove=vi.fn(async()=>{localStorage.clear()});
  await expect(getOperationReconciliation(other.wallet)!.withWalletRemovalLock(remove)).rejects.toThrow(/Another tab/);
  expect(remove).not.toHaveBeenCalled();cancelSpendingApproval();await rejected;
 });
 it('removal keeps the spend lock until asynchronous deletion finishes',async()=>{
  const h=harness(),other=harness();
  const p=await other.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve});
  const remove=vi.fn(async()=>{await barrier;clearSignerIdentity();localStorage.clear()});
  const removal=getOperationReconciliation(h.wallet)!.withWalletRemovalLock(remove);
  await vi.waitFor(()=>expect(remove).toHaveBeenCalledOnce());
  await expect(other.wallet.sendPayment({prepareResponse:p})).rejects.toThrow(/Another tab/);
  expect(other.send).not.toHaveBeenCalled();release();await removal;
 });
 it('removal refuses an unresolved operation and preserves its durable evidence',async()=>{
  const h=harness();h.send.mockRejectedValueOnce(new Error('unknown delivery'));
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/outcome is unknown/);
  await approve();await rejected;
  const controller=getOperationReconciliation(h.wallet)!;
  const before=await controller.status();const remove=vi.fn(async()=>{localStorage.clear()});
  await expect(controller.withWalletRemovalLock(remove)).rejects.toThrow(/outcome is unknown/);
  expect(remove).not.toHaveBeenCalled();expect(await controller.status()).toEqual(before);
 });
 it('removal refuses an unresolved record belonging to a different wallet and network',async()=>{
  const h=harness();
  const foreign=writeOperation({version:1,walletKey:await operationWalletKey('regtest','different-wallet'),
   operationId:crypto.randomUUID(),paymentId:'foreign-payment',intentHash:'b'.repeat(64),network:'regtest',
   route:'spark',amountSats:'100',feeLimitSats:'0',state:'submitting',createdAt:1000,updatedAt:1000});
  const remove=vi.fn(async()=>{localStorage.clear()});
  await expect(getOperationReconciliation(h.wallet)!.withWalletRemovalLock(remove)).rejects.toThrow(/outcome is unknown/);
  expect(remove).not.toHaveBeenCalled();expect(readAllOperations()).toEqual([foreign]);
 });
 it('removal refuses damaged origin journal records even when their wallet is unrecognizable',async()=>{
  const h=harness(),key='gys:payment-journal:v1:unrecognizable-wallet:damaged';
  localStorage.setItem(key,'{damaged');const remove=vi.fn(async()=>{localStorage.clear()});
  await expect(getOperationReconciliation(h.wallet)!.withWalletRemovalLock(remove)).rejects.toThrow(/damaged/);
  expect(remove).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('{damaged');
 });
 it('removal permits completed records and unrelated archived vault data',async()=>{
  const h=harness();
  const completed=writeOperation({version:1,walletKey:await operationWalletKey('regtest','different-wallet'),
   operationId:crypto.randomUUID(),paymentId:'completed-payment',intentHash:'b'.repeat(64),network:'regtest',
   route:'spark',amountSats:'100',feeLimitSats:'0',state:'submitting',createdAt:1000,updatedAt:1000});
  updateOperation(completed,{state:'completed'});
  localStorage.setItem('gys:vault-archive:fixture','encrypted-disposable-fixture');
  const remove=vi.fn(async()=>{localStorage.clear()});
  await getOperationReconciliation(h.wallet)!.withWalletRemovalLock(remove);
  expect(remove).toHaveBeenCalledOnce();expect(localStorage.length).toBe(0);
 });
 it('an operation on another network prevents origin-wide removal until it finishes',async()=>{
  const h=harness(),other=harness(undefined,'regtest');
  const p=await other.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=other.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/cancelled/);
  await approvalReady();const remove=vi.fn(async()=>{localStorage.clear()});
  await expect(getOperationReconciliation(h.wallet)!.withWalletRemovalLock(remove)).rejects.toThrow(/Another tab/);
  expect(remove).not.toHaveBeenCalled();cancelSpendingApproval();await rejected;
 });
 it('storage removal invalidates a stale connection before a cross-tab storage event arrives',async()=>{
  const h=harness(),other=harness();
  const p=await other.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  // Only clear origin storage: the other tab's in-memory identity has not changed yet.
  await getOperationReconciliation(h.wallet)!.withWalletRemovalLock(async()=>{localStorage.clear()});
  await expect(other.wallet.sendPayment({prepareResponse:p})).rejects.toThrow(/storage session changed/);
  expect(other.send).not.toHaveBeenCalled();expect(getSpendingRequest()).toBeNull();
  const fresh=harness();
  await expect(fresh.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}})).resolves.toBeDefined();
  await expect(other.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}})).rejects.toThrow(/storage session changed/);
  expect(other.prepare).toHaveBeenCalledOnce();
 });
 it('maps browser refresh exclusively to observation and never calls raw active sync',async()=>{
  const gate=createOperationGateway('mainnet'),sync=vi.fn(),getInfo=vi.fn(async(_request:{ensureSynced?:boolean})=>({identityPubkey:'fixture'}));
  const observe=vi.fn(async()=>({identityPubkey:'fixture'})),paymentObservation=vi.fn();
  const wallet=gate.protect({syncWallet:sync,getInfo,observeWalletState:observe,observePayment:paymentObservation} as unknown as BreezSdk);
  await wallet.syncWallet({});await wallet.getInfo({ensureSynced:true});
  expect(sync).not.toHaveBeenCalled();expect(observe).toHaveBeenCalledTimes(2);
  await wallet.getInfo({ensureSynced:false});await wallet.getInfo({});
  expect(getInfo.mock.calls.every(([request])=>request.ensureSynced===false)).toBe(true);
 });
 it('refuses observation after lock before invoking any SDK query',async()=>{
  const h=harness();lockSpendingSession();
  await expect(h.wallet.syncWallet({})).rejects.toThrow(/locked/);
  expect(h.raw.observeWalletState).not.toHaveBeenCalled();
 });
 it('discards a query result if backgrounding invalidates its session',async()=>{
  const h=harness();vi.mocked(h.raw.observeWalletState).mockImplementationOnce(async()=>{
   lockSpendingSession();return {identityPubkey:'wallet-identity-fixture'} as never;
  });
  await expect(h.wallet.syncWallet({})).rejects.toThrow(/session changed/);
 });
 it.each([
  {paymentMethod:{type:'crossChain',route:{},amount:100n}},
  {paymentMethod:{type:'sparkInvoice',amount:100n,tokenIdentifier:'token'}},
 ])('rejects an unreviewed receiving route before contacting the SDK %#',async input=>{
  const gate=createOperationGateway('mainnet'),receive=vi.fn();
  const wallet=gate.protect({receivePayment:receive} as unknown as BreezSdk);
  await expect(wallet.receivePayment(input as ReceivePaymentRequest)).rejects.toThrow(/unavailable pending/);
  expect(receive).not.toHaveBeenCalled();
 });
 it.each([
  {type:'sparkAddress'}, {type:'sparkInvoice',amount:100n},
 ])('copies and permits direct Spark receiving request %#',async paymentMethod=>{
  const gate=createOperationGateway('mainnet'),receive=vi.fn(async(_request:ReceivePaymentRequest)=>({paymentRequest:'fixture',fee:0n}));
  const wallet=gate.protect({receivePayment:receive} as unknown as BreezSdk);
  const request={paymentMethod} as ReceivePaymentRequest;
  await expect(wallet.receivePayment(request)).resolves.toMatchObject({paymentRequest:'fixture'});
  expect(receive.mock.calls[0][0]).toEqual(request);
  expect(receive.mock.calls[0][0]).not.toBe(request);
  expect(Object.isFrozen(receive.mock.calls[0][0])).toBe(true);
 });
 it.each(['mainnet','signet','regtest'] as const)('does not create Lightning invoices on %s without a bounded claim primitive',async network=>{
  vi.stubEnv('DEV',true);
  const gate=createOperationGateway(network),receive=vi.fn();
  const wallet=gate.protect({receivePayment:receive} as unknown as BreezSdk);
  await expect(wallet.receivePayment({paymentMethod:{type:'bolt11Invoice',description:'fixture',amountSats:100}})).rejects.toThrow(/Lightning receiving is unavailable/);
  expect(receive).not.toHaveBeenCalled();
 });
 it.each([
  {network:'mainnet',dev:true},{network:'signet',dev:true},
  {network:'mainnet',dev:false},{network:'regtest',dev:false},
 ] as const)('does not create a Bitcoin address when mature claims are disabled: $network, dev=$dev',async({network,dev})=>{
  vi.stubEnv('DEV',dev);
  const gate=createOperationGateway(network),receive=vi.fn();
  const wallet=gate.protect({receivePayment:receive} as unknown as BreezSdk);
  await expect(wallet.receivePayment({paymentMethod:{type:'bitcoinAddress',newAddress:true}})).rejects.toThrow(/Bitcoin receiving is unavailable/);
  expect(receive).not.toHaveBeenCalled();
 });
 it('retains only valueless development regtest Bitcoin receive without initiating a claim',async()=>{
  vi.stubEnv('DEV',true);
  const gate=createOperationGateway('regtest');
  const receive=vi.fn(async()=>({paymentRequest:'bcrt1-disposable-fixture',fee:0n}));
  const claim=vi.fn();
  const wallet=gate.protect({receivePayment:receive,claimMatureDepositOnce:claim} as unknown as BreezSdk);
  await expect(wallet.receivePayment({paymentMethod:{type:'bitcoinAddress',newAddress:true}})).resolves.toMatchObject({paymentRequest:'bcrt1-disposable-fixture'});
  expect(getDepositClaims(wallet)).not.toBeNull();
  expect(receive).toHaveBeenCalledTimes(1);expect(claim).not.toHaveBeenCalled();
 });
 it('rejects receiving results if the session locks during SDK creation',async()=>{
  const gate=createOperationGateway('mainnet');
  let release!:(value:unknown)=>void;
  const receive=vi.fn(()=>new Promise(resolve=>{release=resolve}));
  const wallet=gate.protect({receivePayment:receive} as unknown as BreezSdk);
  const receiving=wallet.receivePayment({paymentMethod:{type:'sparkAddress'}});
  const rejected=expect(receiving).rejects.toThrow(/session changed/);
  lockSpendingSession();release({paymentRequest:'fixture',fee:0n});await rejected;
 });
 it('retains unknown status when an SDK returns success without the required observer',async()=>{
  const h=harness();h.send.mockImplementationOnce(async request=>({payment:payment(request.idempotencyKey!)}));
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/outcome is unknown/);
  await approve();await rejected;
  expect((await getOperationReconciliation(h.wallet)!.status())[0].state).toBe('unknown');
 });
 it('retains unknown status when an SDK success receipt differs from the authorized operation',async()=>{
  const h=harness();h.send.mockImplementationOnce(async()=>{
   await h.gate.observer.beforeSend([transfer]);return {payment:{...payment('sdk-id'),amount:101n}};
  });
  const p=await h.wallet.prepareSendPayment({paymentRequest:{type:'input',input:'recipient'}});
  const sending=h.wallet.sendPayment({prepareResponse:p});const rejected=expect(sending).rejects.toThrow(/outcome is unknown/);
  await approve();await rejected;
  expect((await getOperationReconciliation(h.wallet)!.status())[0].state).toBe('unknown');
 });
 it('LNURL binds resolved invoice, contact, amount, fees and comment',async()=>{
  const gate=createOperationGateway('mainnet');
  const p={amountSats:100,feeSats:2,feePolicy:'feesExcluded',comment:'hello',payRequest:{domain:'recipient.example'},invoiceDetails:{invoice:{bolt11:'lnbc-test'},network:'bitcoin',timestamp:Date.now()/1000,expiry:3600}} as PrepareLnurlPayResponse;
  const send=vi.fn(async()=>{await gate.observer.beforeSend([{...transfer,details:{type:'lightning',invoice:'lnbc-test'}}]);return {payment:payment('sdk-id','lightning')}});
  const wallet=gate.protect({getInfo:async()=>({identityPubkey:'wallet-lnurl-fixture'}),prepareLnurlPay:async()=>p,lnurlPay:send,
   observeWalletState:vi.fn(),observePayment:async(request:{paymentId:string;recipientCommitment:string})=>({
    ...request,identityPubkey:'wallet-lnurl-fixture',network:'mainnet',observedAt:Math.floor(Date.now()/1000),outcome:'completed',payment:payment(request.paymentId,'lightning'),
   }),
  } as unknown as BreezSdk);
  const prep=await wallet.prepareLnurlPay({} as never);const sending=wallet.lnurlPay({prepareResponse:prep});
  expect(send).not.toHaveBeenCalled();await approvalReady();expect(getSpendingRequest()?.intent).toMatchObject({Recipient:'recipient.example',Invoice:'lnbc-test','Maximum debit':'102 sats',Comment:'hello'});
  await approve();await sending;expect(send).toHaveBeenCalledOnce();
 });
});
