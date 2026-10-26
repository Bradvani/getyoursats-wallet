import type {BreezSdk,Network,Payment} from '@breeztech/breez-sdk-spark';
import {assertCurrentSession,getSpendingSessionEpoch,isSpendingSessionLocked,requestSpendingApproval} from './spendApproval';
import {withOperationLock,operationWalletKey,readOperations,isUnresolved} from './operationJournal';
import {assertNoUnresolvedRecovery} from './signedRecoveryJournal';
import {readIncomingClaims,saveIncomingClaim,incomingTransferId,type IncomingClaim} from './incomingClaimJournal';
export const INCOMING_CLAIMS=Symbol('GetYourSats explicit incoming claims');
export interface IncomingObservation {paymentId:string;identityPubkey:string;network:Network;observedAt:number;completed:boolean;payment?:Payment}
export type IncomingSdk=BreezSdk&{
 observeIncomingTransfer:(id:string)=>Promise<IncomingObservation>;
 claimIncomingTransfer:(request:{paymentId:string;identityPubkey:string;network:Network;amountSats:number;expiresAt:number})=>Promise<IncomingObservation>;
};
export interface IncomingClaimController {
 list:()=>Promise<readonly IncomingClaim[]>;
 discover:()=>Promise<readonly Payment[]>;
 claim:(paymentId:string)=>Promise<IncomingClaim>;
 reconcile:()=>Promise<readonly IncomingClaim[]>;
}
export function getIncomingClaims(wallet:BreezSdk):IncomingClaimController|null{
 const c:unknown=Reflect.get(wallet,INCOMING_CLAIMS);
 return c&&typeof c==='object'&&['list','discover','claim','reconcile'].every(k=>typeof Reflect.get(c,k)==='function')?c as IncomingClaimController:null;
}
function directPayment(p:Payment|undefined,id:string,amount?:string):p is Payment{
 return !!p&&p.id===id&&p.paymentType==='receive'&&p.method==='spark'&&!p.conversionDetails&&p.fees===0n&&
 p.amount>0n&&p.amount<=2_100_000_000_000_000n&&(amount===undefined||p.amount.toString()===amount);
}
export function createIncomingClaimController(options:{network:Network;raw:()=>BreezSdk;walletKey:()=>Promise<string>;assertConnection:()=>void}):IncomingClaimController{
 const {network,raw,walletKey,assertConnection}=options;
 const sdk=()=>{const s=raw() as IncomingSdk;if(typeof s.claimIncomingTransfer!=='function'||typeof s.observeIncomingTransfer!=='function')
  throw Error('The verified incoming-payment SDK is not installed');return s;};
 const live=(epoch:number)=>{assertConnection();assertCurrentSession(epoch);if(isSpendingSessionLocked())throw Error('Wallet session is locked');};
 const lock=async<T>(action:(key:string,epoch:number)=>Promise<T>)=>{
  const epoch=getSpendingSessionEpoch();live(epoch);const key=await walletKey();live(epoch);
  return withOperationLock(key,async()=>{live(epoch);return action(key,epoch);});
 };
 async function verify(o:IncomingObservation,id:string,key:string,started:number,epoch:number,amount?:string){
  if(o.paymentId!==id||o.network!==network||!Number.isSafeInteger(o.observedAt)||o.observedAt<Math.floor(started/1000)||
   o.observedAt>Math.floor(Date.now()/1000)+5||typeof o.completed!=='boolean'||!directPayment(o.payment,id,amount)||
   await operationWalletKey(network,o.identityPubkey)!==key)throw Error('Incoming receipt does not match this wallet and transfer');
  live(epoch);return o.payment!;
 }
 async function reconcile(key:string,epoch:number){
  for(const r of readIncomingClaims(key).filter(r=>r.state!=='settled')){
   const started=Date.now();
   try{
    const result=await sdk().observeIncomingTransfer(r.paymentId);live(epoch);
    const p=await verify(result,r.paymentId,key,started,epoch,r.amountSats);
    if(result.completed&&p.status==='completed')saveIncomingClaim({...r,state:'settled',revision:r.revision+1},r);
   }catch{live(epoch);/* no receipt, no terminal transition and no retry */}
  }
  return readIncomingClaims(key);
 }
 return Object.freeze({
  list:async()=>readIncomingClaims(await walletKey()),
  discover:async()=>lock(async(key,epoch)=>{
   await reconcile(key,epoch);
   const s=sdk();
   // Use only the installed read-only extension; never the active sync API.
   const observe=Reflect.get(s,'observeWalletState');if(typeof observe!=='function')throw Error('Observation SDK unavailable');
   await observe.call(s);live(epoch);
   const history=await s.listPayments({offset:0,limit:100});live(epoch);
   const attempted=new Set(readIncomingClaims(key).map(r=>r.paymentId));
   return Object.freeze(history.payments.filter(p=>incomingTransferId(p.id)&&directPayment(p,p.id)&&p.status==='pending'&&!attempted.has(p.id)));
  }),
  reconcile:async()=>lock(reconcile),
  claim:async(paymentId:string)=>lock(async(key,epoch)=>{
   if(!incomingTransferId(paymentId))throw Error('Invalid incoming transfer');
   assertNoUnresolvedRecovery(key);
   if(readOperations(key).some(isUnresolved))throw Error('Resolve the outstanding payment before claiming');
   if(readIncomingClaims(key).some(r=>r.paymentId===paymentId))throw Error('Incoming transfer already attempted; check its status');
   const s=sdk(),started=Date.now(),o=await s.observeIncomingTransfer(paymentId);live(epoch);
   const p=await verify(o,paymentId,key,started,epoch);
   if(o.completed||p.status!=='pending')throw Error('Incoming transfer no longer needs claiming');
   const expiresAt=Math.floor(Date.now()/1000)+60,amountSats=p.amount.toString(),identityPubkey=o.identityPubkey;
   await requestSpendingApproval([{paymentId,amount:p.amount,details:{type:'spark',payRequest:identityPubkey}}],{
    Action:'Claim incoming Bitcoin',Network:network,'Transfer ID':paymentId,'Receiving wallet':identityPubkey,
    'Amount received':amountSats+' sats',Fee:'0 sats',Policy:'Claim this direct Spark transfer once. Check status after any interruption.',
   });live(epoch);
   if(Date.now()>=expiresAt*1000)throw Error('Incoming claim approval expired');
   assertNoUnresolvedRecovery(key);
   let record=saveIncomingClaim({version:1,walletKey:key,paymentId,network,amountSats,expiresAt,state:'submitting',revision:0});
   try{
    live(epoch);
    const requestedAt=Date.now();
    const result=await s.claimIncomingTransfer({paymentId,identityPubkey,network,amountSats:Number(amountSats),expiresAt});
    live(epoch);const receipt=await verify(result,paymentId,key,requestedAt,epoch,amountSats);
    if(!result.completed||receipt.status!=='completed')throw Error('Incoming transfer not settled');
    record=saveIncomingClaim({...record,state:'settled',revision:record.revision+1},record);
    return record;
   }catch{
    try{saveIncomingClaim({...record,state:'uncertain',revision:record.revision+1},record);}catch{/* submitting remains durable */}
    throw Error('Incoming payment outcome is uncertain. Check its status; do not claim it again.');
   }
  }),
 });
}
