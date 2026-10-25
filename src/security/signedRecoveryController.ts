import type {BreezSdk,Network,RefundDepositRequest,RefundDepositResponse,RecoverFundsResponse} from '@breeztech/breez-sdk-spark';
import {getSpendingSessionEpoch,assertCurrentSession,isSpendingSessionLocked,requestSpendingApproval} from './spendApproval';
import {journalDigest,withOperationLock,readOperations,isUnresolved} from './operationJournal';
import {readRecoveries,writeRecovery,updateRecovery,assertNoUnresolvedRecovery,type RecoveryRecord,type SignedRecoveryTx} from './signedRecoveryJournal';
import {createRecoveryTransport,type RecoveryTransport} from './recoveryTransport';
import {loadPlan} from '../features/unilateral-exit/driver';

export const SIGNED_RECOVERY=Symbol('GetYourSats signed recovery controller');
type Inspected={txId:string;inputOutpoints:string[];outputs:{valueSats:number;scriptHex:string;address?:string}[]};
export type RecoverySdk=BreezSdk&{
 signRefundDeposit:(r:RefundDepositRequest)=>Promise<RefundDepositResponse>;
 verifyRefundTransaction:(r:{refund:RefundDepositRequest;txId:string;txHex:string;expectedAmountSats:number})=>Promise<RefundDepositResponse>;
 inspectRecoveryTransaction:(r:{txHex:string})=>Inspected;
};
export interface SignedRecoveryController {
 list:()=>Promise<ReadonlyArray<RecoveryRecord>>;
 refund:(request:RefundDepositRequest)=>Promise<RefundDepositResponse>;
 adoptPendingExit:()=>Promise<RecoveryRecord>;
 resume:(operationId:string)=>Promise<RecoveryRecord>;
 check:(operationId:string)=>Promise<RecoveryRecord>;
}
export function getSignedRecovery(wallet:BreezSdk):SignedRecoveryController|null{
 const value:unknown=Reflect.get(wallet,SIGNED_RECOVERY);
 if(!value||typeof value!=='object'||['list','refund','adoptPendingExit','resume','check'].some(k=>typeof Reflect.get(value,k)!=='function'))return null;
 return value as SignedRecoveryController;
}
function asRecoverySdk(raw:BreezSdk):RecoverySdk{
 if(['signRefundDeposit','verifyRefundTransaction','inspectRecoveryTransaction'].some(k=>typeof Reflect.get(raw,k)!=='function'))
  throw new Error('The verified recovery SDK is not installed. No signing or broadcast was started.');
 return raw as RecoverySdk;
}
function sats(value:number):string{
 if(!Number.isSafeInteger(value)||value<0||value>2_100_000_000_000_000)throw new Error('Invalid recovery amount');
 return String(value);
}
function immutable<T>(value:T):T{
 const v=structuredClone(value);
 const freeze=(x:unknown)=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}};
 freeze(v);return v;
}
function txCommitment(t:RecoverFundsResponse['transactions'][number]){
 return {kind:t.kind,nodeId:t.nodeId,txid:t.txid,txHex:t.txHex,cpfpTxHex:t.cpfpTxHex,csvTimelockBlocks:t.csvTimelockBlocks,dependsOn:t.dependsOn};
}
async function exitCommitment(recovery:RecoverFundsResponse):Promise<string>{
 return journalDigest({...recovery,transactions:recovery.transactions.map(txCommitment)});
}
/** Owns the raw recovery capabilities; callers receive only this narrow controller.
 * Every continuation is a fresh foreground authorization of exact already-signed
 * bytes. It never calls recoverFunds to silently rebuild an existing plan. */
