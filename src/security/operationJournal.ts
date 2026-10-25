import type {Network, Payment} from '@breeztech/breez-sdk-spark';

const PREFIX='gys:payment-journal:v1:';
const EVENT='gys:payment-journal-changed';
export type OperationState='submitting'|'unknown'|'pending'|'completed'|'returned';
export type OperationRecord=Readonly<{
  version:1; walletKey:string; operationId:string; paymentId:string;
  intentHash:string; recipientHash?:string; network:Network; route:'spark'|'lightning'|'bitcoin';
  amountSats:string; feeLimitSats:string; state:OperationState;
  createdAt:number; updatedAt:number;
}>;
export class UncertainPaymentError extends Error {
  constructor(public readonly operationId:string) {
    super('A payment is still pending or its outcome is unknown. Check payment status before sending again.');
    this.name='UncertainPaymentError';
  }
}
function canonical(value:unknown):string {
  if(typeof value==='bigint')return JSON.stringify({bigint:value.toString()});
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value)
    .filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value)??'null';
}
export async function journalDigest(value:unknown):Promise<string>{
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))));
  return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
/** A non-reversible recipient binding; never persist the invoice or address. */
export async function recipientCommitment(rail:'spark'|'lightning'|'bitcoin',recipient:string):Promise<string>{
 let canonical=recipient;
 if(rail==='spark'||rail==='lightning'||/^(bc1|tb1|bcrt1)/i.test(recipient))canonical=recipient.toLowerCase();
 const bytes=new TextEncoder().encode(rail+'\0'+canonical);
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function operationWalletKey(network:Network,identityPubkey:string):Promise<string>{
  if(!identityPubkey)throw new Error('Connected wallet identity is unavailable');
  return journalDigest({network,identityPubkey});
}
function key(record:Pick<OperationRecord,'walletKey'|'operationId'>):string{
  return PREFIX+record.walletKey+':'+record.operationId;
}
function valid(value:unknown,walletKey:string):value is OperationRecord{
  if(!value||typeof value!=='object')return false;
  const r=value as OperationRecord;
  return r.version===1&&r.walletKey===walletKey&&/^[0-9a-f]{64}$/.test(r.walletKey)&&
    /^[0-9a-f-]{36}$/.test(r.operationId)&&typeof r.paymentId==='string'&&r.paymentId.length>0&&r.paymentId.length<256&&
    /^[0-9a-f]{64}$/.test(r.intentHash)&&(r.recipientHash===undefined||/^[0-9a-f]{64}$/.test(r.recipientHash))&&['mainnet','regtest','signet'].includes(r.network)&&
    ['spark','lightning','bitcoin'].includes(r.route)&&/^\d+$/.test(r.amountSats)&&/^\d+$/.test(r.feeLimitSats)&&
    ['submitting','unknown','pending','completed','returned'].includes(r.state)&&
    Number.isSafeInteger(r.createdAt)&&Number.isSafeInteger(r.updatedAt)&&r.createdAt>=0&&r.updatedAt>=r.createdAt;
}
export function hasOperationRecords():boolean {
  for(let i=0;i<localStorage.length;i++)if(localStorage.key(i)?.startsWith(PREFIX))return true;
  return false;
}
function readMatchingOperations(walletKey?:string):ReadonlyArray<OperationRecord>{
  const records:OperationRecord[]=[];
  const prefix=walletKey===undefined?PREFIX:PREFIX+walletKey+':';
  for(let i=0;i<localStorage.length;i++){
    const storageKey=localStorage.key(i);
    if(!storageKey?.startsWith(prefix))continue;
    let parsed:unknown;
    try{parsed=JSON.parse(localStorage.getItem(storageKey)??'null')}catch{throw new Error('Payment status records are damaged. Spending is paused until recovery.');}
    const expectedWallet=walletKey??storageKey.slice(PREFIX.length).split(':',1)[0];
    if(!valid(parsed,expectedWallet)||key(parsed)!==storageKey)throw new Error('Payment status records are damaged. Spending is paused until recovery.');
    records.push(Object.freeze(parsed));
  }
  return Object.freeze(records.sort((a,b)=>b.createdAt-a.createdAt));
}
export function readOperations(walletKey:string):ReadonlyArray<OperationRecord>{
  return readMatchingOperations(walletKey);
}
// Origin-wide data removal must account for every wallet and network, including
// malformed records whose owner cannot be safely determined. Never delete them.
export function readAllOperations():ReadonlyArray<OperationRecord>{
  return readMatchingOperations();
}
export function isUnresolved(record:OperationRecord):boolean{
  return record.state==='submitting'||record.state==='unknown'||record.state==='pending';
}
export function writeOperation(record:OperationRecord):OperationRecord{
  if(!valid(record,record.walletKey))throw new Error('Invalid payment status record');
  // Persist an explicit schema so accidental extra SDK fields never become a
  // secondary invoice/credential copy in browser storage.
  const {version,walletKey,operationId,paymentId,intentHash,recipientHash,network,route,amountSats,feeLimitSats,state,createdAt,updatedAt}=record;
  const safeRecord:OperationRecord={version,walletKey,operationId,paymentId,intentHash,recipientHash,network,route,amountSats,feeLimitSats,state,createdAt,updatedAt};
  const serialized=JSON.stringify(safeRecord);
  localStorage.setItem(key(record),serialized);
  if(localStorage.getItem(key(record))!==serialized)throw new Error('Payment status could not be saved; spending is paused');
  window.dispatchEvent(new Event(EVENT));
  return Object.freeze(safeRecord);
}
export function updateOperation(record:OperationRecord,update:Partial<Pick<OperationRecord,'state'|'paymentId'>>):OperationRecord{
  return writeOperation({...record,...update,updatedAt:Math.max(Date.now(),record.updatedAt)});
}
export function operationFromPayment(record:OperationRecord,payment:Payment):OperationRecord{
  // A local missing record is not failure. A returned payment must name this exact
  // operation and agree with the economic bounds before it can resolve the block.
  const method=record.route==='bitcoin'?'withdraw':record.route;
  if(payment.id!==record.paymentId||payment.paymentType!=='send'||payment.method!==method||
      payment.amount.toString()!==record.amountSats||payment.fees<0n||payment.fees>BigInt(record.feeLimitSats)||
      !['pending','completed','failed'].includes(payment.status))
    throw new Error('Payment status does not match the authorized operation');
  // SDK 'failed' is lossy and can include delivery with incomplete preimage handling.
  // Keep the operation blocked until stronger settlement/return evidence exists.
  return updateOperation(record,{state:payment.status==='failed'?'unknown':payment.status});
}
export async function withOperationLock<T>(walletKey:string,action:()=>Promise<T>):Promise<T>{
  if(!navigator.locks?.request)throw new Error('This browser cannot safely coordinate wallet payments across tabs');
  // Removal wipes the whole origin. Every candidate operation must first hold
  // this origin lock, even when two tabs use different wallets or networks.
  // Keep the wallet lock for compatibility with prior per-wallet participants;
  // always acquire origin then wallet, never the reverse.
  return navigator.locks.request('gys:origin-wallet-operations:v1',{mode:'exclusive',ifAvailable:true},async originLock=>{
    if(!originLock)throw new Error('Another tab is checking or sending a wallet payment');
    return navigator.locks.request('gys:wallet-spend:'+walletKey,{mode:'exclusive',ifAvailable:true},async walletLock=>{
      if(!walletLock)throw new Error('Another tab is checking or sending a wallet payment');
      return action();
    });
  });
}
export function subscribeOperationJournal(listener:()=>void):()=>void{
  const storage=(event:StorageEvent)=>{if(event.key===null||event.key.startsWith(PREFIX))listener()};
  window.addEventListener(EVENT,listener);window.addEventListener('storage',storage);
  return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',storage)};
}
