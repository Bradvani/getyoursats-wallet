import type {Network} from '@breeztech/breez-sdk-spark';
import schemas from './pinnedSchemas.json';
import {OWNER_STORE,StorageMigrationError,createSchema,databaseSchema,durableTransaction,existingDatabase,failure,hex,openDatabase,readRecord,snapshotDatabase,snapshotDigest,transactionDone,type DatabaseSchema,type Snapshot} from './database';

export type OwnerRecord=Readonly<{version:1;identity:string;network:Network;role:'sdk'|'tree';state:'owned'|'fenced'|'retired'|'copying'|'ready'|'active';source:string;target:string;sourceVersion:number;sourceDigest:string|null;emptySource:boolean}>;
type Pair={role:'sdk'|'tree';schema:DatabaseSchema;source:string;target:string};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function validOwner(r:unknown):r is OwnerRecord{
 if(!r||typeof r!=='object'||Array.isArray(r))return false;const x=r as OwnerRecord;
 return Object.keys(x).sort().join(',')==='emptySource,identity,network,role,source,sourceDigest,sourceVersion,state,target,version'
  &&x.version===1&&/^(02|03)[0-9a-f]{64}$/.test(x.identity)&&['mainnet','regtest','signet'].includes(x.network)
  &&['sdk','tree'].includes(x.role)&&['owned','fenced','retired','copying','ready','active'].includes(x.state)
  &&typeof x.source==='string'&&typeof x.target==='string'&&Number.isSafeInteger(x.sourceVersion)&&x.sourceVersion>0
  &&(x.sourceDigest===null||/^[0-9a-f]{64}$/.test(x.sourceDigest))&&typeof x.emptySource==='boolean';
}
function assertOwner(record:unknown,identity:string,network:Network,pair:Pair):asserts record is OwnerRecord{
 if(!validOwner(record)||record.identity!==identity||record.network!==network||record.role!==pair.role
   ||record.source!==pair.source||record.target!==pair.target||record.sourceVersion!==pair.schema.version)
  throw failure('OWNERSHIP_REQUIRED','The saved database has no verified matching wallet ownership. Recovery review is required.');
}
export async function walletStorageNames(root:string,network:Network,identity:string){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(root)||!['mainnet','regtest','signet'].includes(network)||!/^(02|03)[0-9a-f]{64}$/.test(identity))throw failure('INCOMPATIBLE','Invalid wallet storage identity.');
 const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(identity.match(/../g)!,b=>parseInt(b,16)))));
 const directory=`${root}-v2-${hash}`,legacy=`${root}/${network}/${hash.slice(0,8)}`,target=`${directory}/${network}/${hash.slice(0,8)}`;
 const pairs:Pair[]=[{role:'sdk',schema:schemas.sdk as DatabaseSchema,source:legacy,target},{role:'tree',schema:schemas.tree as DatabaseSchema,source:legacy+'-tree',target:target+'-tree'}];
 return {directory,pairs};
}
function expected(record:OwnerRecord,patch:Partial<OwnerRecord>):OwnerRecord{return {...record,...patch};}
async function preflight(pair:Pair,identity:string,network:Network,current:()=>void):Promise<void>{
 for(const [name,target] of [[pair.source,false],[pair.target,true]] as const){
  const db=await existingDatabase(name,current);if(!db)continue;
  try{const owner=await readRecord(db);current();assertOwner(owner,identity,network,pair);
   if(target&&!['copying','ready','active'].includes(owner.state))throw failure('CONFLICT','The destination is not a migration target.');
   if(!target&&!['owned','fenced','retired'].includes(owner.state))throw failure('CONFLICT','The migration source is not in a recognized state.');
   if(db.version!==(target?pair.schema.version:owner.state!=='owned'?pair.schema.version+1:pair.schema.version))throw failure('INCOMPATIBLE','The stored database version is incompatible.');
  }finally{db.close();}
 }
}
async function fence(pair:Pair,identity:string,network:Network,current:()=>void):Promise<IDBDatabase>{
 let cause:unknown;
 const db=await openDatabase(pair.source,pair.schema.version+1,(database,tx,oldVersion)=>{
  const absent=oldVersion===0;
  if(absent){database.createObjectStore(OWNER_STORE).add({version:1,identity,network,role:pair.role,state:'fenced',source:pair.source,target:pair.target,sourceVersion:pair.schema.version,sourceDigest:null,emptySource:true} satisfies OwnerRecord,'owner');return;}
  if(oldVersion!==pair.schema.version||!database.objectStoreNames.contains(OWNER_STORE))throw failure('OWNERSHIP_REQUIRED','Unverified legacy records were preserved.');
  const store=tx.objectStore(OWNER_STORE),request=store.get('owner');
  request.onsuccess=()=>{try{current();assertOwner(request.result,identity,network,pair);if(request.result.state!=='owned')throw failure('CONFLICT','Source migration state changed.');store.put(expected(request.result,{state:'fenced'}),'owner');}catch(e){cause=e;tx.abort();}};
 },current).catch(e=>{throw cause??e;});
 try{const owner=await readRecord(db);current();assertOwner(owner,identity,network,pair);if(owner.state!=='fenced')throw failure('CONFLICT','Source fencing was not committed.');return db;}catch(e){db.close();throw e;}
}
function normalizedSchema(schema:DatabaseSchema){return {...schema,stores:[...schema.stores].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>({...s,indexes:[...s.indexes].sort((a,b)=>a.name.localeCompare(b.name))}))};}
async function sourceSnapshot(db:IDBDatabase,pair:Pair,current:()=>void):Promise<Snapshot>{
 const owner=await readRecord<OwnerRecord>(db);current();
 if(owner!.emptySource){if(databaseSchema(db).stores.length)throw failure('CONFLICT','Unexpected records appeared in a fenced empty source.');return {schema:normalizedSchema(pair.schema),rows:[...pair.schema.stores].sort((a,b)=>a.name.localeCompare(b.name)).map(s=>({name:s.name,entries:[]}))};}
 const snapshot=await snapshotDatabase(db,pair.schema.version,current);
 if(!same(normalizedSchema(snapshot.schema),normalizedSchema(pair.schema)))throw failure('INCOMPATIBLE','Legacy storage schema does not match the verified adapter.');
 return snapshot;
}
async function copy(pair:Pair,owner:OwnerRecord,snapshot:Snapshot,current:()=>void):Promise<IDBDatabase>{
 let created=false;
 const db=await openDatabase(pair.target,pair.schema.version,(database,_tx,version)=>{
  if(version!==0)throw failure('CONFLICT','An unrecognized destination database already exists.');
  created=true;createSchema(database,snapshot.schema);database.createObjectStore(OWNER_STORE).add(expected(owner,{state:'copying'}),'owner');
 },current);
 try{
  const existing=await readRecord(db);current();assertOwner(existing,owner.identity,owner.network,pair);
  if(existing.sourceDigest!==owner.sourceDigest||existing.emptySource!==owner.emptySource)throw failure('CONFLICT','Destination belongs to a different source snapshot.');
  if(!same(normalizedSchema({...databaseSchema(db),version:pair.schema.version}),normalizedSchema(snapshot.schema)))throw failure('INCOMPATIBLE','Destination storage schema differs.');
  if(existing.state==='copying'){
   if(!created){const before=await snapshotDatabase(db,pair.schema.version,current);if(before.rows.some(s=>s.entries.length))throw failure('CONFLICT','An incomplete target contains unexpected data.');}
   const tx=durableTransaction(db,[...db.objectStoreNames]);const done=transactionDone(tx);let cause:unknown;
   try{current();for(const row of snapshot.rows){const store=tx.objectStore(row.name);for(const item of row.entries){if(store.keyPath===null)store.add(item.value,item.key);else store.add(item.value);}}
    tx.objectStore(OWNER_STORE).put(expected(owner,{state:'ready'}),'owner');
   }catch(e){cause=e;tx.abort();}
   try{await done;}catch(e){throw cause??e;}current();
  }else if(existing.state!=='ready')throw failure('CONFLICT','A destination is active outside its paired commit.');
  const after=await snapshotDatabase(db,pair.schema.version,current);if(await snapshotDigest(after)!==owner.sourceDigest)throw failure('CONFLICT','Migration readback differs from its source.');current();return db;
 }catch(e){db.close();throw e;}
}
async function advance(db:IDBDatabase,owner:OwnerRecord,next:OwnerRecord,current:()=>void){
 const tx=durableTransaction(db,[OWNER_STORE]),done=transactionDone(tx);let cause:unknown;
 const request=tx.objectStore(OWNER_STORE).get('owner');request.onsuccess=()=>{try{current();if(!same(request.result,owner))throw failure('CONFLICT','Storage ownership changed before its commit.');tx.objectStore(OWNER_STORE).put(next,'owner');}catch(e){cause=e;tx.abort();}};
 try{await done;}catch(e){throw cause??e;}current();
}
/** Active path for fresh or previously ownership-bound stores. Untagged legacy
 * databases are NEVER assigned to the currently presented seed. A separately
 * reviewed legacy ownership/bridge path is still required for those stores.
 * The owner record protects namespace/lifecycle consistency, not malicious
 * same-origin script. No network, signer, claim, send or database deletion. */
