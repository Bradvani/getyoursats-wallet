/** Mature-deposit acceptance boundary. Production activation awaits live acceptance. */
import type {BreezSdk,ClaimDepositRequest,ClaimDepositResponse,Network,Payment} from '@breeztech/breez-sdk-spark';
import {prepareDepositClaim,executeDepositClaim,verifyClaimReceipt} from './depositClaimAuthorization';
import {readDepositClaims,saveDepositClaim,type StoredClaim} from './depositClaimJournal';
import {assertNoUnresolvedRecovery} from './signedRecoveryJournal';
import {withOperationLock,operationWalletKey,readOperations,isUnresolved} from './operationJournal';
import {assertCurrentSession,getSpendingSessionEpoch,isSpendingSessionLocked,requestSpendingApproval} from './spendApproval';
export const DEPOSIT_CLAIMS=Symbol('GetYourSats mature deposit acceptance');
export interface DepositClaimObservation {txid:string;vout:number;identityPubkey:string;network:Network;observedAt:number;completed:boolean;payment?:Payment}
export type MatureDepositSdk=BreezSdk&{
 claimMatureDepositOnce:(request:{txid:string;vout:number;identityPubkey:string;network:Network;amountSats:number;maxFeeSats:number;expiresAt:number})=>Promise<ClaimDepositResponse>;
 observeDepositClaim:(request:{txid:string;vout:number})=>Promise<DepositClaimObservation>;
};
export interface DepositClaimController {
 list:()=>Promise<readonly StoredClaim[]>;
 claim:(request:ClaimDepositRequest)=>Promise<ClaimDepositResponse>;
 reconcile:()=>Promise<readonly StoredClaim[]>;
}
export function getDepositClaims(wallet:BreezSdk):DepositClaimController|null {
 const c:unknown=Reflect.get(wallet,DEPOSIT_CLAIMS);
 return c&&typeof c==='object'&&['list','claim','reconcile'].every(k=>typeof Reflect.get(c,k)==='function')?c as DepositClaimController:null;
}
export function createDepositClaimController(options:{network:Network;raw:()=>BreezSdk;walletKey:()=>Promise<string>;assertConnection:()=>void}):DepositClaimController {
 const {network,raw,walletKey,assertConnection}=options;
 const sdk=()=>{const s=raw() as MatureDepositSdk;if(typeof s.claimMatureDepositOnce!=='function'||typeof s.observeDepositClaim!=='function')throw Error('Verified mature-deposit SDK is unavailable');return s;};
 const live=(epoch:number)=>{assertConnection();assertCurrentSession(epoch);if(isSpendingSessionLocked())throw Error('Wallet session is locked');};
 const rows=(key:string)=>readDepositClaims().filter(r=>r.walletKey===key);
 const lock=async<T>(action:(key:string,epoch:number)=>Promise<T>)=>{
  const epoch=getSpendingSessionEpoch();live(epoch);const key=await walletKey();live(epoch);
  return withOperationLock(key,async()=>{live(epoch);return action(key,epoch);});
 };
 return Object.freeze({
  list:async()=>rows(await walletKey()),
  claim:async(request:ClaimDepositRequest)=>lock(async(key,epoch)=>{
   const noPending=()=>{assertNoUnresolvedRecovery(key);if(readOperations(key).some(isUnresolved))throw Error('Resolve the outstanding payment before claiming');};
   noPending();
   // Copy before network awaits so callers cannot replace the approved outpoint/fee.
   const copied=structuredClone(request);
   if(rows(key).some(r=>r.intent.txid===copied.txid&&r.intent.vout===copied.vout))throw Error('Deposit claim already attempted; check its status');
   const s=sdk(),info=await s.getInfo({ensureSynced:false});live(epoch);
   if(await operationWalletKey(network,info.identityPubkey)!==key)throw Error('Deposit wallet identity changed');live(epoch);
   const quote=await s.fetchClaimDepositQuote({txid:copied.txid,vout:copied.vout});live(epoch);
   const intent=prepareDepositClaim(network,copied,quote);
   let previous:StoredClaim|null=null;
   return executeDepositClaim(intent,{
    assertLive:()=>live(epoch),assertNoPending:noPending,
    approve:async i=>requestSpendingApproval([{paymentId:i.txid+':'+i.vout,amount:BigInt(i.amountSats),details:{type:'spark',payRequest:info.identityPubkey}}],{
     Action:'Claim confirmed Bitcoin deposit',Network:network,'Deposit outpoint':i.txid+':'+i.vout,
     'Receiving wallet':info.identityPubkey,Amount:i.amountSats+' sats','Maximum fee':i.maxFeeSats+' sats',
     'Minimum received':i.minimumCreditSats+' sats',Policy:'One mature claim. Check status after any interruption.',
    }),
    persist:async record=>{previous=saveDepositClaim(key,record,previous);},
    execute:async()=>s.claimMatureDepositOnce({txid:intent.txid,vout:intent.vout,identityPubkey:info.identityPubkey,network,
     amountSats:intent.amountSats,maxFeeSats:intent.maxFeeSats,expiresAt:Math.floor(intent.expiresAt/1000)}),
   });
  }),
  reconcile:async()=>lock(async(key,epoch)=>{
   const s=sdk();
   for(const record of rows(key).filter(r=>r.state!=='settled')){
    const started=Math.floor(Date.now()/1000);
    try{
     const i=record.intent,o=await s.observeDepositClaim({txid:i.txid,vout:i.vout});live(epoch);
     if(!o.completed||!o.payment||o.txid!==i.txid||o.vout!==i.vout||o.network!==network||
        !Number.isSafeInteger(o.observedAt)||o.observedAt<started||o.observedAt>Math.floor(Date.now()/1000)+5||
        await operationWalletKey(network,o.identityPubkey)!==key)continue;
     live(epoch);const paymentId=verifyClaimReceipt(i,{outcome:{type:'settled',payment:o.payment}});
     saveDepositClaim(key,{intent:i,state:'settled',paymentId},record);
    }catch{live(epoch);/* Unknown is never permission to submit again. */}
   }
   return rows(key);
  }),
 });
}
