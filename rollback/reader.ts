/** Containment rollback reader. No wallet SDK, signing, storage mutation or network. */
export const VAULT_KEY='gys:wallet-vault:v1';
const HINT_KEY='gys:wallet-vault:recovery-fingerprint:v1';
const AAD=new TextEncoder().encode('GetYourSats browser mnemonic vault v1');
const text=new TextEncoder();
function bytes(value:unknown,size?:number):Uint8Array<ArrayBuffer>{
 if(typeof value!=='string'||value.length>16_384)throw new Error('Invalid wallet record');
 const binary=atob(value),data=Uint8Array.from(binary,c=>c.charCodeAt(0));
 if(size!==undefined&&data.length!==size)throw new Error('Invalid wallet record');
 if(btoa(binary)!==value)throw new Error('Invalid wallet record');
 return data;
}
function record(raw:string):Record<string,unknown>{
 if(raw.length>20_000)throw new Error('Wallet record exceeds supported size');
 const r:unknown=JSON.parse(raw);
 if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('Invalid wallet record');
 const v=r as Record<string,unknown>;
 if(v.v!==1||v.cipher!=='AES-GCM'||v.kdf!=='PBKDF2-SHA256'||v.iterations!==650_000)
  throw new Error('This rollback reader does not support this wallet format. Keep all original data.');
 bytes(v.salt,16);bytes(v.iv,12);bytes(v.recoveryFingerprint,32);
 if(bytes(v.ciphertext).length<17)throw new Error('Invalid wallet record');
 return v;
}
export type Inventory=Readonly<{vault:'supported'|'missing'|'damaged-or-unsupported';legacyPresent:boolean;
 paymentRecords:number;signedRecoveries:number;exitPlans:number;pendingExits:number;unrecognizedRecords:number;quarantinedRecords:number}>;
export function inventory(storage:Storage=localStorage):Inventory{
 const result={vault:'missing' as Inventory['vault'],legacyPresent:storage.getItem('walletMnemonic')!==null,
  paymentRecords:0,signedRecoveries:0,exitPlans:0,pendingExits:0,unrecognizedRecords:0,quarantinedRecords:0};
 const raw=storage.getItem(VAULT_KEY);
 if(raw!==null){try{record(raw);result.vault='supported';}catch{result.vault='damaged-or-unsupported';}}
 for(let i=0;i<storage.length;i++){
  const key=storage.key(i)??'';
  if(key.startsWith('gys:wallet-vault:preserved-previous:')||key.startsWith('gys:wallet-recovery:preserved-manifest:')){result.quarantinedRecords++;continue;}
  let expected:number|undefined;
  if(key.startsWith('gys:payment-journal:')||key.startsWith('gys:incoming-claim:')||key.startsWith('gys:deposit-claim:')){result.paymentRecords++;expected=1;}
  else if(key.startsWith('gys:signed-recovery:')){result.signedRecoveries++;expected=1;}
  else if(key.startsWith('recovery-plan:')){result.exitPlans++;expected=5;}
  else if(key.startsWith('unilateral-exit-pending:')){result.pendingExits++;expected=2;}
  if(expected!==undefined){
   try{
    const r:unknown=JSON.parse(storage.getItem(key)??'');
    if(!r||typeof r!=='object'||![expected,...(expected===5?[4]:[])].includes(Number(Reflect.get(r,'version'))))result.unrecognizedRecords++;
   }catch{result.unrecognizedRecords++;}
  }
 }
 return Object.freeze(result);
}
/** Returns original recovery words only after authenticating the original
 * ciphertext and matching its fingerprint. The caller clears all UI references
 * on background, timeout or storage change. No plaintext is persisted. */
export async function readRecoveryWords(password:string,storage:Storage=localStorage,stillAllowed:()=>boolean=()=>document.visibilityState==='visible'):Promise<string>{
 const raw=storage.getItem(VAULT_KEY),hint=storage.getItem(HINT_KEY);
 if(raw===null)throw new Error('No supported encrypted phrase is stored here. Existing passkey and SDK records are untouched.');
 if(password.length<1||password.length>256||!stillAllowed())throw new Error('Unlock cancelled');
 const r=record(raw);
 const source=await crypto.subtle.importKey('raw',text.encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes(r.salt,16),iterations:650_000},source,{name:'AES-GCM',length:256},false,['decrypt']);
 let plaintext:ArrayBuffer;
 try{plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(r.iv,12),additionalData:AAD},key,bytes(r.ciphertext));}
 catch{throw new Error('Incorrect password or damaged wallet data. No stored data was changed.');}
 const data=new Uint8Array(plaintext);
 let words:string;
 try{words=new TextDecoder('utf-8',{fatal:true}).decode(data);}finally{data.fill(0);}
 if(!/^(?:[a-z]+ ){11,23}[a-z]+$/.test(words))throw new Error('Invalid recovery phrase in wallet record');
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',text.encode(words)));
 const fingerprint=btoa(String.fromCharCode(...digest));
 if(fingerprint!==r.recoveryFingerprint)throw new Error('Wallet identity fingerprint mismatch');
 // A malformed independent hint need not destroy a valid authenticated vault,
 // but two valid conflicting fingerprints must not be silently reconciled.
 if(hint!==null){let valid=false;try{valid=bytes(hint,32).length===32;}catch{/* preserved */}
  if(valid&&hint!==fingerprint)throw new Error('Conflicting wallet identity records. Keep this browser profile.');}
 if(!stillAllowed()||storage.getItem(VAULT_KEY)!==raw||storage.getItem(HINT_KEY)!==hint)throw new Error('Wallet state changed during unlock');
 return words;
}