export function createSignedRecoveryController(options:{
 network:Network;raw:()=>BreezSdk;walletKey:()=>Promise<string>;assertConnection:()=>void;
 transport?:()=>RecoveryTransport;
}):SignedRecoveryController{
 const {network,raw,walletKey,assertConnection}=options;
 const transport=options.transport??(()=>createRecoveryTransport(network));
 const live=(epoch:number)=>{assertConnection();assertCurrentSession(epoch);if(isSpendingSessionLocked()||document.visibilityState==='hidden')throw new Error('Wallet recovery session is locked');};
 const find=(key:string,id:string)=>{
  const r=readRecoveries(key).find(r=>r.operationId===id);
  if(!r||r.network!==network)throw new Error('Recovery operation does not belong to this wallet');
  return r;
 };
 const lock=async<T>(run:(key:string,epoch:number)=>Promise<T>):Promise<T>=>{
  const epoch=getSpendingSessionEpoch();live(epoch);const key=await walletKey();live(epoch);
  return withOperationLock(key,async()=>{live(epoch);return run(key,epoch);});
 };
 async function approve(r:Pick<RecoveryRecord,'purpose'|'destination'|'amountSats'|'feeLimitSats'|'transactions'>,epoch:number,action:string){
  const amount=r.purpose==='refund'?BigInt(r.amountSats)-BigInt(r.feeLimitSats):BigInt(r.amountSats);
  if(amount<=0n)throw new Error('No positive recovery amount');
  await requestSpendingApproval([{paymentId:'recovery',amount,details:{type:'bitcoin',withdrawalAddress:r.destination}}],{
   Action:action,Network:network,Destination:r.destination,
   'Source value':r.amountSats+' sats','Authorized fee ceiling':r.feeLimitSats+' sats',
   ...(r.transactions.length?{'Signed transaction IDs':r.transactions.map(t=>t.txId).join('\n')}:{}),
   Policy:'Continue only these signed transactions. A changed destination, fee or rebuilt package requires a new authorization.',
  });
  live(epoch);
 }
 async function validateExit(sdk:RecoverySdk,recovery:RecoverFundsResponse):Promise<SignedRecoveryTx[]>{
  if(!recovery||!Array.isArray(recovery.transactions)||!recovery.transactions.length||recovery.transactions.length>2000)
   throw new Error('No complete signed exit plan is available');
  const parsed=await sdk.parse(recovery.destination);
  if(parsed.type!=='bitcoinAddress'||parsed.network!==(network==='mainnet'?'bitcoin':network))throw new Error('Exit destination network mismatch');
  sats(recovery.recoverableValueSats);sats(recovery.totalFeeSats);
  const ids=new Set(recovery.transactions.map(t=>t.txid));
  if(ids.size!==recovery.transactions.length)throw new Error('Duplicate exit transaction IDs');
  const seen=new Set<string>();let payout=0;
  const result:SignedRecoveryTx[]=[];
  for(const tx of recovery.transactions){
   const inspected=sdk.inspectRecoveryTransaction({txHex:tx.txHex});
   if(inspected.txId!==tx.txid||!Array.isArray(tx.dependsOn)||tx.dependsOn.some(id=>!seen.has(id)))
    throw new Error('Signed exit identity or dependency order is invalid');
   if(tx.cpfpTxHex){
    const child=sdk.inspectRecoveryTransaction({txHex:tx.cpfpTxHex});
    if(!child.inputOutpoints.some(outpoint=>outpoint.startsWith(tx.txid+':')))throw new Error('CPFP child does not spend its authorized parent');
   }
   if(tx.kind==='sweep'||tx.kind==='cooperative'){
    const paid=inspected.outputs.filter(o=>o.address===parsed.address).reduce((sum,o)=>sum+Number(sats(o.valueSats)),0);
    if(!Number.isSafeInteger(paid)||paid<=0)throw new Error('Exit payout does not pay the approved destination');
    payout+=paid;
   }
   seen.add(tx.txid);result.push({txId:tx.txid,txHex:tx.txHex,...(tx.cpfpTxHex?{childHex:tx.cpfpTxHex}:{}),state:'signed'});
  }
  // A plan without a sweep may require a future, newly authorized build. Keep
  // its current bytes but never pretend that broadcasting it completes recovery.
  if(!Number.isSafeInteger(payout))throw new Error('Invalid signed payout total');
  return result;
 }
 async function hydrateRefund(record:RecoveryRecord,sdk:RecoverySdk):Promise<RecoveryRecord>{
  if(record.purpose!=='refund'||!record.refund)throw new Error('Not a refund operation');
  let tx=record.transactions[0];
  if(!tx){
   const deposit=(await sdk.listUnclaimedDeposits({})).deposits.find(d=>d.txid===record.refund!.txid&&d.vout===record.refund!.vout);
   if(!deposit?.refundTx||!deposit.refundTxId)throw new Error('No durable signed refund is available yet. No new signature or payment was attempted.');
   tx={txId:deposit.refundTxId,txHex:deposit.refundTx,state:'signed'};
  }
  const verified=await sdk.verifyRefundTransaction({refund:record.refund,txId:tx.txId,txHex:tx.txHex,expectedAmountSats:Number(record.amountSats)});
  if(verified.txId!==tx.txId||verified.txHex!==tx.txHex)throw new Error('Refund verification changed the signed transaction');
  return record.transactions.length?record:updateRecovery(record,{state:'signed',transactions:[tx]});
 }
 async function checkRecord(record:RecoveryRecord,epoch:number):Promise<{record:RecoveryRecord;ready:Set<string>}>{
  const sdk=asRecoverySdk(raw());const chain=transport();live(epoch);
  let r=record;const ready=new Set<string>();
  if(r.purpose==='refund'){
   r=await hydrateRefund(r,sdk);live(epoch);
   const tx=r.transactions[0];
   if(await chain.confirmed(tx.txId,tx.txHex)){
    live(epoch);r=updateRecovery(r,{state:'confirmed',transactions:[{...tx,state:'confirmed'}]});
   }else{live(epoch);ready.add(tx.txId);}
  }else{
   const recovery=r.recovery!;
   await validateExit(sdk,recovery);live(epoch);
   const checked=await sdk.checkRecoverFunds({recovery:structuredClone(recovery)});live(epoch);
   // SDK checks may remove a CPFP child once the parent confirms. Compare its
   // absence only for confirmed transactions; never adopt a replacement child.
   const original=new Map(recovery.transactions.map(t=>[t.txid,t]));
   if(checked.recovery.transactions.length!==original.size)throw new Error('Exit checker changed the signed transaction set');
   const txs:SignedRecoveryTx[]=[];
   for(const tx of checked.recovery.transactions){
    const old=original.get(tx.txid);if(!old)throw new Error('Exit checker introduced another transaction');
    const comparable={...tx,cpfpTxHex:tx.status.type==='confirmed'?old.cpfpTxHex:tx.cpfpTxHex};
    if(await journalDigest(txCommitment(comparable))!==await journalDigest(txCommitment(old)))throw new Error('Exit checker changed an authorized transaction');
    live(epoch);
    const existing=r.transactions.find(t=>t.txId===tx.txid)!;
    let confirmed=false;
    if(tx.status.type==='confirmed')confirmed=await chain.confirmed(existing.txId,existing.txHex);
    live(epoch);
    txs.push({...existing,state:confirmed?'confirmed':existing.state==='confirmed'?'uncertain':existing.state});
    if(tx.status.type==='ready'&&checked.verdict.type==='valid')ready.add(tx.txid);
   }
   live(epoch);
   const complete=checked.verdict.type==='done'&&txs.every(t=>t.state==='confirmed');
   r=updateRecovery(r,{state:complete?'confirmed':checked.verdict.type==='redo'?'uncertain':r.state,transactions:txs});
   if(checked.verdict.type==='redo')throw new Error('This exit needs a newly authorized rebuild. Original signed data has been preserved.');
  }
  return {record:r,ready};
 }
 async function broadcast(record:RecoveryRecord,ready:Set<string>,epoch:number):Promise<RecoveryRecord>{
  let r=record;const chain=transport();
  for(const tx of r.transactions){
   if(!ready.has(tx.txId)||tx.state==='confirmed')continue;
   live(epoch);
   r=updateRecovery(r,{state:'broadcasting'}); // Durable before any network submission.
   try{
    live(epoch);
    if(tx.childHex)await chain.broadcastPackage(tx.txHex,tx.childHex);else await chain.broadcast(tx.txHex);
    live(epoch);
    r=updateRecovery(r,{state:'submitted',transactions:r.transactions.map(t=>t.txId===tx.txId?{...t,state:'submitted'}:t)});
   }catch{
    // A timeout/cancellation after submission is uncertain, not proof of failure.
    // Retain exactly the same bytes. Storage errors also retain the earlier guard.
    r=updateRecovery(r,{state:'uncertain',transactions:r.transactions.map(t=>t.txId===tx.txId?{...t,state:'uncertain'}:t)});
    throw new Error('Recovery broadcast outcome is uncertain. Resume this same operation; do not create another refund or exit.');
   }
  }
  return r;
 }
 return Object.freeze({
  list:async()=>readRecoveries(await walletKey()),
  refund:async(input:RefundDepositRequest)=>lock(async(key,epoch)=>{
   const sdk=asRecoverySdk(raw());const request=immutable(input);
   if(request.fee.type!=='fixed'||!Number.isSafeInteger(request.vout)||request.vout<0||request.vout>0xffffffff||!/^[0-9a-f]{64}$/.test(request.txid))
    throw new Error('A valid deposit outpoint and fixed fee are required');
   if(readOperations(key).some(isUnresolved))throw new Error('Resolve the previous payment before creating a refund');
   assertNoUnresolvedRecovery(key);
   if(readRecoveries(key).some(r=>r.refund?.txid===request.txid&&r.refund.vout===request.vout))throw new Error('A refund already exists for this deposit; use its recovery action');
   const destination=await sdk.parse(request.destinationAddress);live(epoch);
   if(destination.type!=='bitcoinAddress'||destination.network!==(network==='mainnet'?'bitcoin':network))throw new Error('Refund destination network mismatch');
   const quote=await sdk.fetchClaimDepositQuote({txid:request.txid,vout:request.vout});live(epoch);
   const amountSats=sats(quote.amountSats),feeLimitSats=sats(request.fee.amount);
   if(BigInt(feeLimitSats)>=BigInt(amountSats))throw new Error('Refund fee consumes the deposit');
   const deadline=Date.now()+60_000;
   await approve({purpose:'refund',destination:request.destinationAddress,amountSats,feeLimitSats,transactions:[]},epoch,'Authorize deposit refund');
   if(Date.now()>=deadline)throw new Error('Refund preparation expired');
   const intentHash=await journalDigest({network,request,amountSats,feeLimitSats});live(epoch);
   let record=writeRecovery({version:1,walletKey:key,operationId:crypto.randomUUID(),network,purpose:'refund',destination:request.destinationAddress,
    amountSats,feeLimitSats,intentHash,state:'authorized',revision:0,createdAt:Date.now(),updatedAt:Date.now(),refund:request,transactions:[]});
   try{
    live(epoch);
    const signed=await sdk.signRefundDeposit(request);
    // The SDK already persisted its signed refund; keep the app's intent on any
    // failure, so restart can retrieve those bytes rather than re-signing.
    await sdk.verifyRefundTransaction({refund:request,...signed,expectedAmountSats:Number(amountSats)});
    record=updateRecovery(record,{state:'signed',transactions:[{txId:signed.txId,txHex:signed.txHex,state:'signed'}]});
    live(epoch);
    if(Date.now()>=deadline)throw new Error('Approval expired after signing; resume the saved transaction');
    await broadcast(record,new Set([signed.txId]),epoch);
    return signed;
   }catch(error){
    const latest=find(key,record.operationId);
    if(latest.state==='authorized')updateRecovery(latest,{state:'uncertain'});
    throw error;
   }
  }),
  adoptPendingExit:async()=>lock(async(key,epoch)=>{
   const sdk=asRecoverySdk(raw());const info=await sdk.getInfo({ensureSynced:false});live(epoch);
   const plan=loadPlan({identityPubkey:info.identityPubkey,network});
   if(!plan||plan.network!==network||plan.destination!==plan.exit.destination)throw new Error('No matching saved signed exit plan is available');
   const recovery=immutable(plan.exit);const transactions=await validateExit(sdk,recovery);live(epoch);
   const intentHash=await exitCommitment(recovery);live(epoch);
   const prior=readRecoveries(key).find(r=>r.purpose==='exit'&&r.intentHash===intentHash);if(prior)return prior;
   assertNoUnresolvedRecovery(key);
   const amountSats=sats(recovery.recoverableValueSats),feeLimitSats=sats(recovery.totalFeeSats);
   await approve({purpose:'exit',destination:recovery.destination,amountSats,feeLimitSats,transactions},epoch,'Authorize continuation of the saved signed exit');
   // Copy, do not remove or rewrite the original plan/exit backup.
   return writeRecovery({version:1,walletKey:key,operationId:crypto.randomUUID(),network,purpose:'exit',destination:recovery.destination,
    amountSats,feeLimitSats,intentHash,state:'signed',revision:0,createdAt:Date.now(),updatedAt:Date.now(),recovery,transactions});
  }),
  resume:async(id:string)=>lock(async(key,epoch)=>{
   let record=find(key,id);
   if(record.state==='confirmed')return record;
   const checked=await checkRecord(record,epoch);record=checked.record;live(epoch);
   if(record.state==='confirmed'||!checked.ready.size)return record;
   await approve(record,epoch,'Resume the same signed recovery transactions');
   return broadcast(record,checked.ready,epoch);
  }),
  check:async(id:string)=>lock(async(key,epoch)=>(await checkRecord(find(key,id),epoch)).record),
 });
}
