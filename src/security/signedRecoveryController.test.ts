import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk,RefundDepositRequest,RecoverFundsResponse} from '@breeztech/breez-sdk-spark';
import {createSignedRecoveryController,type RecoverySdk} from './signedRecoveryController';
import {readRecoveries,writeRecovery,type RecoveryRecord} from './signedRecoveryJournal';
import {rememberSignerIdentity,clearSignerIdentity,getSpendingRequest,finishSpendingApproval,lockSpendingSession} from './spendApproval';
import type {RecoveryTransport} from './recoveryTransport';
const seed={type:'mnemonic' as const,mnemonic:'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'};
const key='a'.repeat(64),source='b'.repeat(64),txId='c'.repeat(64),destination='bc1qpublicfixture';
const request:RefundDepositRequest={txid:source,vout:0,destinationAddress:destination,fee:{type:'fixed',amount:100}};
const signed={txId,txHex:'0100'};
function locks(){const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_opts:unknown,fn:(lock:unknown)=>Promise<unknown>)=>{if(held.has(name))return fn(null);held.add(name);try{return await fn({name});}finally{held.delete(name);}}}});}
function harness(){
 const chain={broadcast:vi.fn(async()=>{}),broadcastPackage:vi.fn(async()=>{}),confirmed:vi.fn(async()=>false),tipHeight:vi.fn(async()=>1),feeRates:vi.fn(async()=>({slow:1,medium:1,fast:1})),addressUtxos:vi.fn(async()=>[])} satisfies RecoveryTransport;
 const sdk={
  parse:vi.fn(async()=>({type:'bitcoinAddress',network:'bitcoin',address:destination})),
  getInfo:vi.fn(async()=>({identityPubkey:'02'+'11'.repeat(32)})),
  fetchClaimDepositQuote:vi.fn(async()=>({amountSats:1000})),
  signRefundDeposit:vi.fn(async()=>signed),verifyRefundTransaction:vi.fn(async()=>signed),
  inspectRecoveryTransaction:vi.fn(()=>({txId,inputOutpoints:[],outputs:[{valueSats:900,scriptHex:'00',address:destination}]})),
  listUnclaimedDeposits:vi.fn(async()=>({deposits:[{txid:source,vout:0,amountSats:1000,refundTx:signed.txHex,refundTxId:txId}]})),
  checkRecoverFunds:vi.fn(async({recovery}:{recovery:RecoverFundsResponse})=>({recovery,verdict:{type:'valid'}})),
 };
 const create=()=>createSignedRecoveryController({network:'mainnet',raw:()=>sdk as unknown as RecoverySdk,walletKey:async()=>key,assertConnection:()=>{},transport:()=>chain});
 return {sdk,chain,controller:create(),create};
}
async function prompt(){await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());return getSpendingRequest()!;}
async function approve(){finishSpendingApproval((await prompt()).id,true);}
beforeEach(async()=>{localStorage.clear();locks();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});await rememberSignerIdentity(seed);});
afterEach(()=>{clearSignerIdentity();vi.restoreAllMocks();});
describe('signed refund and exit continuation',()=>{
 it('requires exact fresh authorization before the SDK can sign or broadcast',async()=>{
  const h=harness(),result=h.controller.refund(request);
  await prompt();expect(h.sdk.signRefundDeposit).not.toHaveBeenCalled();expect(h.chain.broadcast).not.toHaveBeenCalled();
  expect(getSpendingRequest()?.intent).toMatchObject({Destination:destination,'Source value':'1000 sats','Authorized fee ceiling':'100 sats'});
  await approve();await expect(result).resolves.toEqual(signed);
  expect(h.sdk.signRefundDeposit).toHaveBeenCalledOnce();expect(h.chain.broadcast).toHaveBeenCalledWith('0100');
  expect(readRecoveries(key)[0].state).toBe('submitted');
 });
 it('cancelled approval makes no journal, signature or network submission',async()=>{
  const h=harness(),result=h.controller.refund(request);const rejected=expect(result).rejects.toThrow();
  finishSpendingApproval((await prompt()).id,false);await rejected;
  expect(h.sdk.signRefundDeposit).not.toHaveBeenCalled();expect(h.chain.broadcast).not.toHaveBeenCalled();expect(readRecoveries()).toHaveLength(0);
 });
 it('a journal failure prevents signing and broadcast',async()=>{
  const h=harness(),result=h.controller.refund(request);const rejected=expect(result).rejects.toThrow(/quota/);
  await prompt();vi.spyOn(localStorage,'setItem').mockImplementationOnce(()=>{throw new Error('quota');});
  await approve();await rejected;expect(h.sdk.signRefundDeposit).not.toHaveBeenCalled();expect(h.chain.broadcast).not.toHaveBeenCalled();
 });
 it('an uncertain broadcast resumes identical bytes after restart without signing again',async()=>{
  const h=harness();h.chain.broadcast.mockRejectedValueOnce(new Error('connection lost after remote acceptance'));
  const first=h.controller.refund(request);const failed=expect(first).rejects.toThrow(/uncertain/);await approve();await failed;
  const r=readRecoveries(key)[0];expect(r.state).toBe('uncertain');
  clearSignerIdentity();await rememberSignerIdentity(seed);
  const resumed=h.create().resume(r.operationId);await approve();await resumed;
  expect(h.sdk.signRefundDeposit).toHaveBeenCalledOnce();expect(h.chain.broadcast.mock.calls).toEqual([['0100'],['0100']]);
  expect(readRecoveries(key)[0].state).toBe('submitted');
 });
 it('never permits a second refund for the same outpoint after uncertainty',async()=>{
  const h=harness();h.chain.broadcast.mockRejectedValueOnce(new Error('offline'));
  const first=h.controller.refund(request);const failed=expect(first).rejects.toThrow();await approve();await failed;
  await expect(h.controller.refund(request)).rejects.toThrow(/pending|already exists/);
  expect(h.sdk.signRefundDeposit).toHaveBeenCalledOnce();
 });
 it('recovers signed bytes stored by the SDK before its original response was lost',async()=>{
  const h=harness();h.sdk.signRefundDeposit.mockRejectedValueOnce(new Error('lost after SDK persistence'));
  const first=h.controller.refund(request);const failed=expect(first).rejects.toThrow();await approve();await failed;
  const r=readRecoveries(key)[0];expect(r.transactions).toHaveLength(0);
  const next=h.controller.resume(r.operationId);await approve();await next;
  expect(h.sdk.signRefundDeposit).toHaveBeenCalledOnce();expect(h.chain.broadcast).toHaveBeenCalledWith('0100');
 });
 it('missing signed bytes remain blocked instead of creating another signature',async()=>{
  const h=harness();h.sdk.signRefundDeposit.mockRejectedValueOnce(new Error('uncertain signing response'));
  h.sdk.listUnclaimedDeposits.mockResolvedValue({deposits:[]});
  const first=h.controller.refund(request);const failed=expect(first).rejects.toThrow();await approve();await failed;
  await expect(h.controller.resume(readRecoveries(key)[0].operationId)).rejects.toThrow(/No durable signed refund/);
  expect(h.sdk.signRefundDeposit).toHaveBeenCalledOnce();expect(h.chain.broadcast).not.toHaveBeenCalled();
 });
 it('refuses substituted SDK refund bytes before broadcasting',async()=>{
  const h=harness();h.sdk.verifyRefundTransaction.mockRejectedValueOnce(new Error('destination mismatch'));
  const result=h.controller.refund(request);const failed=expect(result).rejects.toThrow(/destination/);await approve();await failed;
  expect(h.chain.broadcast).not.toHaveBeenCalled();expect(readRecoveries(key)[0].state).toBe('uncertain');
 });
 it('locking during signing cannot start a subsequent broadcast',async()=>{
  const h=harness();h.sdk.signRefundDeposit.mockImplementationOnce(async()=>{lockSpendingSession();return signed;});
  const result=h.controller.refund(request);const failed=expect(result).rejects.toThrow(/locked|session/);await approve();await failed;
  expect(h.chain.broadcast).not.toHaveBeenCalled();expect(readRecoveries(key)[0].transactions[0].txHex).toBe('0100');
 });
 it('a stale or absent confirmation preserves the recovery guard',async()=>{
  const h=harness(),result=h.controller.refund(request);await approve();await result;
  const r=readRecoveries(key)[0];await h.controller.check(r.operationId);
  expect(readRecoveries(key)[0].state).toBe('submitted');expect(h.chain.broadcast).toHaveBeenCalledOnce();
  h.chain.confirmed.mockResolvedValue(true);await h.controller.check(r.operationId);
  expect(readRecoveries(key)[0].state).toBe('confirmed');expect(h.chain.broadcast).toHaveBeenCalledOnce();
 });
 it('a second tab cannot start another recovery while one is awaiting approval',async()=>{
  const h=harness(),result=h.controller.refund(request);const failed=expect(result).rejects.toThrow();await prompt();
  await expect(h.create().refund(request)).rejects.toThrow(/Another tab/);
  finishSpendingApproval(getSpendingRequest()!.id,false);await failed;
 });
 it('a wallet without the new SDK never falls back to refundDeposit',async()=>{
  const old={refundDeposit:vi.fn()} as unknown as BreezSdk;
  const controller=createSignedRecoveryController({network:'mainnet',raw:()=>old,walletKey:async()=>key,assertConnection:()=>{}});
  await expect(controller.refund(request)).rejects.toThrow(/verified recovery SDK/);
  expect(old.refundDeposit).not.toHaveBeenCalled();
 });
 it('refuses a different wallet journal without prompting or broadcasting',async()=>{
  const r:RecoveryRecord={version:1,walletKey:'f'.repeat(64),operationId:'11111111-1111-4111-8111-111111111111',network:'mainnet',purpose:'refund',destination,amountSats:'1000',feeLimitSats:'100',intentHash:'b'.repeat(64),state:'signed',revision:0,createdAt:1,updatedAt:1,refund:request,transactions:[{...signed,state:'signed'}]};
  writeRecovery(r);const h=harness();await expect(h.controller.resume(r.operationId)).rejects.toThrow(/does not belong/);
  expect(getSpendingRequest()).toBeNull();expect(h.chain.broadcast).not.toHaveBeenCalled();
 });
 it('keeps a refund unresolved if refreshing its old confirmation fails',async()=>{
  const h=harness(),result=h.controller.refund(request);await approve();await result;
  const id=readRecoveries(key)[0].operationId;
  h.chain.confirmed.mockResolvedValue(true);await h.controller.check(id);
  expect(readRecoveries(key)[0].state).toBe('confirmed');
  h.chain.confirmed.mockRejectedValueOnce(new Error('offline'));
  await expect(h.controller.check(id)).rejects.toThrow('offline');
  expect(readRecoveries(key)[0].state).toBe('uncertain');
 });
 it('expires a recovery approval without broadcasting or resigning',async()=>{
  const h=harness(),result=h.controller.refund(request);await approve();await result;
  const id=readRecoveries(key)[0].operationId;
  const resumed=h.controller.resume(id),rejected=expect(resumed).rejects.toThrow(/expired/);
  await prompt();const later=Date.now()+60_001;vi.spyOn(Date,'now').mockReturnValue(later);
  await approve();await rejected;
  expect(h.chain.broadcast).toHaveBeenCalledOnce();expect(h.sdk.signRefundDeposit).toHaveBeenCalledOnce();
 });

});
