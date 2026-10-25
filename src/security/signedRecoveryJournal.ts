import type {Network,RecoverFundsResponse,RefundDepositRequest} from '@breeztech/breez-sdk-spark';

export const RECOVERY_JOURNAL_PREFIX='gys:signed-recovery:v1:';
export const RECOVERY_JOURNAL_EVENT='gys:signed-recovery-changed';
export type RecoveryState='authorized'|'signed'|'broadcasting'|'uncertain'|'submitted'|'confirmed';
export type SignedRecoveryTx=Readonly<{txId:string;txHex:string;childHex?:string;state:'signed'|'uncertain'|'submitted'|'confirmed'}>;
export type RecoveryRecord=Readonly<{
 version:1; walletKey:string; operationId:string; network:Network;
 purpose:'refund'|'exit'; destination:string; amountSats:string; feeLimitSats:string;
 intentHash:string; state:RecoveryState; revision:number; createdAt:number; updatedAt:number;
 refund?:RefundDepositRequest; recovery?:RecoverFundsResponse;
 transactions:ReadonlyArray<SignedRecoveryTx>;
}>;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const hex=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=8_000_000&&/^(?:[0-9a-fA-F]{2})+$/.test(v);
const amount=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&BigInt(v)<=2_100_000_000_000_000n;
function valid(r:RecoveryRecord):boolean {
 if(!r||typeof r!=='object'||r.version!==1||!hash(r.walletKey)||!hash(r.intentHash)||
    !/^[0-9a-f-]{36}$/.test(r.operationId)||!['mainnet','regtest','signet'].includes(r.network)||
    !['refund','exit'].includes(r.purpose)||typeof r.destination!=='string'||r.destination.length<1||r.destination.length>256||
    !amount(r.amountSats)||!amount(r.feeLimitSats)||
    !['authorized','signed','broadcasting','uncertain','submitted','confirmed'].includes(r.state)||
    !Number.isSafeInteger(r.revision)||r.revision<0||!Number.isSafeInteger(r.createdAt)||r.createdAt<0||
    !Number.isSafeInteger(r.updatedAt)||r.updatedAt<r.createdAt||!Array.isArray(r.transactions)||r.transactions.length>2000)return false;
 if(r.transactions.some(t=>!hash(t.txId)||!hex(t.txHex)||(t.childHex!==undefined&&!hex(t.childHex))||
      !['signed','uncertain','submitted','confirmed'].includes(t.state)))return false;
 if(new Set(r.transactions.map(t=>t.txId)).size!==r.transactions.length)return false;
 if(r.purpose==='refund') {
  const q=r.refund;
  if(!q||r.recovery!==undefined||!hash(q.txid)||!Number.isSafeInteger(q.vout)||q.vout<0||q.vout>0xffffffff||
    q.destinationAddress!==r.destination||q.fee.type!=='fixed'||!Number.isSafeInteger(q.fee.amount)||q.fee.amount<0||
    String(q.fee.amount)!==r.feeLimitSats||r.transactions.length>1)return false;
 }else{
  const x=r.recovery;
  if(r.refund!==undefined||!x||x.destination!==r.destination||!Array.isArray(x.transactions)||x.transactions.length<1||
    x.transactions.length>2000||!Array.isArray(x.leaves)||!Array.isArray(x.fundingInputs)||
    !Number.isSafeInteger(x.totalFeeSats)||x.totalFeeSats<0||String(x.totalFeeSats)!==r.feeLimitSats||
    !Number.isSafeInteger(x.recoverableValueSats)||String(x.recoverableValueSats)!==r.amountSats)return false;
  if(x.transactions.some(t=>!hash(t.txid)||!hex(t.txHex)||!Array.isArray(t.dependsOn)||
      (t.cpfpTxHex!==undefined&&!hex(t.cpfpTxHex))))return false;
 }
 if(r.state!=='authorized'&&r.state!=='uncertain'&&r.transactions.length===0)return false;
 return true;
}
function key(r:Pick<RecoveryRecord,'walletKey'|'operationId'>):string{return RECOVERY_JOURNAL_PREFIX+r.walletKey+':'+r.operationId;}
function freeze<T>(value:T):T {
 if(value&&typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);}
 return value;
}
function parse(raw:string,storageKey:string):RecoveryRecord {
 let value:RecoveryRecord;
 try{value=JSON.parse(raw) as RecoveryRecord;}catch{throw new Error('Recovery records are damaged. Keep the wallet data; new spending is paused.');}
 if(!valid(value)||key(value)!==storageKey)throw new Error('Recovery records are incompatible or damaged. Keep the wallet data.');
 return freeze(value);
}
export function readRecoveries(walletKey?:string):ReadonlyArray<RecoveryRecord>{
 const result:RecoveryRecord[]=[];
 for(let i=0;i<localStorage.length;i++){
  const k=localStorage.key(i);if(!k?.startsWith(RECOVERY_JOURNAL_PREFIX))continue;
  // Parse every origin record, including unknown versions. Removal is origin-wide.
  const record=parse(localStorage.getItem(k)??'',k);
  if(walletKey===undefined||record.walletKey===walletKey)result.push(record);
 }
 return Object.freeze(result.sort((a,b)=>a.createdAt-b.createdAt));
}
export const recoveryUnresolved=(r:RecoveryRecord):boolean=>r.state!=='confirmed';
export function assertNoUnresolvedRecovery(walletKey?:string):void{
 if(readRecoveries(walletKey).some(recoveryUnresolved))
  throw new Error('A signed recovery is pending. Resume or check that operation before starting another payment or removing this wallet.');
}
/** Caller holds the origin/wallet operation lock. The compare-and-swap also
 * catches stale in-memory writers. Never delete or downgrade another record. */
