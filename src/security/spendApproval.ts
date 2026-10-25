/**
 * Defense-in-depth SDK transfer veto. NOT a primary spending boundary:
 * payment observers omit refund, recovery, delegated and migration paths, and
 * some token transfers are already signed when this callback runs.
 */
import type {PaymentObserver, ProvisionalPayment, Seed} from '@breeztech/breez-sdk-spark';

export type SpendingRequest = Readonly<{
  id:number;
  payments:ReadonlyArray<Readonly<ProvisionalPayment>>;
  sessionEpoch:number;
  deadlineAt:number;
  intent?:Readonly<Record<string,string>>;
}>;
type Pending={request:SpendingRequest; resolve:()=>void; reject:(e:Error)=>void;timeout:ReturnType<typeof setTimeout>};
const listeners=new Set<()=>void>();
let pending:Pending|null=null;
let version=0,sessionEpoch=0;
let sessionLocked=true;
let expectedFingerprint:string|null=null;
let signerIdentityToken:object|null=null;
export const getSignerIdentityToken=()=>signerIdentityToken;
const emit=()=>listeners.forEach(listener=>listener());
export function subscribeSpendingApproval(listener:()=>void){
  listeners.add(listener);
  return()=>{listeners.delete(listener)};
}
export const getSpendingRequest=():SpendingRequest|null=>pending?.request??null;
export const getSpendingRequestServerSnapshot=():SpendingRequest|null=>null;
export const isSpendingSessionLocked=()=>sessionLocked;
export const getSpendingSessionEpoch=():number=>sessionEpoch;
export function assertCurrentSession(epoch:number):void{
 if(epoch!==sessionEpoch || document.visibilityState==='hidden')
  throw new Error('Wallet session changed during authentication');
}
export const hasSignerIdentity=()=>expectedFingerprint!==null;

function seedInput(seed:Seed):string{
 if(seed.type==='mnemonic')return 'mnemonic:'+seed.mnemonic+':'+(seed.passphrase??'');
 return seed.type==='entropy'?'entropy:'+Array.from(seed).join(','):'unknown';
}
async function fingerprint(seed:Seed):Promise<string>{
 const encoded=new TextEncoder().encode(seedInput(seed));
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',encoded));
 return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function matchesSignerIdentity(seed:Seed):Promise<boolean>{
 return expectedFingerprint!==null && await fingerprint(seed)===expectedFingerprint;
}
export async function rememberSignerIdentity(seed:Seed):Promise<void>{
 // Reject any approval belonging to the previous wallet.
 lockSpendingSession('Wallet identity changed');
 const lockedEpoch=sessionEpoch;
 const next=await fingerprint(seed);
 assertCurrentSession(lockedEpoch);
 expectedFingerprint=next;
 signerIdentityToken=Object.freeze({});
 sessionEpoch+=1;
 sessionLocked=false;
}
export function lockSpendingSession(reason='Wallet is locked'):void{
 sessionLocked=true;
 sessionEpoch+=1;
 cancelSpendingApproval(reason);
}
export async function unlockSpendingSession(seed:Seed):Promise<number>{
 const epoch=sessionEpoch;
 const matches=await matchesSignerIdentity(seed);
 assertCurrentSession(epoch);
 if(!matches)throw new Error('Vault identity does not match the connected signer');
 sessionEpoch+=1;
 sessionLocked=false;
 return sessionEpoch;
}
export function clearSignerIdentity():void{
 lockSpendingSession('Wallet session ended');
 expectedFingerprint=null;
 signerIdentityToken=null;
}
function snapshot(payments:ProvisionalPayment[]):ReadonlyArray<Readonly<ProvisionalPayment>>{
 // SDK callback values are intentionally copied to sever mutable aliases.
 return Object.freeze(payments.map(p=>Object.freeze({
  paymentId:p.paymentId,amount:p.amount,
  details:Object.freeze({...p.details})
 }))) as ReadonlyArray<Readonly<ProvisionalPayment>>;
}
export function finishSpendingApproval(id:number,approved:boolean,reason?:string):void{
 const item=pending;
 if(!item || item.request.id!==id)return;
 pending=null;
 clearTimeout(item.timeout);
 emit();
 if(approved && (sessionLocked || expectedFingerprint===null ||
     sessionEpoch!==item.request.sessionEpoch ||
     Date.now()>=item.request.deadlineAt ||
     document.visibilityState==='hidden')){
   item.reject(new Error('Transaction authorization expired or session locked'));
   return;
 }
 if(approved)item.resolve();
 else item.reject(new Error(reason??'Payment authorization cancelled'));
}
export function cancelSpendingApproval(reason='Payment authorization cancelled'):void{
 if(pending)finishSpendingApproval(pending.request.id,false,reason);
}
export function requestSpendingApproval(payments:ProvisionalPayment[],intent?:Readonly<Record<string,string>>):Promise<void>{
 if(pending)return Promise.reject(new Error('Another transaction is awaiting approval'));
 if(sessionLocked||expectedFingerprint===null)return Promise.reject(new Error('Wallet session is locked'));
 if(!Array.isArray(payments)||payments.length===0)return Promise.reject(new Error('Transaction approval details missing'));
 if(document.visibilityState==='hidden')return Promise.reject(new Error('Wallet is not in the foreground'));
 const id=++version;
 const request:SpendingRequest=Object.freeze({id,payments:snapshot(payments),sessionEpoch,deadlineAt:Date.now()+90_000,
  intent:intent&&Object.freeze({...intent})});
 return new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>finishSpendingApproval(id,false,'Approval timed out'),90_000);
  pending={request,resolve,reject,timeout};
  emit();
 });
}
export function createPaymentApprovalObserver():PaymentObserver {
 return {
  beforeSend:async payments=>requestSpendingApproval(payments),
  afterSend:async()=>{}
 };
}
if(typeof document!=='undefined'){
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')lockSpendingSession('Wallet backgrounded during approval');
 });
 window.addEventListener('pagehide',()=>lockSpendingSession('Wallet page suspended'));
 window.addEventListener('storage',event=>{
  if(event.key===null || event.key.startsWith('gys:wallet-vault:') || event.key==='walletMnemonic')
   lockSpendingSession('Wallet storage changed in another tab');
 });
}
