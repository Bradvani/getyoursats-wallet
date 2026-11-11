import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {ClaimDepositRequest,ClaimDepositResponse,Payment} from '@breeztech/breez-sdk-spark';
import {createDepositClaimController,type MatureDepositSdk,type DepositClaimObservation} from './depositClaimController';
import {readDepositClaims} from './depositClaimJournal';
import {assertNoUnresolvedRecovery} from './signedRecoveryJournal';
import {operationWalletKey} from './operationJournal';
import {rememberSignerIdentity,getSpendingRequest,finishSpendingApproval,cancelSpendingApproval,clearSignerIdentity,lockSpendingSession} from './spendApproval';
const txid='a'.repeat(64),identity='02'+'11'.repeat(32);let key:string;
const request=():ClaimDepositRequest=>({txid,vout:0,maxFee:{onchain:{type:'fixed',amount:10}}});
const payment=():Payment=>({id:'deposit-transfer',paymentType:'receive',method:'deposit',status:'completed',amount:990n,fees:10n,timestamp:1,details:{type:'deposit',txId:txid,vout:0}});
const receipt=():ClaimDepositResponse=>({outcome:{type:'settled',payment:payment()}});
function observed():DepositClaimObservation{return {txid,vout:0,identityPubkey:identity,network:'regtest',observedAt:Math.floor(Date.now()/1000),completed:true,payment:payment()};}
function harness(){
 const raw={getInfo:vi.fn(async()=>({identityPubkey:identity})),fetchClaimDepositQuote:vi.fn(async()=>({amountSats:1000,confirmations:1,mature:{confirmationsRequired:1,creditAmountSats:990,feeSats:10,isEstimate:false}})),
 claimMatureDepositOnce:vi.fn(async()=>receipt()),observeDepositClaim:vi.fn(async()=>observed())};
 const controller=createDepositClaimController({network:'regtest',raw:()=>raw as unknown as MatureDepositSdk,walletKey:async()=>key,assertConnection:()=>{}});
 return {raw,controller};
}
async function approve(){await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());finishSpendingApproval(getSpendingRequest()!.id,true);}
beforeEach(async()=>{
 localStorage.clear();const held=new Set<string>();
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_opts:unknown,cb:(lock:unknown)=>Promise<unknown>)=>{
  if(held.has(name))return cb(null);held.add(name);try{return await cb({name});}finally{held.delete(name);}
 }}});
 await rememberSignerIdentity({type:'mnemonic',mnemonic:'disposable-policy-test'});key=await operationWalletKey('regtest',identity);
});
afterEach(()=>{cancelSpendingApproval();clearSignerIdentity();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('mature deposit boundary',()=>{
 it('saves exact economics before invoking the one-shot SDK',async()=>{
  const h=harness();h.raw.claimMatureDepositOnce.mockImplementation(async()=>{expect(readDepositClaims()[0].state).toBe('submitting');return receipt();});
  const run=h.controller.claim(request());expect(h.raw.claimMatureDepositOnce).not.toHaveBeenCalled();await approve();await run;
  expect(h.raw.claimMatureDepositOnce).toHaveBeenCalledWith(expect.objectContaining({txid,vout:0,network:'regtest',identityPubkey:identity,amountSats:1000,maxFeeSats:10}));
  expect(readDepositClaims()[0].state).toBe('settled');expect(()=>assertNoUnresolvedRecovery()).not.toThrow();
 });
 it('cancellation writes no record and invokes no SDK claim',async()=>{
  const h=harness(),run=h.controller.claim(request()),rejected=expect(run).rejects.toThrow(/cancelled/);
  await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());finishSpendingApproval(getSpendingRequest()!.id,false);await rejected;
  expect(readDepositClaims()).toHaveLength(0);expect(h.raw.claimMatureDepositOnce).not.toHaveBeenCalled();
 });
 it('storage failure prevents value-moving work',async()=>{
  const h=harness();vi.stubGlobal('localStorage',new Proxy(localStorage,{get(target,k){if(k==='setItem')return()=>{throw Error('quota');};const v=Reflect.get(target,k);return typeof v==='function'?v.bind(target):v;}}));
  const run=h.controller.claim(request()),rejected=expect(run).rejects.toThrow('quota');await approve();await rejected;
  expect(h.raw.claimMatureDepositOnce).not.toHaveBeenCalled();
 });
 it('uncertainty blocks retry and wallet removal, then reconciles after restart',async()=>{
  const h=harness();h.raw.claimMatureDepositOnce.mockRejectedValue(Error('lost ack'));
  const run=h.controller.claim(request()),rejected=expect(run).rejects.toThrow(/reconciliation/);await approve();await rejected;
  expect(()=>assertNoUnresolvedRecovery()).toThrow(/deposit claim/);await expect(h.controller.claim(request())).rejects.toThrow(/reconciliation/);
  const resumed=harness();expect((await resumed.controller.reconcile())[0].state).toBe('settled');
  expect(resumed.raw.claimMatureDepositOnce).not.toHaveBeenCalled();expect(h.raw.claimMatureDepositOnce).toHaveBeenCalledTimes(1);
 });
 it.each(['identity','network','txid','vout','amount','fee','stale','pending','missing'] as const)('keeps uncertainty on %s observation',async kind=>{
  const h=harness();h.raw.claimMatureDepositOnce.mockRejectedValue(Error('lost ack'));
  const run=h.controller.claim(request()),rejected=expect(run).rejects.toThrow(/reconciliation/);await approve();await rejected;
  const o=observed();if(kind==='identity')o.identityPubkey='other';if(kind==='network')o.network='mainnet';if(kind==='txid')o.txid='b'.repeat(64);
  if(kind==='vout')o.vout=1;if(kind==='amount')o.payment!.amount=991n;if(kind==='fee')o.payment!.fees=11n;
  if(kind==='stale')o.observedAt-=60;if(kind==='pending')o.completed=false;if(kind==='missing')o.payment=undefined;
  h.raw.observeDepositClaim.mockResolvedValue(o);expect((await h.controller.reconcile())[0].state).toBe('uncertain');
 });
 it('does not accept a zero-confirmation maturity threshold from a quote',async()=>{
  const h=harness();h.raw.fetchClaimDepositQuote.mockResolvedValue({amountSats:1000,confirmations:0,mature:{confirmationsRequired:0,creditAmountSats:990,feeSats:10,isEstimate:false}});
  await expect(h.controller.claim(request())).rejects.toThrow(/mature/);expect(h.raw.claimMatureDepositOnce).not.toHaveBeenCalled();
 });
 it('retains uncertainty when locked after execution',async()=>{
  const h=harness();h.raw.claimMatureDepositOnce.mockImplementation(async()=>{lockSpendingSession();return receipt();});
  const run=h.controller.claim(request()),rejected=expect(run).rejects.toThrow(/reconciliation/);await approve();await rejected;expect(readDepositClaims()[0].state).toBe('uncertain');
 });
 it('never issues claims from list or reconciliation',async()=>{
  const h=harness();await h.controller.list();await h.controller.reconcile();expect(h.raw.claimMatureDepositOnce).not.toHaveBeenCalled();
 });
});
