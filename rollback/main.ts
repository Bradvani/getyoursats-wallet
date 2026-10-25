import {inventory,readRecoveryWords} from './reader';
import './style.css';
function element<T extends HTMLElement>(id:string):T{const e=document.getElementById(id);if(!e)throw new Error('Recovery interface missing');return e as T;}
const password=element<HTMLInputElement>('password'),unlock=element<HTMLButtonElement>('unlock'),message=element('message');
const words=element('words'),revealer=element('revealer'),privateCheck=element<HTMLInputElement>('private'),reveal=element<HTMLButtonElement>('reveal');
let secret:string|null=null,epoch=0,working=false,timer:ReturnType<typeof setTimeout>|undefined;
function lock(reason='Recovery view locked. Stored wallet data is unchanged.'){
 epoch++;secret=null;password.value='';words.textContent='';words.hidden=true;revealer.hidden=true;privateCheck.checked=false;reveal.disabled=true;
 if(timer)clearTimeout(timer);timer=undefined;message.textContent=reason;
}
function refreshInventory(){
 const list=element('inventory');list.replaceChildren();
 try{
  const state=inventory();
  for(const [label,value] of [['Encrypted phrase vault',state.vault],['Payment journal records',state.paymentRecords],['Signed recovery records',state.signedRecoveries],['Saved exit plans',state.exitPlans],['Pending exits',state.pendingExits],['Preserved older records',state.quarantinedRecords]]){
   const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=String(label);dd.textContent=String(value);list.append(dt,dd);
  }
  element('compatibility').textContent=state.unrecognizedRecords?
   'Some records are damaged or from another version. They have been retained unchanged. Do not delete them.':
   'Records are retained in place. Reading this page does not mark any payment complete or retry any transaction.';
  unlock.disabled=state.vault!=='supported'||controlledByOldWorker();
 }catch{unlock.disabled=true;element('compatibility').textContent='Browser storage could not be read. Nothing has been removed or replaced.';}
}
function controlledByOldWorker():boolean{return !!navigator.serviceWorker?.controller;}
element<HTMLFormElement>('unlock-form').addEventListener('submit',async event=>{
 event.preventDefault();if(working)return;
 if(controlledByOldWorker()){message.textContent='An existing service worker controls this page. The operator must complete the verified rollback cutover before recovery can unlock. Do not clear wallet storage.';return;}
 const current=++epoch;working=true;unlock.disabled=true;message.textContent='Checking encrypted wallet locally…';
 const entered=password.value;password.value='';
 try{
  const recovered=await readRecoveryWords(entered,localStorage,()=>current===epoch&&document.visibilityState==='visible'&&!controlledByOldWorker());
  if(current!==epoch)return;
  secret=recovered;revealer.hidden=false;message.textContent='Original encrypted recovery words verified. Nothing has been written to storage.';
  timer=setTimeout(()=>lock(),60_000);
 }catch(e){if(current===epoch)message.textContent=e instanceof Error?e.message:'Could not unlock. Stored data is unchanged.';}
 finally{working=false;refreshInventory();}
});
privateCheck.addEventListener('change',()=>{reveal.disabled=!privateCheck.checked||secret===null;});
reveal.addEventListener('click',()=>{
 if(controlledByOldWorker()){lock('Rollback cutover is not complete. Recovery view locked.');refreshInventory();return;}
 if(!privateCheck.checked||secret===null||document.visibilityState!=='visible')return;
 words.textContent=secret;words.hidden=false;
});
element('lock').addEventListener('click',()=>lock());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')lock();});
window.addEventListener('pagehide',()=>lock());
navigator.serviceWorker?.addEventListener('controllerchange',()=>{
 // A worker can claim an already-open page. Revoke in-flight decryption and
 // revealed secrets immediately, even if the page was uncontrolled at startup.
 lock('Service worker control changed. Complete rollback cutover and reload before unlocking.');
 refreshInventory();
});
window.addEventListener('pageshow',()=>{
 if(controlledByOldWorker())lock('Rollback cutover is not complete. Recovery view locked.');
 refreshInventory();
});
window.addEventListener('storage',()=>{lock('Wallet storage changed in another tab. Re-authentication is required.');refreshInventory();});
refreshInventory();
if(controlledByOldWorker()){unlock.disabled=true;message.textContent='Rollback cutover is not complete: an existing service worker still controls this page. Do not clear wallet storage.';}
