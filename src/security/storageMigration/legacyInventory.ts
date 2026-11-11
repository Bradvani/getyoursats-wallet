import type {Network} from '@breeztech/breez-sdk-spark';
import schemas from './pinnedSchemas.json';
import {existingDatabase,databaseSchema,snapshotDatabase,snapshotDigest,failure,OWNER_STORE,type DatabaseSchema} from './database';

export type LegacySourceInventory=Readonly<{
 name:string;role:'sdk'|'tree';version:number;present:boolean;ownerVerified:false;
 digest?:string;rows?:number;stores?:readonly Readonly<{name:string;rows:number}>[];
}>;
export type LegacyReadOnlyInventory=Readonly<{
 network:Network;mode:'read-only-quarantine';sources:readonly LegacySourceInventory[];
 totalRows:number;canAdmit:boolean;
}>;
const schema=(r:DatabaseSchema)=>JSON.stringify({
 version:r.version,stores:[...r.stores].sort((a,b)=>a.name.localeCompare(b.name)).map(x=>({
 name:x.name,keyPath:x.keyPath,autoIncrement:x.autoIncrement,indexes:[...x.indexes].sort((a,b)=>a.name.localeCompare(b.name))
 }))});
/** Forensics, not migration authorization: never derives an owner from a shared path. */
export async function inventoryUntaggedLegacyWallet(root:string,network:Network,current:()=>void):Promise<LegacyReadOnlyInventory>{
 current();
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(root)||
    !['mainnet','regtest','signet'].includes(network))
  throw failure('INCOMPATIBLE','Unsupported legacy wallet location.');
 if(typeof indexedDB?.databases!=='function')throw failure('UNAVAILABLE','Database inventory is unavailable.');
 const entries=await indexedDB.databases();current();
 if(!Array.isArray(entries)||entries.some(e=>!e||typeof e.name!=='string'||!Number.isSafeInteger(e.version)))
  throw failure('UNAVAILABLE','Legacy storage inventory is invalid.');
 const suffix=network==='mainnet'?'9ce7940a':'2687e55a',base=root+'/'+network+'/'+suffix;
 const definitions=[{name:base,role:'sdk' as const,pinned:schemas.sdk},
  {name:base+'-tree',role:'tree' as const,pinned:schemas.tree}];
 const sources:LegacySourceInventory[]=[];
 for(const def of definitions){
  current();
  const names=entries.filter(x=>x.name===def.name);
  if(names.length>1)throw failure('CONFLICT','Duplicate legacy database inventory.');
  if(!names.length){sources.push(Object.freeze({name:def.name,role:def.role,version:def.pinned.version,present:false,ownerVerified:false}));continue;}
  if(names[0].version!==def.pinned.version)
   throw failure('INCOMPATIBLE','Old wallet database requires a separate supported-version review.');
  const db=await existingDatabase(def.name,current);
  if(!db)throw failure('CONFLICT','Legacy database changed during inspection.');
  try{
   current();
   if(db.version!==def.pinned.version||db.objectStoreNames.contains(OWNER_STORE)||
      schema(databaseSchema(db))!==schema(def.pinned as DatabaseSchema))
    throw failure('INCOMPATIBLE','Historical wallet database schema is incompatible.');
   const first=await snapshotDatabase(db,def.pinned.version,current);
   const digest=await snapshotDigest(first);
   current();
   const again=await snapshotDatabase(db,def.pinned.version,current);
   if(await snapshotDigest(again)!==digest)
    throw failure('INTERRUPTED','Historical records changed while being inspected.');
   current();
   const stores=Object.freeze(first.rows.map(s=>Object.freeze({name:s.name,rows:s.entries.length})));
   const rows=stores.reduce((n,s)=>n+s.rows,0);
   sources.push(Object.freeze({name:def.name,role:def.role,version:db.version,present:true,ownerVerified:false,digest,rows,stores}));
  }finally{db.close();}
 }
 const totalRows=sources.reduce((n,s)=>n+(s.rows??0),0);
 return Object.freeze({network,mode:'read-only-quarantine',sources:Object.freeze(sources),totalRows,canAdmit:false});
}