export async function prepareOwnedWalletStorage(options:{root:string;network:Network;identity:string;assertCurrent:()=>void}):Promise<string>{
 const {root,network,identity,assertCurrent:current}=options;current();const {directory,pairs}=await walletStorageNames(root,network,identity);current();
 if(!navigator.locks?.request)throw failure('UNAVAILABLE','This browser cannot coordinate the wallet storage upgrade.');
 return navigator.locks.request(`gys:storage-handover:${root}:${network}`,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)throw failure('CLOSE_OLD_TABS','Another wallet storage upgrade is in progress.');current();
  // Read every existing source/target before fencing or writing either database.
  for(const pair of pairs)await preflight(pair,identity,network,current);
  const targets: Array<IDBDatabase|null>=[], sources: Array<IDBDatabase|null>=[];
  try{
   for(const pair of pairs){sources.push(await existingDatabase(pair.source,current));targets.push(await existingDatabase(pair.target,current));}
   const sr=await Promise.all(sources.map(d=>d?readRecord<OwnerRecord>(d):Promise.resolve(null)));
   const tr=await Promise.all(targets.map(d=>d?readRecord<OwnerRecord>(d):Promise.resolve(null)));current();
   if((sr[0]&&!sr[0].emptySource&&!sr[1])||(sr[1]&&!sr[1].emptySource&&!sr[0]))
    throw failure('CONFLICT','A paired original wallet database is missing. Do not replace it with an empty database.');
   if((tr[0]||tr[1])&&(!sr[0]||!sr[1]))
    throw failure('CONFLICT','A destination exists without its complete source migration record.');
   if(sr[0]?.state==='retired'){
    // A durable source-side commit distinguishes an unused target from one
    // which could already contain newer operations. Never recopy a lost target.
    if(!sources[1]||!targets[0]||!targets[1]||sr[1]?.state!=='fenced'||!tr[0]||!tr[1]
       ||tr[1].state!=='ready'||!['ready','active'].includes(tr[0].state)
       ||!sr[0].sourceDigest||sr[0].sourceDigest!==tr[0].sourceDigest
       ||!sr[1].sourceDigest||sr[1].sourceDigest!==tr[1].sourceDigest)
      throw failure('CONFLICT','Committed wallet storage is missing or inconsistent. Restore its operational backup; do not repeat migration.');
    if(tr[0].state==='ready'){
     for(let i=0;i<2;i++)if(await snapshotDigest(await snapshotDatabase(targets[i]!,pairs[i].schema.version,current))!==tr[i]!.sourceDigest)
      throw failure('CONFLICT','The unactivated destination no longer matches its committed source.');
     current();await advance(targets[0],tr[0],expected(tr[0],{state:'active'}),current);
    }
    current();return directory;
   }
   if(sr.some(r=>r?.state==='retired')||tr.some(r=>r?.state==='active'))throw failure('CONFLICT','Wallet storage activation has an invalid predecessor.');
  }finally{targets.forEach(d=>d?.close());sources.forEach(d=>d?.close());}
  const fenced:IDBDatabase[]=[],destinations:IDBDatabase[]=[];
  try{
   for(const pair of pairs)fenced.push(await fence(pair,identity,network,current));
   for(let i=0;i<2;i++){
    const snapshot=await sourceSnapshot(fenced[i],pairs[i],current),digest=await snapshotDigest(snapshot);current();
    const owner=(await readRecord<OwnerRecord>(fenced[i]))!;current();
    if(owner.sourceDigest!==null&&owner.sourceDigest!==digest)throw failure('CONFLICT','The fenced source snapshot has changed.');
    const pinned=expected(owner,{sourceDigest:digest});
    if(owner.sourceDigest===null)await advance(fenced[i],owner,pinned,current);
    destinations.push(await copy(pairs[i],pinned,snapshot,current));
   }
   const sourceOwner=(await readRecord<OwnerRecord>(fenced[0]))!,sdkOwner=(await readRecord<OwnerRecord>(destinations[0]))!;current();
   await advance(fenced[0],sourceOwner,expected(sourceOwner,{state:'retired'}),current);
   await advance(destinations[0],sdkOwner,expected(sdkOwner,{state:'active'}),current);
   current();return directory;
  }finally{fenced.forEach(d=>d.close());destinations.forEach(d=>d.close());}
 });
}
export {StorageMigrationError};

