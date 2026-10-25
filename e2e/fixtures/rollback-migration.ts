import {saveExitState,loadExitState} from '../../src/features/unilateral-exit/exitState';
import {enrollWebWallet,removeMatchingLegacyMnemonic,unlockWebWallet} from '../../src/security/webWalletVault';
import {clearSignerIdentity} from '../../src/security/spendApproval';
const words='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password='disposable-rollback-password-2026';
async function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('gys-disposable-sdk-state',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function putSentinel(){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({identity:'same-disposable-wallet',pendingExit:'never-delete'},'sentinel');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
async function fingerprint(){
 const entries:Record<string,string|null>={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i)!;entries[key]=localStorage.getItem(key);}
 const ordered=Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)));
 const db=await database();let stored:unknown;
 try{stored=await new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly'),request=tx.objectStore('state').get('sentinel');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
 const bytes=new TextEncoder().encode(JSON.stringify({local:ordered,indexed:stored,exit:await loadExitState('disposable-exit-owner')}));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
Object.assign(window,{rollbackFixture:{fingerprint,verifyConcurrentBackups,verifyAbortedBackup,async verifyOriginal(){clearSignerIdentity();return await unlockWebWallet(password)===words;}}});
document.getElementById('migrate')!.addEventListener('click',async()=>{
 const output=document.getElementById('result')!;
 try{
  clearSignerIdentity();localStorage.setItem('walletMnemonic',words);
  await enrollWebWallet(words,password);await removeMatchingLegacyMnemonic(password);
  localStorage.setItem('gys:payment-journal:v1:'+ 'a'.repeat(64)+':11111111-1111-4111-8111-111111111111',JSON.stringify({version:1,walletKey:'a'.repeat(64),operationId:'11111111-1111-4111-8111-111111111111',paymentId:'public-fixture',intentHash:'b'.repeat(64),network:'mainnet',route:'spark',amountSats:'125',feeLimitSats:'0',state:'unknown',createdAt:1,updatedAt:1}));
  localStorage.setItem('gys:signed-recovery:v1:disposable',JSON.stringify({version:1,state:'uncertain',signedBytes:'public-inert-fixture'}));
  localStorage.setItem('recovery-plan:disposable:mainnet',JSON.stringify({version:5,exitStateSnapshot:'public-disposable-snapshot',phase:'active'}));
  localStorage.setItem('unilateral-exit-pending:disposable:mainnet',JSON.stringify({version:2,fundingAddress:'public-disposable-address'}));
  localStorage.setItem('passkey-wallet-id','public-disposable-credential-metadata');
  await saveExitState('disposable-exit-owner','original-public-signed-exit-backup');
  await putSentinel();output.textContent='MIGRATED';
 }catch{output.textContent='FIXTURE FAILED';}
});

async function verifyConcurrentBackups(){
 const original=crypto.subtle.generateKey.bind(crypto.subtle);
 let release!:()=>void,count=0;const both=new Promise<void>(resolve=>{release=resolve;});
 Object.defineProperty(crypto.subtle,'generateKey',{configurable:true,value:async(...args:unknown[])=>{
  const key=await Reflect.apply(original,crypto.subtle,args);if(++count===2)release();await both;return key;
 }});
 try{
  await Promise.all([saveExitState('public-a','exit-a'),saveExitState('public-b','exit-b')]);
  return [await loadExitState('public-a'),await loadExitState('public-b')];
 }finally{Object.defineProperty(crypto.subtle,'generateKey',{configurable:true,value:original});}
}
async function verifyAbortedBackup(){
 await saveExitState('public-abort','original-exit');
 const original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){
  const request=Reflect.apply(original,this,args);
  if(this.name==='exitState')request.addEventListener('success',()=>this.transaction.abort());
  return request;
 };
 let rejected=false;
 try{await saveExitState('public-abort','replacement-exit');}catch{rejected=true;}
 finally{IDBObjectStore.prototype.put=original;}
 return {rejected,retained:await loadExitState('public-abort')};
}
