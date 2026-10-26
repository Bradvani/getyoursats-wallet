/** Incoming BTC receipts are single-attempt operations, never retry mandates. */
import type {Network} from '@breeztech/breez-sdk-spark';
export const INCOMING_CLAIM_PREFIX='gys:incoming-claim:v1:';
export const INCOMING_CLAIM_EVENT='gys:incoming-claim-changed';
export type IncomingClaim=Readonly<{version:1;walletKey:string;paymentId:string;network:Network;amountSats:string;
 expiresAt:number;state:'submitting'|'uncertain'|'settled';revision:number}>;
const key=(r:IncomingClaim)=>INCOMING_CLAIM_PREFIX+r.walletKey+':'+r.paymentId;
export const incomingTransferId=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function valid(r:IncomingClaim):boolean{
 return !!r&&r.version===1&&/^[0-9a-f]{64}$/.test(r.walletKey)&&incomingTransferId(r.paymentId)&&
 ['mainnet','regtest','signet'].includes(r.network)&&/^[1-9][0-9]*$/.test(r.amountSats)&&BigInt(r.amountSats)<=2_100_000_000_000_000n&&
 Number.isSafeInteger(r.expiresAt)&&r.expiresAt>0&&Number.isSafeInteger(r.revision)&&r.revision>=0&&
 ['submitting','uncertain','settled'].includes(r.state);
}
export function readIncomingClaims(walletKey?:string):readonly IncomingClaim[]{
 const records:IncomingClaim[]=[];
 for(let i=0;i<localStorage.length;i++){
  const k=localStorage.key(i);if(!k?.startsWith('gys:incoming-claim:'))continue;
  let r:IncomingClaim;try{r=JSON.parse(localStorage.getItem(k)??'null');}catch{throw Error('Incoming payment records are damaged. Preserve wallet data.');}
  if(!valid(r)||key(r)!==k)throw Error('Incoming payment records are incompatible. Preserve wallet data.');
  if(walletKey===undefined||r.walletKey===walletKey)records.push(Object.freeze(r));
 }
 return Object.freeze(records);
}
export function saveIncomingClaim(input:IncomingClaim,previous:IncomingClaim|null=null):IncomingClaim{
 const {version,walletKey,paymentId,network,amountSats,expiresAt,state,revision}=input;
 const next={version,walletKey,paymentId,network,amountSats,expiresAt,state,revision};
 if(!valid(next))throw Error('Invalid incoming claim record');
 const k=key(next),old=localStorage.getItem(k);
 if(previous===null){if(old!==null||state!=='submitting'||revision!==0)throw Error('Incoming transfer already attempted');}
 else if(old!==JSON.stringify(previous)||key(previous)!==k||previous.state==='settled'||state==='submitting'||
  revision!==previous.revision+1||network!==previous.network||amountSats!==previous.amountSats||expiresAt!==previous.expiresAt)
  throw Error('Incoming claim changed; reload its status');
 const data=JSON.stringify(next);localStorage.setItem(k,data);
 if(localStorage.getItem(k)!==data)throw Error('Incoming claim persistence failed');
 window.dispatchEvent(new Event(INCOMING_CLAIM_EVENT));
 return Object.freeze(next);
}
