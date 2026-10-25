import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {RecoverFundsResponse} from '@breeztech/breez-sdk-spark';
import {createSignedRecoveryController,type RecoverySdk} from './signedRecoveryController';
import {readRecoveries} from './signedRecoveryJournal';
import {rememberSignerIdentity,clearSignerIdentity,getSpendingRequest,finishSpendingApproval,lockSpendingSession} from './spendApproval';
import type {RecoveryTransport} from './recoveryTransport';
const seed={type:'mnemonic' as const,mnemonic:'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'};
const identity='02'+'11'.repeat(32),key='a'.repeat(64),txid='c'.repeat(64),destination='bc1qdisposable';
const planKey='recovery-plan:'+identity.slice(0,16)+':mainnet';
function recovery():RecoverFundsResponse{return {recoverableValueSats:1000,totalFeeSats:100,cooperativeFeeSats:0,cpfpFeeSats:0,fanoutFeeSats:0,refundFeeSats:0,sweepFeeSats:100,leaves:[{leafId:'leaf1',valueSats:1000,method:'unilateral'}],failed:[],fundingInputs:[],feeRateSatPerVbyte:1,destination,transactions:[{kind:'sweep',nodeId:'leaf1',txid,txHex:'0100',dependsOn:[],status:{type:'ready'}}]};}
function harness(){
 const chain={broadcast:vi.fn(async()=>{}),broadcastPackage:vi.fn(async()=>{}),confirmed:vi.fn(async()=>false),tipHeight:vi.fn(async()=>1),feeRates:vi.fn(async()=>({slow:1,medium:1,fast:1})),addressUtxos:vi.fn(async()=>[])} satisfies RecoveryTransport;
 const sdk={parse:vi.fn(async()=>({type:'bitcoinAddress',network:'bitcoin',address:destination})),getInfo:vi.fn(async()=>({identityPubkey:identity})),
  signRefundDeposit:vi.fn(),verifyRefundTransaction:vi.fn(),recoverFunds:vi.fn(),
  inspectRecoveryTransaction:vi.fn(()=>({txId:txid,inputOutpoints:[],outputs:[{valueSats:900,scriptHex:'00',address:destination}]})),
  checkRecoverFunds:vi.fn(async({recovery:r}:{recovery:RecoverFundsResponse})=>({recovery:r,verdict:{type:'valid' as 'valid'|'done'|'redo'}}))};
 const create=()=>createSignedRecoveryController({network:'mainnet',raw:()=>sdk as unknown as RecoverySdk,walletKey:async()=>key,assertConnection:()=>{},transport:()=>chain});
 return {sdk,chain,controller:create(),create};
}
async function approve(){await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());finishSpendingApproval(getSpendingRequest()!.id,true);}
beforeEach(async()=>{
 localStorage.clear();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_opts:unknown,cb:(lock:unknown)=>Promise<unknown>)=>{if(held.has(name))return cb(null);held.add(name);try{return await cb({name});}finally{held.delete(name);}}}});
 await rememberSignerIdentity(seed);
 localStorage.setItem(planKey,JSON.stringify({version:5,network:'mainnet',destination,feeRateSatPerVbyte:1,fundingAddressIndex:0,quotedSweepFeeSat:100,phase:'active',refusals:{},exit:recovery(),exitStateSnapshot:'preserved-disposable-backup'}));
});
afterEach(()=>{clearSignerIdentity();vi.restoreAllMocks();});
describe('saved signed exit continuation',()=>{
 it('adopts after authorization while preserving the original plan and backup',async()=>{
  const original=localStorage.getItem(planKey),h=harness(),adopting=h.controller.adoptPendingExit();await approve();const r=await adopting;
  expect(r.purpose).toBe('exit');expect(localStorage.getItem(planKey)).toBe(original);
  expect(h.sdk.recoverFunds).not.toHaveBeenCalled();expect(h.chain.broadcast).not.toHaveBeenCalled();
 });
 it('resumes exact signed bytes after restart without any new recovery signing',async()=>{
  const h=harness(),adopting=h.controller.adoptPendingExit();await approve();const r=await adopting;
  clearSignerIdentity();await rememberSignerIdentity(seed);
  const resume=h.create().resume(r.operationId);await approve();await resume;
  expect(h.chain.broadcast).toHaveBeenCalledWith('0100');expect(h.sdk.recoverFunds).not.toHaveBeenCalled();
  expect(readRecoveries(key)[0].state).toBe('submitted');
 });
 it('rejects a checker that substitutes signed bytes',async()=>{
  const h=harness(),adopting=h.controller.adoptPendingExit();await approve();const r=await adopting;
  h.sdk.checkRecoverFunds.mockImplementationOnce(async({recovery:r})=>({recovery:{...r,transactions:r.transactions.map(t=>({...t,txHex:'0200'}))},verdict:{type:'valid'}}));
  await expect(h.controller.resume(r.operationId)).rejects.toThrow(/changed/);
  expect(h.chain.broadcast).not.toHaveBeenCalled();expect(h.sdk.recoverFunds).not.toHaveBeenCalled();
 });
 it('does not broadcast unverified chain states',async()=>{
  const h=harness(),adopting=h.controller.adoptPendingExit();await approve();const r=await adopting;
  h.sdk.checkRecoverFunds.mockImplementationOnce(async({recovery:r})=>({recovery:{...r,transactions:r.transactions.map(t=>({...t,status:{type:'unverified'}}))},verdict:{type:'valid'}}));
  await h.controller.resume(r.operationId);expect(h.chain.broadcast).not.toHaveBeenCalled();expect(getSpendingRequest()).toBeNull();
 });
 it('requires a new separate build for a diverged plan, never rebuilds silently',async()=>{
  const h=harness(),adopting=h.controller.adoptPendingExit();await approve();const r=await adopting;
  h.sdk.checkRecoverFunds.mockImplementationOnce(async({recovery:r})=>({recovery:r,verdict:{type:'redo'}}));
  await expect(h.controller.resume(r.operationId)).rejects.toThrow(/newly authorized rebuild/);
  expect(h.sdk.recoverFunds).not.toHaveBeenCalled();expect(readRecoveries(key)[0].state).toBe('uncertain');
 });
 it('locking while the chain check is running cannot broadcast anything',async()=>{
  const h=harness(),adopting=h.controller.adoptPendingExit();await approve();const r=await adopting;
  h.sdk.checkRecoverFunds.mockImplementationOnce(async({recovery:r})=>{lockSpendingSession();return {recovery:r,verdict:{type:'valid'}};});
  await expect(h.controller.resume(r.operationId)).rejects.toThrow(/session|locked/);expect(h.chain.broadcast).not.toHaveBeenCalled();
 });
 it('does not label a provider-only done verdict confirmed without matching chain bytes',async()=>{
  const h=harness(),adopting=h.controller.adoptPendingExit();await approve();const r=await adopting;
  h.sdk.checkRecoverFunds.mockImplementation(async({recovery:r})=>({recovery:{...r,transactions:r.transactions.map(t=>({...t,status:{type:'confirmed',blockHeight:1}}))},verdict:{type:'done'}}));
  await h.controller.check(r.operationId);expect(readRecoveries(key)[0].state).not.toBe('confirmed');
  h.chain.confirmed.mockResolvedValue(true);await h.controller.check(r.operationId);expect(readRecoveries(key)[0].state).toBe('confirmed');
 });
});
