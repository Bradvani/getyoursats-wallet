/** Atomic empty legacy-store fence. Never adopts populated untagged data. */
import type {Network} from '@breeztech/breez-sdk-spark';
import schemas from '../security/storageMigration/pinnedSchemas.json';
import {BrowserSdkStorageError} from './browserSdkStorage';

export const EMPTY_LEGACY_FENCE='__gys_empty_legacy_fence_v1';
type Role='sdk'|'tree';
type FenceRecord=Readonly<{version:1;network:Network;role:Role;source:string;empty:true}>;
const invalid=()=>new BrowserSdkStorageError('LEGACY_SHARED_STORAGE');
const unknown=()=>new BrowserSdkStorageError('STORAGE_PRESENCE_UNKNOWN');
const equal=(a:string[],b:string[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function legacyNames(root:string,network:Network){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(root))throw unknown();
 const suffix=network==='mainnet'?'9ce7940a':network==='regtest'||network==='signet'?'2687e55a':null;
 if(!suffix)throw unknown();
 const base=root+'/'+network+'/'+suffix;
 return [{name:base,role:'sdk' as Role,version:schemas.sdk.version,stores:schemas.sdk.stores.map(s=>s.name).sort()},
  {name:base+'-tree',role:'tree' as Role,version:schemas.tree.version,stores:schemas.tree.stores.map(s=>s.name).sort()}];
}
async function fenceOne(def:ReturnType<typeof legacyNames>[number],network:Network,current:()=>void):Promise<void>{
 let request:IDBOpenDBRequest;
 await new Promise<void>((resolve,reject)=>{
  let settled=false,closed=false,cause:unknown;
  const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve();};
  const timer=setTimeout(()=>{closed=true;finish(unknown());},8000);
  try{current();request=indexedDB.open(def.name,def.version+1);}catch{finish(unknown());return;}
  if(!request||typeof request!=='object'){finish(invalid());return;}
  request.onblocked=()=>{closed=true;finish(unknown());};
  request.onerror=()=>finish(cause??invalid());
  request.onupgradeneeded=e=>{
   const db=request.result,tx=request.transaction!;
   const abort=(error?:unknown)=>{cause=error??invalid();try{tx.abort();}catch{/* already aborted */}};
   try{
    current();
    if(closed||e.oldVersion!==def.version||!equal([...db.objectStoreNames].sort(),def.stores)){abort(invalid());return;}
    // Every count belongs to this version-change transaction. An older SDK
    // cannot write across the successful upgrade; any nonempty row aborts.
    let remaining=def.stores.length;
    if(!remaining){abort(invalid());return;}
    for(const name of def.stores){
     const count=tx.objectStore(name).count();
     count.onerror=()=>abort(invalid());
     count.onsuccess=()=>{
      try{
       current();
       if(closed||count.result!==0){abort(invalid());return;}
       if(--remaining===0){
        const record:FenceRecord={version:1,network,role:def.role,source:def.name,empty:true};
        db.createObjectStore(EMPTY_LEGACY_FENCE).add(record,'fence');
       }
      }catch(error){abort(error);}
     };
    }
   }catch(error){abort(error);}
  };
  request.onsuccess=()=>{
   const db=request.result;
   try{
    current();
    if(closed||db.version!==def.version+1||
      !equal([...db.objectStoreNames].filter(n=>n!==EMPTY_LEGACY_FENCE).sort(),def.stores)||
      !db.objectStoreNames.contains(EMPTY_LEGACY_FENCE))throw invalid();
    const tx=db.transaction([EMPTY_LEGACY_FENCE,...def.stores],'readonly');
    const marker=tx.objectStore(EMPTY_LEGACY_FENCE).get('fence');
    const counts=def.stores.map(name=>tx.objectStore(name).count());
    tx.onabort=()=>{db.close();finish(invalid());};
    tx.onerror=()=>{};
    tx.oncomplete=()=>{
     try{
      current();
      const expected:FenceRecord={version:1,network,role:def.role,source:def.name,empty:true};
      if(closed||JSON.stringify(marker.result)!==JSON.stringify(expected)||counts.some(r=>r.result!==0))throw invalid();
      db.close();finish();
     }catch(error){db.close();finish(error);}
    };
   }catch(error){db.close();finish(error);}
  };
 });
}
/** Unknown, populated or changed storage remains blocked and untouched. */
export async function assertNoUnfencedPopulatedLegacyStorage(root:string,network:Network,current:()=>void):Promise<void>{
 current();if(typeof indexedDB==='undefined'||typeof indexedDB.databases!=='function')throw unknown();
 let inventory:IDBDatabaseInfo[];
 try{inventory=await indexedDB.databases();}catch{throw unknown();}
 current();if(!Array.isArray(inventory)||inventory.some(d=>!d||typeof d.name!=='string'||typeof d.version!=='number'||!Number.isSafeInteger(d.version)))throw unknown();
 for(const def of legacyNames(root,network)){
  const matches=inventory.filter(d=>d.name===def.name);
  if(matches.length>1)throw unknown();
  if(!matches.length)continue;
  if(matches[0].version!==def.version&&matches[0].version!==def.version+1)throw invalid();
  await fenceOne(def,network,current);
  current();
 }
}
