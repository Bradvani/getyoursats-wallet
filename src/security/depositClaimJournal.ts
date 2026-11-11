/** Durable claim state. Callers must hold the origin/wallet operation lock.
 * No automatic retry or delete API: a missing receipt is never proof of failure. */
import type {ClaimRecord} from './depositClaimAuthorization';
export const CLAIM_JOURNAL_PREFIX='gys:deposit-claim:v1:';
export type DepositContinuationAttempt=Readonly<{version:1;attemptId:string;correlationId:string;intentHash:string;transferId:string;sspRequestId:string;startedAt:number;expiresAt:number}>;
export type StoredClaim=Readonly<ClaimRecord&{version:1;walletKey:string;revision:number;continuation?:DepositContinuationAttempt}>;
function validContinuation(c:DepositContinuationAttempt):boolean{
 const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
 const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
 return !!c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')==='attemptId,correlationId,expiresAt,intentHash,sspRequestId,startedAt,transferId,version'
  &&c.version===1&&uuid(c.attemptId)&&hash(c.correlationId)&&hash(c.intentHash)&&uuid(c.transferId)
  &&typeof c.sspRequestId==='string'&&c.sspRequestId.length>0&&c.sspRequestId.length<=256
  &&Number.isSafeInteger(c.startedAt)&&c.startedAt>0&&Number.isSafeInteger(c.expiresAt)&&c.expiresAt>c.startedAt&&c.expiresAt-c.startedAt<=90000;
}
function valid(r:StoredClaim):boolean{
 const i=r?.intent;
 return !!i&&r.version===1&&typeof r.walletKey==='string'&&/^[0-9a-f]{64}$/.test(r.walletKey)&&Number.isSafeInteger(r.revision)&&r.revision>=0&&
 ['mainnet','regtest','signet'].includes(i.network)&&typeof i.txid==='string'&&/^[0-9a-f]{64}$/.test(i.txid)&&Number.isSafeInteger(i.vout)&&i.vout>=0&&i.vout<=0xffffffff&&
 Number.isSafeInteger(i.amountSats)&&i.amountSats>0&&i.amountSats<=2_100_000_000_000_000&&
 Number.isSafeInteger(i.maxFeeSats)&&i.maxFeeSats>=0&&i.maxFeeSats<i.amountSats&&i.minimumCreditSats===i.amountSats-i.maxFeeSats&&
 Number.isSafeInteger(i.expiresAt)&&i.expiresAt>=60_000&&['submitting','uncertain','settled'].includes(r.state)&&
 (r.continuation===undefined||validContinuation(r.continuation))&&
 (r.state==='settled'?typeof r.paymentId==='string'&&r.paymentId.length>0&&r.paymentId.length<256:r.paymentId===undefined);
}
const key=(r:StoredClaim)=>CLAIM_JOURNAL_PREFIX+r.walletKey+':'+r.intent.txid+':'+r.intent.vout;
function parse(raw:string,k:string):StoredClaim{
 let r:StoredClaim;try{r=JSON.parse(raw);}catch{throw Error('Claim records are damaged. Preserve wallet data.');}
 if(!valid(r)||key(r)!==k)throw Error('Claim records are incompatible. Preserve wallet data.');
 return Object.freeze({...r,intent:Object.freeze(r.intent),...(r.continuation?{continuation:Object.freeze(r.continuation)}:{})});
}
export function readDepositClaims(storage:Storage=localStorage):readonly StoredClaim[]{
 const rows:StoredClaim[]=[];
 for(let n=0;n<storage.length;n++){
  const k=storage.key(n);if(k?.startsWith('gys:deposit-claim:'))rows.push(parse(storage.getItem(k)??'',k));
 }
 return Object.freeze(rows);
}
export function saveDepositClaim(walletKey:string,record:ClaimRecord,previous:StoredClaim|null,storage:Storage=localStorage):StoredClaim{
 const i=record.intent;
 // Explicit schema prevents extra request/SDK fields becoming secret copies.
 const next:StoredClaim={version:1,walletKey,revision:previous?previous.revision+1:0,state:record.state,
 intent:{network:i.network,txid:i.txid,vout:i.vout,amountSats:i.amountSats,maxFeeSats:i.maxFeeSats,minimumCreditSats:i.minimumCreditSats,expiresAt:i.expiresAt},
 ...(record.paymentId!==undefined?{paymentId:record.paymentId}:{}),...(previous?.continuation?{continuation:previous.continuation}:{})};
 if(!valid(next))throw Error('Invalid claim journal record');
 const k=key(next),existing=storage.getItem(k);
 if(previous===null){
  if(existing!==null||next.state!=='submitting')throw Error('Claim already exists or has no submitting intent');
 }else{
  if(key(previous)!==k||existing!==JSON.stringify(previous)||JSON.stringify(previous.intent)!==JSON.stringify(next.intent)||
    previous.state==='settled'||next.state==='submitting')throw Error('Claim changed or cannot be retried');
 }
 const serialized=JSON.stringify(next);storage.setItem(k,serialized);
 if(storage.getItem(k)!==serialized)throw Error('Claim persistence failed');
 return parse(serialized,k);
}


/** Call under the same origin/wallet lock. Record one continuation before the
 * SDK can cross its receiving boundary. Never erase it after an error. */
export function reserveDepositContinuation(previous:StoredClaim,attempt:DepositContinuationAttempt,storage:Storage=localStorage):StoredClaim{
 if(previous.state==='settled'||previous.continuation||!validContinuation(attempt))throw Error('Deposit continuation already attempted or invalid. Check its status.');
 const k=key(previous);
 if(storage.getItem(k)!==JSON.stringify(previous))throw Error('Deposit state changed before continuation. Reload its status.');
 const next:StoredClaim={...previous,state:'uncertain',revision:previous.revision+1,continuation:{...attempt}};
 if(!valid(next))throw Error('Invalid continuation record');
 const bytes=JSON.stringify(next);storage.setItem(k,bytes);
 if(storage.getItem(k)!==bytes)throw Error('Deposit continuation could not be durably recorded');
 return parse(bytes,k);
}