/** Resolve a support export without migration, creation or fallback to retired
 * records. Legacy export remains available only before a handover has begun. */
export async function resolveWalletExportDatabase(root:string,network:Network,identity:string,current:()=>void):Promise<string>{
 current();const {pairs}=await walletStorageNames(root,network,identity);current();
 if(typeof indexedDB?.databases!=='function')throw failure('UNAVAILABLE','Wallet database inventory is unavailable for export.');
 const inventory=await indexedDB.databases();current();
 if(!Array.isArray(inventory)||inventory.some(r=>!r||typeof r.name!=='string'||!Number.isSafeInteger(r.version)))throw failure('UNAVAILABLE','Wallet database inventory is invalid.');
 const migrated=pairs.some(p=>inventory.some(r=>r.name===p.target||(r.name===p.source&&r.version!>p.schema.version)));
 if(!migrated)return pairs[0].source;
 const opened:IDBDatabase[]=[];
 try{
  for(const p of pairs){
   const source=await existingDatabase(p.source,current),target=await existingDatabase(p.target,current);
   if(source)opened.push(source);if(target)opened.push(target);
   if(!source||!target)throw failure('CONFLICT','Migrated wallet storage is incomplete; stale records will not be exported.');
   const so=await readRecord(source),to=await readRecord(target);current();assertOwner(so,identity,network,p);assertOwner(to,identity,network,p);
   if(so.state!==(p.role==='sdk'?'retired':'fenced')||to.state!==(p.role==='sdk'?'active':'ready')||!so.sourceDigest||so.sourceDigest!==to.sourceDigest)
    throw failure('CONFLICT','The wallet storage handover is not complete; stale records will not be exported.');
  }
  current();return pairs[0].target;
 }finally{opened.forEach(d=>d.close());}
}