export function writeRecovery(record:RecoveryRecord,previous:RecoveryRecord|null=null):RecoveryRecord{
 if(!valid(record))throw new Error('Invalid signed-recovery record');
 const storageKey=key(record),existing=localStorage.getItem(storageKey);
 if(previous===null){if(existing!==null)throw new Error('Recovery operation already exists');}
 else {
  if(key(previous)!==storageKey||existing!==JSON.stringify(previous)||record.revision!==previous.revision+1)
   throw new Error('Recovery state changed in another operation; reload it before continuing');
  if(record.walletKey!==previous.walletKey||record.network!==previous.network||record.purpose!==previous.purpose||
     record.destination!==previous.destination||record.amountSats!==previous.amountSats||record.feeLimitSats!==previous.feeLimitSats||
     record.intentHash!==previous.intentHash||record.createdAt!==previous.createdAt||
     JSON.stringify(record.refund)!==JSON.stringify(previous.refund)||JSON.stringify(record.recovery)!==JSON.stringify(previous.recovery))
   throw new Error('Recovery authorization cannot be replaced');
  if(previous.transactions.length&&JSON.stringify(record.transactions.map(({state:_,...tx})=>tx))!==
      JSON.stringify(previous.transactions.map(({state:_,...tx})=>tx)))throw new Error('Signed recovery bytes cannot be replaced');
 }
 // Explicit schema: accidental SDK fields never turn into a secondary seed copy.
 const {version,walletKey,operationId,network,purpose,destination,amountSats,feeLimitSats,intentHash,state,revision,createdAt,updatedAt,refund,recovery,transactions}=record;
 const safe={version,walletKey,operationId,network,purpose,destination,amountSats,feeLimitSats,intentHash,state,revision,createdAt,updatedAt,
   ...(refund?{refund:{txid:refund.txid,vout:refund.vout,destinationAddress:refund.destinationAddress,fee:{type:'fixed' as const,amount:refund.fee.type==='fixed'?refund.fee.amount:0}}}:{}),
   ...(recovery?{recovery}:{}),transactions:transactions.map(({txId,txHex,childHex,state})=>({txId,txHex,...(childHex?{childHex}:{}),state}))};
 const serialized=JSON.stringify(safe);
 // Web Storage writes are atomic. An error must propagate before broadcast.
 // Do not restore an older value blindly after a race or clear any data.
 localStorage.setItem(storageKey,serialized);
 if(localStorage.getItem(storageKey)!==serialized)throw new Error('Recovery could not be durably saved; no new broadcast is permitted');
 window.dispatchEvent(new Event(RECOVERY_JOURNAL_EVENT));
 return parse(serialized,storageKey);
}
export function updateRecovery(r:RecoveryRecord,update:Partial<Pick<RecoveryRecord,'state'|'transactions'>>):RecoveryRecord{
 return writeRecovery({...r,...update,revision:r.revision+1,updatedAt:Math.max(Date.now(),r.updatedAt)},r);
}
export function subscribeRecoveries(listener:()=>void):()=>void{
 const storage=(event:StorageEvent)=>{if(event.key===null||event.key.startsWith(RECOVERY_JOURNAL_PREFIX))listener();};
 window.addEventListener(RECOVERY_JOURNAL_EVENT,listener);window.addEventListener('storage',storage);
 return()=>{window.removeEventListener(RECOVERY_JOURNAL_EVENT,listener);window.removeEventListener('storage',storage);};
}
