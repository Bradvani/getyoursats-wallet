import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk,ClaimDepositResponse,DepositClaimCorrelation,Payment,ObserveDepositClaimResponse} from '@breeztech/breez-sdk-spark';
import {continueExistingDeposit,depositIntentCommitment} from './depositContinuation';
import {createDepositClaimController} from './depositClaimController';
import {readDepositClaims,saveDepositClaim,reserveDepositContinuation,CLAIM_JOURNAL_PREFIX} from './depositClaimJournal';
import {operationWalletKey,writeOperation} from './operationJournal';
import {rememberSignerIdentity,getSpendingRequest,finishSpendingApproval,cancelSpendingApproval,clearSignerIdentity,lockSpendingSession,isSpendingSessionLocked} from './spendApproval';
const txid='a'.repeat(64),identity='02'+'11'.repeat(32),transferId='11111111-1111-4111-8111-111111111111';let key:string;
const intent=()=>({network:'regtest' as const,txid,vout:0,amountSats:1000,maxFeeSats:10,minimumCreditSats:990,expiresAt:123456000});
const payment=():Payment=>({id:transferId,paymentType:'receive',method:'deposit',status:'completed',amount:990n,fees:10n,timestamp:1,details:{type:'deposit',txId:txid,vout:0}});
const receipt=():ClaimDepositResponse=>({outcome:{type:'settled',payment:payment()}});
async function harness(){
 const row=saveDepositClaim(key,{intent:intent(),state:'submitting'},null);const original=saveDepositClaim(key,{intent:intent(),state:'uncertain'},row);
 const bound:DepositClaimCorrelation={correlationId:'b'.repeat(64),intentHash:await depositIntentCommitment(original,identity),transferId,sspRequestId:'provider-public-fixture'};
 const pending=():ObserveDepositClaimResponse=>({txid,vout:0,network:'regtest',identityPubkey:identity,observedAt:Math.floor(Date.now()/1000),completed:false,correlation:bound});
 const terminal=():ObserveDepositClaimResponse=>({...pending(),completed:true,payment:payment()});
 const raw={getInfo:vi.fn(async()=>({identityPubkey:identity})),observeDepositClaim:vi.fn().mockImplementationOnce(async()=>pending()).mockImplementationOnce(async()=>pending()).mockImplementation(async()=>terminal()),continueMatureDepositClaim:vi.fn(async()=>receipt()),claimMatureDepositOnce:vi.fn(),claimDeposit:vi.fn(),fetchClaimDepositQuote:vi.fn()};
 const live=()=>{if(isSpendingSessionLocked())throw Error('Wallet is locked');};
 const run=()=>continueExistingDeposit({sdk:raw as unknown as BreezSdk,network:'regtest',walletKey:key,request:{txid,vout:0},assertLive:live});
 return {raw,run,pending,terminal,bound,original};
}
async function approve(){await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());finishSpendingApproval(getSpendingRequest()!.id,true);}
beforeEach(async()=>{localStorage.clear();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_opts:unknown,cb:(lock:unknown)=>Promise<unknown>)=>{if(held.has(name))return cb(null);held.add(name);try{return await cb({name});}finally{held.delete(name);}}}});await rememberSignerIdentity({type:'mnemonic',mnemonic:'public-policy-fixture'});key=await operationWalletKey('regtest',identity);});
afterEach(()=>{cancelSpendingApproval();clearSignerIdentity();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('one-shot correlated deposit continuation',()=>{
 it('records the continuation before SDK work, preserves original economics and requires fresh terminal observation',async()=>{
  const h=await harness();h.raw.continueMatureDepositClaim.mockImplementation(async()=>{expect(readDepositClaims()[0]).toMatchObject({state:'uncertain',continuation:{transferId}});return receipt();});
  const run=h.run();await approve();await run;
  expect(h.raw.continueMatureDepositClaim).toHaveBeenCalledOnce();expect(h.raw.continueMatureDepositClaim).toHaveBeenCalledWith(expect.objectContaining({txid,vout:0,network:'regtest',identityPubkey:identity,amountSats:1000,maxFeeSats:10}));
  expect(readDepositClaims()[0]).toMatchObject({state:'settled',intent:intent(),continuation:{transferId,intentHash:h.bound.intentHash}});
  expect(h.raw.claimMatureDepositOnce).not.toHaveBeenCalled();expect(h.raw.claimDeposit).not.toHaveBeenCalled();expect(h.raw.fetchClaimDepositQuote).not.toHaveBeenCalled();expect(h.raw.observeDepositClaim).toHaveBeenCalledTimes(3);
 });
 it('cancellation performs no value-moving call and does not reserve a continuation',async()=>{
  const h=await harness(),run=h.run(),failure=expect(run).rejects.toThrow(/cancelled/);await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());finishSpendingApproval(getSpendingRequest()!.id,false);await failure;expect(readDepositClaims()[0]).toEqual(h.original);expect(h.raw.continueMatureDepositClaim).not.toHaveBeenCalled();
 });
 it('quota failure before reservation prevents SDK execution',async()=>{
  const h=await harness(),before=JSON.stringify(localStorage);vi.stubGlobal('localStorage',new Proxy(localStorage,{get:(t,k)=>k==='setItem'?()=>{throw Error('quota');}:typeof Reflect.get(t,k)==='function'?Reflect.get(t,k).bind(t):Reflect.get(t,k)}));const run=h.run(),failure=expect(run).rejects.toThrow('quota');await approve();await failure;expect(h.raw.continueMatureDepositClaim).not.toHaveBeenCalled();expect(JSON.stringify(localStorage)).toBe(before);
 });
 it('a lost continuation response keeps the original operation uncertain and forbids a second call',async()=>{
  const h=await harness();h.raw.continueMatureDepositClaim.mockRejectedValue(Error('lost reply'));const run=h.run(),failure=expect(run).rejects.toThrow(/needs reconciliation/);await approve();await failure;
  expect(readDepositClaims()[0]).toMatchObject({state:'uncertain',continuation:{transferId}});await expect(h.run()).rejects.toThrow(/No eligible/);expect(h.raw.continueMatureDepositClaim).toHaveBeenCalledOnce();
 });
 it('a new controller can reconcile success without repeating the continuation',async()=>{
  const h=await harness();h.raw.continueMatureDepositClaim.mockRejectedValueOnce(Error('lost reply'));const run=h.run(),failure=expect(run).rejects.toThrow(/reconciliation/);await approve();await failure;
  h.raw.observeDepositClaim.mockImplementation(async()=>h.terminal());const controller=createDepositClaimController({network:'regtest',raw:()=>h.raw as unknown as BreezSdk,walletKey:async()=>key,assertConnection:()=>{}});
  await controller.reconcile();expect(readDepositClaims()[0]).toMatchObject({state:'settled',continuation:{transferId}});expect(h.raw.continueMatureDepositClaim).toHaveBeenCalledOnce();expect(h.raw.claimMatureDepositOnce).not.toHaveBeenCalled();
 });
 it.each(['missing','intent','transfer','correlation','stale','identity','network'] as const)('does not request approval with %s preflight evidence',async kind=>{
  const h=await harness(),o=h.pending();if(kind==='missing')o.correlation=undefined;if(kind==='intent')o.correlation={...h.bound,intentHash:'c'.repeat(64)};if(kind==='transfer')o.correlation={...h.bound,transferId:'bad'};if(kind==='correlation')o.correlation={...h.bound,correlationId:'bad'};if(kind==='stale')o.observedAt-=60;if(kind==='identity')o.identityPubkey='03'+'22'.repeat(32);if(kind==='network')o.network='mainnet';
  h.raw.observeDepositClaim.mockReset().mockResolvedValue(o);await expect(h.run()).rejects.toThrow();expect(getSpendingRequest()).toBeNull();expect(h.raw.continueMatureDepositClaim).not.toHaveBeenCalled();expect(readDepositClaims()[0]).toEqual(h.original);
 });
 it.each(['completed','changed-transfer','changed-receipt','locked','expired'])('rejects %s after approval without invoking SDK continuation',async kind=>{
  const h=await harness();
  // Replace sequence explicitly: first observation is valid, second injects fault.
  const inject=h.raw.observeDepositClaim;const fault=async()=>{if(kind==='locked')lockSpendingSession();if(kind==='expired')vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);return kind==='completed'?h.terminal():{...h.pending(),correlation:{...h.bound,...(kind==='changed-transfer'?{transferId:'22222222-2222-4222-8222-222222222222'}:{}),...(kind==='changed-receipt'?{correlationId:'c'.repeat(64)}:{})}};};
  inject.mockReset().mockImplementationOnce(async()=>h.pending()).mockImplementationOnce(fault);
  const run=h.run(),failure=expect(run).rejects.toThrow();await approve();await failure;expect(h.raw.continueMatureDepositClaim).not.toHaveBeenCalled();expect(readDepositClaims()[0]).toEqual(h.original);
 });
 it.each(['pending','wrong-transfer','wrong-amount','wrong-fee','missing'])('retains uncertainty on %s after a successful SDK call',async kind=>{
  const h=await harness();h.raw.observeDepositClaim.mockReset().mockImplementationOnce(async()=>h.pending()).mockImplementationOnce(async()=>h.pending()).mockImplementation(async()=>{const o=h.terminal();if(kind==='pending')o.completed=false;if(kind==='wrong-transfer')o.payment!.id='other';if(kind==='wrong-amount')o.payment!.amount=991n;if(kind==='wrong-fee')o.payment!.fees=11n;if(kind==='missing')o.payment=undefined;return o;});
  const run=h.run(),failure=expect(run).rejects.toThrow(/reconciliation/);await approve();await failure;expect(readDepositClaims()[0]).toMatchObject({state:'uncertain',continuation:{transferId}});
 });
 it('blocks an unrelated pending outgoing operation',async()=>{const h=await harness();writeOperation({version:1,walletKey:key,operationId:crypto.randomUUID(),paymentId:'other',intentHash:'a'.repeat(64),network:'regtest',route:'spark',amountSats:'1',feeLimitSats:'0',state:'submitting',createdAt:1,updatedAt:1});await expect(h.run()).rejects.toThrow(/other outstanding/);expect(h.raw.observeDepositClaim).not.toHaveBeenCalled();});
 it('never treats an already-completed observation as a request to execute',async()=>{const h=await harness();h.raw.observeDepositClaim.mockReset().mockImplementation(async()=>h.terminal());await expect(h.run()).rejects.toThrow(/already completed/);expect(getSpendingRequest()).toBeNull();expect(h.raw.continueMatureDepositClaim).not.toHaveBeenCalled();});
});
describe('continuation journal preservation',()=>{
 it('matches the pinned SDK intent-commitment vector',async()=>{const h=await harness();expect(await depositIntentCommitment(h.original,identity)).toBe('3859f2dcbc45468670491551bc5ddd6541de8190253c29795ccb2bca0cba59ed');});
 it('retains the marker through later settlement and rejects an altered or missing marker',async()=>{const h=await harness();const now=Date.now();const continued=reserveDepositContinuation(h.original,{version:1,attemptId:crypto.randomUUID(),...h.bound,startedAt:now,expiresAt:now+60000});expect(()=>reserveDepositContinuation(continued,continued.continuation!)).toThrow();const settled=saveDepositClaim(key,{intent:intent(),state:'settled',paymentId:transferId},continued);expect(settled.continuation).toEqual(continued.continuation);expect(Object.isFrozen(readDepositClaims()[0].continuation)).toBe(true);});
 it('damaged continuation evidence remains present and blocks journal reads',async()=>{const h=await harness(),k=CLAIM_JOURNAL_PREFIX+key+':'+txid+':0';localStorage.setItem(k,JSON.stringify({...h.original,continuation:{invalid:true}}));const before=localStorage.getItem(k);expect(()=>readDepositClaims()).toThrow(/incompatible/);expect(localStorage.getItem(k)).toBe(before);});
});

