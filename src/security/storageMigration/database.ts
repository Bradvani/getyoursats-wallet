/** Preservation-oriented IndexedDB primitives. Never delete a database. */
export const OWNER_STORE='__gys_storage_owner_v1';
export type StoreSchema={name:string;keyPath:string|string[]|null;autoIncrement:boolean;indexes:{name:string;keyPath:string|string[];unique:boolean;multiEntry:boolean}[]};
export type DatabaseSchema={version:number;stores:StoreSchema[]};
export type Snapshot={schema:DatabaseSchema;rows:{name:string;entries:{key:IDBValidKey;value:unknown}[]}[]};
export class StorageMigrationError extends Error {
 constructor(readonly code:'OWNERSHIP_REQUIRED'|'CLOSE_OLD_TABS'|'CONFLICT'|'UNAVAILABLE'|'INCOMPATIBLE'|'INTERRUPTED',message:string){super(message);this.name='StorageMigrationError';}
}
export const failure=(code:StorageMigrationError['code'],message:string)=>new StorageMigrationError(code,message+' Your original wallet records have not been deleted.');

/** Rejection/timeout cannot leave a queued upgrade authorized to run later. */
export function openDatabase(name:string,version:number|undefined,upgrade:(db:IDBDatabase,tx:IDBTransaction,oldVersion:number)=>void,assertCurrent:()=>void):Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  let cancelled=false,finished=false;let request:IDBOpenDBRequest;
  const stop=(error:unknown)=>{cancelled=true;if(!finished){finished=true;clearTimeout(timer);reject(error);}};
  const timer=setTimeout(()=>stop(failure('CLOSE_OLD_TABS','Close other wallet tabs before retrying the storage upgrade.')),8000);
  try{assertCurrent();request=version===undefined?indexedDB.open(name):indexedDB.open(name,version);}catch(e){stop(e);return;}
  request.onblocked=()=>stop(failure('CLOSE_OLD_TABS','An older wallet tab is holding the database open. Close it and retry.'));
  request.onupgradeneeded=e=>{
   try{if(cancelled)throw failure('INTERRUPTED','This upgrade attempt has ended.');assertCurrent();upgrade(request.result,request.transaction!,e.oldVersion);}catch(error){try{request.transaction?.abort();}catch{/* An aborted upgrade is already fail-closed. */}stop(error);}
  };
  request.onerror=()=>stop(request.error??failure('UNAVAILABLE','Wallet storage could not be opened.'));
  request.onsuccess=()=>{
   const db=request.result;if(cancelled){db.close();return;}
   try{assertCurrent();db.onversionchange=()=>db.close();finished=true;clearTimeout(timer);resolve(db);}catch(e){db.close();stop(e);}
  };
 });
}
export async function existingDatabase(name:string,assertCurrent:()=>void):Promise<IDBDatabase|null>{
 assertCurrent();if(typeof indexedDB?.databases!=='function')throw failure('UNAVAILABLE','Database inventory is unavailable.');
 const list=await indexedDB.databases();assertCurrent();
 if(!Array.isArray(list)||list.some(r=>!r||typeof r.name!=='string'))throw failure('UNAVAILABLE','Database inventory is invalid.');
 if(!list.some(r=>r.name===name))return null;
 return openDatabase(name,undefined,(_db,tx)=>{tx.abort();throw failure('CONFLICT','A database disappeared while it was being checked.');},assertCurrent);
}
export function durableTransaction(db:IDBDatabase,stores:string[]):IDBTransaction{
 const tx=db.transaction(stores,'readwrite',{durability:'strict'});
 if(tx.durability!=='strict'){tx.abort();throw failure('UNAVAILABLE','Durable storage is not available on this browser.');}return tx;
}
export function transactionDone(tx:IDBTransaction):Promise<void>{
 return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??failure('INTERRUPTED','The storage transaction was interrupted.'));tx.onerror=()=>{};});
}
export function createSchema(db:IDBDatabase,schema:DatabaseSchema):void{
 for(const definition of schema.stores){
  const store=db.createObjectStore(definition.name,{keyPath:definition.keyPath,autoIncrement:definition.autoIncrement});
  for(const i of definition.indexes)store.createIndex(i.name,i.keyPath,{unique:i.unique,multiEntry:i.multiEntry});
 }
}
export function databaseSchema(db:IDBDatabase):DatabaseSchema{
 const names=[...db.objectStoreNames].filter(n=>n!==OWNER_STORE).sort();
 if(names.length===0)return {version:db.version,stores:[]};
 const tx=db.transaction(names,'readonly');
 return {version:db.version,stores:names.map(name=>{const s=tx.objectStore(name);return {name,keyPath:s.keyPath,autoIncrement:s.autoIncrement,indexes:[...s.indexNames].sort().map(n=>{const i=s.index(n);return {name:n,keyPath:i.keyPath,unique:i.unique,multiEntry:i.multiEntry};})};})};
}
export function readRecord<T>(db:IDBDatabase):Promise<T|null>{
 if(!db.objectStoreNames.contains(OWNER_STORE))return Promise.resolve(null);
 const tx=db.transaction(OWNER_STORE,'readonly');const done=transactionDone(tx);
 const request=tx.objectStore(OWNER_STORE).get('owner');let record:T|null=null;
 request.onsuccess=()=>{record=request.result??null;};return done.then(()=>record);
}
export async function snapshotDatabase(db:IDBDatabase,originalVersion:number,assertCurrent:()=>void):Promise<Snapshot>{
 assertCurrent();const schema=databaseSchema(db);schema.version=originalVersion;
 if(schema.stores.length===0)return {schema,rows:[]};
 const tx=db.transaction(schema.stores.map(s=>s.name),'readonly');const done=transactionDone(tx);
 const rows:Snapshot['rows']=schema.stores.map(s=>({name:s.name,entries:[]}));let count=0,error:unknown;
 for(const row of rows){
  const request=tx.objectStore(row.name).openCursor();
  request.onsuccess=()=>{try{assertCurrent();const c=request.result;if(!c)return;if(++count>250000)throw failure('INCOMPATIBLE','This wallet needs a larger migration workspace.');row.entries.push({key:c.key,value:c.value});c.continue();}catch(e){error=e;tx.abort();}};
 }
 try{await done;}catch(e){throw error??e;}assertCurrent();return {schema,rows};
}
/** Canonical typed encoding for checksums only. The copy uses structured clone,
 * not JSON conversion, so BigInt/binary values and IDB keys remain unchanged. */
