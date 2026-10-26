import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {createIncomingClaimController,type IncomingSdk,type IncomingObservation} from './incomingClaimController';
import {readIncomingClaims,saveIncomingClaim,INCOMING_CLAIM_PREFIX} from './incomingClaimJournal';
import {assertNoUnresolvedRecovery} from './signedRecoveryJournal';
import {operationWalletKey} from './operationJournal';
import {rememberSignerIdentity,getSpendingRequest,finishSpendingApproval,cancelSpendingApproval,clearSignerIdentity,lockSpendingSession} from './spendApproval';
function installOperationTestLock(){
 const held=new Set<string>();
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_options:unknown,cb:(lock:unknown)=>Promise<unknown>)=>{
  if(held.has(name))return cb(null);held.add(name);try{return await cb({name});}finally{held.delete(name);}
 }}});
}
const id='00000000-0000-4000-8000-000000000001',identity='02'+'11'.repeat(32);
let key:string;
const payment=(status:'pending'|'completed'='pending'):Payment=>({id,paymentType:'receive',method:'spark',status,amount:500n,fees:0n,timestamp:1});
function observed(completed=false):IncomingObservation{return {paymentId:id,identityPubkey:identity,network:'regtest',observedAt:Math.floor(Date.now()/1000),completed,payment:payment(completed?'completed':'pending')};}
function harness(){
 const raw={observeIncomingTransfer:vi.fn(async()=>observed()),claimIncomingTransfer:vi.fn(async()=>observed(true)),
  observeWalletState:vi.fn(),listPayments:vi.fn(async()=>({payments:[payment()]}))};
 const controller=createIncomingClaimController({network:'regtest',raw:()=>raw as unknown as IncomingSdk,walletKey:async()=>key,assertConnection:()=>{}});
 return {raw,controller};
}
async function approve(){await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());finishSpendingApproval(getSpendingRequest()!.id,true);}
beforeEach(async()=>{localStorage.clear();installOperationTestLock();await rememberSignerIdentity({type:'mnemonic',mnemonic:'disposable-test-identity'});key=await operationWalletKey('regtest',identity);});
afterEach(()=>{cancelSpendingApproval();clearSignerIdentity();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('explicit incoming claim',()=>{
 it('persists before claiming and binds the wallet, amount, network and id',async()=>{
  const h=harness();h.raw.claimIncomingTransfer.mockImplementation(async()=>{expect(readIncomingClaims(key)[0].state).toBe('submitting');return observed(true);});
  const run=h.controller.claim(id);expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();await approve();
  expect((await run).state).toBe('settled');expect(h.raw.claimIncomingTransfer).toHaveBeenCalledWith(expect.objectContaining({paymentId:id,identityPubkey:identity,amountSats:500,network:'regtest'}));
  expect(()=>assertNoUnresolvedRecovery(key)).not.toThrow();
 });
 it('cancellation makes no SDK claim and no journal record',async()=>{
  const h=harness(),run=h.controller.claim(id),rejected=expect(run).rejects.toThrow(/cancelled/);
  await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());cancelSpendingApproval();await rejected;
  expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();expect(readIncomingClaims()).toEqual([]);
 });
 it('blocks duplicate attempts, spending and removal after a lost acknowledgement',async()=>{
  const h=harness();h.raw.claimIncomingTransfer.mockRejectedValue(Error('lost ack'));
  const run=h.controller.claim(id),rejected=expect(run).rejects.toThrow(/uncertain/);await approve();await rejected;
  expect(readIncomingClaims(key)[0].state).toBe('uncertain');expect(()=>assertNoUnresolvedRecovery()).toThrow(/incoming payment/);
  await expect(h.controller.claim(id)).rejects.toThrow(/reconciliation/);expect(h.raw.claimIncomingTransfer).toHaveBeenCalledTimes(1);
 });
 it('reconciles after a new controller session without a second claim',async()=>{
  const h=harness();h.raw.claimIncomingTransfer.mockRejectedValue(Error('lost ack'));
  const run=h.controller.claim(id),rejected=expect(run).rejects.toThrow(/uncertain/);await approve();await rejected;
  const resumed=harness();resumed.raw.observeIncomingTransfer.mockResolvedValue(observed(true));
  expect((await resumed.controller.reconcile())[0].state).toBe('settled');expect(resumed.raw.claimIncomingTransfer).not.toHaveBeenCalled();
 });
 it.each(['identity','network','amount','fee','direction','method','stale','notCompleted'] as const)('retains uncertainty for %s receipt mismatch',async(kind)=>{
  const h=harness();h.raw.claimIncomingTransfer.mockImplementation(async()=>{
   const r=observed(true);
   if(kind==='identity')r.identityPubkey='other';if(kind==='network')r.network='mainnet';if(kind==='amount')r.payment!.amount=501n;
   if(kind==='fee')r.payment!.fees=1n;if(kind==='direction')r.payment!.paymentType='send';if(kind==='method')r.payment!.method='deposit';
   if(kind==='stale')r.observedAt-=300;if(kind==='notCompleted')r.completed=false;return r;
  });
  const run=h.controller.claim(id),rejected=expect(run).rejects.toThrow(/uncertain/);await approve();await rejected;
  expect(readIncomingClaims(key)[0].state).toBe('uncertain');
 });
 it('a background lock after execution keeps uncertainty',async()=>{
  const h=harness();h.raw.claimIncomingTransfer.mockImplementation(async()=>{lockSpendingSession();return observed(true);});
  const run=h.controller.claim(id),rejected=expect(run).rejects.toThrow(/uncertain/);await approve();await rejected;
  expect(readIncomingClaims(key)[0].state).toBe('uncertain');
 });
 it('never claims from discovery and omits settled or previously attempted receipts',async()=>{
  const h=harness();expect(await h.controller.discover()).toHaveLength(1);expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
  const run=h.controller.claim(id);await approve();await run;
  expect(await h.controller.discover()).toHaveLength(0);
 });
 it('rejects unknown schema records before attempting work',async()=>{
  localStorage.setItem('gys:incoming-claim:v2:'+key+':'+id,'{}');const h=harness();
  await expect(h.controller.claim(id)).rejects.toThrow(/incompatible/);expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
 });
 it.each(['walletKey','paymentId'] as const)('does not coerce an array-valued %s into a valid incoming journal identity',field=>{
  const r=saveIncomingClaim({version:1,walletKey:key,paymentId:id,network:'regtest',amountSats:'500',expiresAt:100,state:'submitting',revision:0});
  const storageKey=INCOMING_CLAIM_PREFIX+key+':'+id,bytes=JSON.stringify({...r,[field]:[r[field]]});
  localStorage.setItem(storageKey,bytes);
  expect(()=>readIncomingClaims(key)).toThrow(/incompatible/);
  expect(localStorage.getItem(storageKey)).toBe(bytes);
 });
 it('rejects stale journal writers and replacement economics',()=>{
  const r=saveIncomingClaim({version:1,walletKey:key,paymentId:id,network:'regtest',amountSats:'500',expiresAt:100,state:'submitting',revision:0});
  expect(()=>saveIncomingClaim({...r,state:'settled',amountSats:'501',revision:1},r)).toThrow(/changed/);
  saveIncomingClaim({...r,state:'uncertain',revision:1},r);
  expect(()=>saveIncomingClaim({...r,state:'settled',revision:1},r)).toThrow(/changed/);
 });
 it('storage failure prevents the SDK claim',async()=>{
  const h=harness(),storage=localStorage;
  vi.stubGlobal('localStorage',new Proxy(storage,{get(target,prop){if(prop==='setItem')return (k:string,v:string)=>{if(k.startsWith('gys:incoming-claim:'))throw Error('quota');target.setItem(k,v);};const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}}));
  const run=h.controller.claim(id),rejected=expect(run).rejects.toThrow(/quota/);await approve();await rejected;
  expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
 });
});