describe('continuation adoption and storage boundaries',()=>{
 it('a silent failed reservation write cannot authorize SDK work',async()=>{const h=await harness();const actual=localStorage;vi.stubGlobal('localStorage',new Proxy(actual,{get:(t,k)=>k==='setItem'?()=>{}:typeof Reflect.get(t,k)==='function'?Reflect.get(t,k).bind(t):Reflect.get(t,k)}));const run=h.run(),failure=expect(run).rejects.toThrow(/durably recorded/);await approve();await failure;expect(h.raw.continueMatureDepositClaim).not.toHaveBeenCalled();expect(readDepositClaims()[0]).toEqual(h.original);});
 it('malformed completion flags are not treated as a pending transfer',async()=>{const h=await harness();h.raw.observeDepositClaim.mockReset().mockResolvedValue({...h.pending(),completed:undefined});await expect(h.run()).rejects.toThrow(/observation/);expect(h.raw.continueMatureDepositClaim).not.toHaveBeenCalled();});
 it('a failed terminal-state write leaves the continuation marked uncertain',async()=>{const h=await harness();h.raw.observeDepositClaim.mockReset().mockImplementationOnce(async()=>h.pending()).mockImplementationOnce(async()=>h.pending()).mockImplementation(async()=>{const actual=localStorage;vi.stubGlobal('localStorage',new Proxy(actual,{get:(t,k)=>k==='setItem'?()=>{throw Error('quota');}:typeof Reflect.get(t,k)==='function'?Reflect.get(t,k).bind(t):Reflect.get(t,k)}));return h.terminal();});const run=h.run(),failure=expect(run).rejects.toThrow(/reconciliation/);await approve();await failure;expect(readDepositClaims()[0]).toMatchObject({state:'uncertain',continuation:{transferId}});});
 it('state changes after the prompt cannot authorize an old record',async()=>{const h=await harness(),run=h.run(),failure=expect(run).rejects.toThrow(/state changed/);await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());saveDepositClaim(key,{intent:intent(),state:'uncertain'},h.original);await approve();await failure;expect(h.raw.continueMatureDepositClaim).not.toHaveBeenCalled();});
 it('the controller copies the selected outpoint before asynchronous authentication',async()=>{const h=await harness();const controller=createDepositClaimController({network:'regtest',raw:()=>h.raw as unknown as BreezSdk,walletKey:async()=>key,assertConnection:()=>{}});const selected={txid,vout:0};const run=controller.continueClaim(selected);selected.txid='b'.repeat(64);selected.vout=1;await approve();await run;expect(h.raw.continueMatureDepositClaim).toHaveBeenCalledWith(expect.objectContaining({txid,vout:0}));});
});