function typed(value:unknown,depth=0):unknown{
 if(depth>64)throw failure('INCOMPATIBLE','Wallet storage is too deeply nested.');
 if(value===null)return ['null'];if(value===undefined)return ['undefined'];
 if(typeof value==='string'||typeof value==='boolean')return [typeof value,value];
 if(typeof value==='bigint')return ['bigint',value.toString()];
 if(typeof value==='number'){if(!Number.isFinite(value))throw failure('INCOMPATIBLE','Wallet storage has an invalid number.');return ['number',Object.is(value,-0)?'-0':value.toString()];}
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw failure('INCOMPATIBLE','Wallet storage has an invalid date.');return ['date',value.toISOString()];}
 if(value instanceof ArrayBuffer)return ['buffer',Array.from(new Uint8Array(value))];
 if(ArrayBuffer.isView(value))return ['view',value.constructor.name,Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))];
 if(Array.isArray(value))return ['array',value.length,Object.keys(value).map(k=>[k,typed(Reflect.get(value,k),depth+1)])];
 if(typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
  const keys=Object.keys(value).sort();if(keys.some(k=>!Object.getOwnPropertyDescriptor(value,k)?.enumerable||!('value' in Object.getOwnPropertyDescriptor(value,k)!)))throw failure('INCOMPATIBLE','Unsupported wallet storage record.');
  return ['object',keys.map(k=>[k,typed(Reflect.get(value,k),depth+1)])];
 }
 throw failure('INCOMPATIBLE','Unsupported wallet storage value.');
}
export async function snapshotDigest(snapshot:Snapshot):Promise<string>{
 const encoded=new TextEncoder().encode(JSON.stringify(typed(snapshot)));
 if(encoded.byteLength>64*1024*1024)throw failure('INCOMPATIBLE','This wallet needs a larger migration workspace.');
 return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded)));
}
export const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
