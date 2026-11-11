/** Continue one positively correlated receiving step. Never resubmit a deposit.
 * Exposed only through the existing development-regtest controller. */
import type {BreezSdk,ClaimDepositResponse,DepositClaimCorrelation,Network,ObserveDepositClaimResponse} from '@breeztech/breez-sdk-spark';
import {readDepositClaims,reserveDepositContinuation,saveDepositClaim,type StoredClaim} from './depositClaimJournal';
import {verifyClaimReceipt} from './depositClaimAuthorization';
import {readIncomingClaims} from './incomingClaimJournal';
import {readRecoveries,recoveryUnresolved} from './signedRecoveryJournal';
import {readOperations,isUnresolved,operationWalletKey} from './operationJournal';
import {requestSpendingApproval} from './spendApproval';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function sha256(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
/** Exact pinned SDK StoredIntent::commitment encoding. Covered against a
 * fixed serialization vector; changing the SDK contract requires new evidence. */
export async function depositIntentCommitment(record:StoredClaim,identity:string):Promise<string>{
 const i=record.intent,network={mainnet:'Mainnet',regtest:'Regtest',signet:'Signet'}[i.network];
 return sha256(JSON.stringify({version:1,txid:i.txid,vout:i.vout,identity,network,amount:i.amountSats,maxFee:i.maxFeeSats,expiresAt:Math.floor(i.expiresAt/1000)}));
}
function correlation(value:DepositClaimCorrelation|undefined,commitment:string):Readonly<DepositClaimCorrelation>{
 const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
 if(!value||!hash(value.correlationId)||value.intentHash!==commitment
   ||typeof value.transferId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.transferId)
   ||typeof value.sspRequestId!=='string'||!value.sspRequestId.length||value.sspRequestId.length>256)
  throw Error('Deposit submission has no matching durable correlation. It must not be resubmitted.');
 return Object.freeze({correlationId:value.correlationId,intentHash:value.intentHash,transferId:value.transferId,sspRequestId:value.sspRequestId});
}
export async function continueExistingDeposit(options:{sdk:BreezSdk;network:Network;walletKey:string;request:{txid:string;vout:number};assertLive:()=>void}):Promise<ClaimDepositResponse>{
 const {sdk,network,walletKey,request,assertLive}=options;
 assertLive();
 if(typeof request.txid!=='string'||!/^[0-9a-f]{64}$/.test(request.txid)||!Number.isSafeInteger(request.vout)||request.vout<0||request.vout>0xffffffff)
  throw Error('Invalid deposit outpoint');
 if(typeof sdk.continueMatureDepositClaim!=='function')throw Error('Verified deposit continuation is unavailable');
 const record=readDepositClaims().find(r=>r.walletKey===walletKey&&r.intent.txid===request.txid&&r.intent.vout===request.vout);
 if(!record||record.state==='settled'||record.continuation)throw Error('No eligible original deposit attempt. Check its status instead.');
 if(record.intent.network!==network)throw Error('Deposit attempt belongs to another network');
 const unchanged=()=>{assertLive();const current=readDepositClaims().find(r=>r.walletKey===walletKey&&r.intent.txid===record.intent.txid&&r.intent.vout===record.intent.vout);if(!same(current,record))throw Error('Deposit state changed. Check its status.');};
 const noOtherPending=()=>{
  if(readOperations(walletKey).some(isUnresolved)||readIncomingClaims(walletKey).some(r=>r.state!=='settled')||readRecoveries(walletKey).some(recoveryUnresolved)
    ||readDepositClaims().some(r=>r.walletKey===walletKey&&r.state!=='settled'&&(r.intent.txid!==record.intent.txid||r.intent.vout!==record.intent.vout)))
   throw Error('Resolve other outstanding operations before continuing this deposit');
 };
 noOtherPending();const info=await sdk.getInfo({ensureSynced:false});assertLive();
 if(typeof info.identityPubkey!=='string'||!/^(02|03)[0-9a-f]{64}$/.test(info.identityPubkey)||await operationWalletKey(network,info.identityPubkey)!==walletKey)
  throw Error('Deposit wallet identity changed');
 unchanged();const commitment=await depositIntentCommitment(record,info.identityPubkey);unchanged();
 const observe=async()=>{
  const started=Math.floor(Date.now()/1000),o=await sdk.observeDepositClaim({txid:record.intent.txid,vout:record.intent.vout});assertLive();
  if(!o||typeof o.completed!=='boolean'||o.txid!==record.intent.txid||o.vout!==record.intent.vout||o.identityPubkey!==info.identityPubkey||o.network!==network
     ||!Number.isSafeInteger(o.observedAt)||o.observedAt<started||o.observedAt>Math.floor(Date.now()/1000)+5)
   throw Error('Fresh matching deposit observation is unavailable');
  return structuredClone(o) as ObserveDepositClaimResponse;
 };
 const first=await observe();unchanged();if(first.completed)throw Error('Deposit is already completed. Reconcile its status rather than continuing it.');
 const bound=correlation(first.correlation,commitment),startedAt=Date.now(),expiresAt=startedAt+60000,i=record.intent;
 await requestSpendingApproval([{paymentId:i.txid+':'+i.vout,amount:BigInt(i.amountSats),details:{type:'spark',payRequest:info.identityPubkey}}],{
  Action:'Continue the original Bitcoin deposit',Network:network,'Deposit outpoint':i.txid+':'+i.vout,'Receiving wallet':info.identityPubkey,
  Amount:i.amountSats+' sats','Maximum fee':i.maxFeeSats+' sats','Minimum received':i.minimumCreditSats+' sats',
  Policy:'Continue one correlated receiving step only. Never submit a new deposit claim.',
 });
 unchanged();noOtherPending();if(Date.now()>=expiresAt)throw Error('Deposit continuation approval expired');
 const second=await observe();unchanged();noOtherPending();
 if(second.completed||!same(correlation(second.correlation,commitment),bound))throw Error('Deposit status changed after approval. Reconcile and review again.');
 if(Date.now()>=expiresAt)throw Error('Deposit continuation approval expired');
 const retained=reserveDepositContinuation(record,{version:1,attemptId:crypto.randomUUID(),...bound,startedAt,expiresAt});
 try{
  assertLive();if(Date.now()>=expiresAt)throw Error('Approval expired');
  const response=await sdk.continueMatureDepositClaim({txid:i.txid,vout:i.vout,identityPubkey:info.identityPubkey,network,
   amountSats:i.amountSats,maxFeeSats:i.maxFeeSats,expiresAt:Math.floor(expiresAt/1000)});
  assertLive();const paymentId=verifyClaimReceipt(i,response);
  if(paymentId!==bound.transferId)throw Error('Continuation returned a different transfer');
  const terminal=await observe();
  if(!terminal.completed||!terminal.payment||terminal.payment.id!==bound.transferId)throw Error('Settlement is not yet authoritative');
  const final:ClaimDepositResponse={outcome:{type:'settled',payment:terminal.payment}};
  verifyClaimReceipt(i,final);assertLive();
  saveDepositClaim(walletKey,{intent:i,state:'settled',paymentId},retained);return final;
 }catch{
  // The pre-invocation uncertain record and continuation marker are retained.
  // Neither an error nor an empty provider response authorizes another attempt.
  throw Error('Deposit continuation needs reconciliation. Do not submit or continue it again.');
 }
}
