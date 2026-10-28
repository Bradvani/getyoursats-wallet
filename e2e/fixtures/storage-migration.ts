import {assertNoUnfencedPopulatedLegacyStorage,EMPTY_LEGACY_FENCE} from '../../src/services/emptyLegacyFence';
import {prepareOwnedWalletStorage,walletStorageNames,resolveWalletExportDatabase,type OwnerRecord} from '../../src/security/storageMigration/ownedStorage';
import {OWNER_STORE,openDatabase,createSchema,transactionDone,snapshotDatabase,snapshotDigest,readRecord,databaseSchema} from '../../src/security/storageMigration/database';
import pinned from '../../src/security/storageMigration/pinnedSchemas.json';
const sdkPath='/node_modules/@breeztech/breez-sdk-spark/web/storage/index.js';
const treePath='/node_modules/@breeztech/breez-sdk-spark/web/tree-store/index.js';
const {IndexedDBStorage}=await import(/* @vite-ignore */ sdkPath);
const {createWebTreeStore}=await import(/* @vite-ignore */ treePath);
const identity='02698b27ac308b275671b3ca25436346469d04a5bba578ae39feba1d65897a6abc';
let active=true;const check=()=>{if(!active)throw Error('Session revoked');};
const held:IDBDatabase[]=[];
const lab={
 async setupLegacyShared(root:string,kind:'empty'|'sdk-populated'|'tree-populated'='empty'){
  active=true;const base=root+'/regtest/2687e55a';
  for(const [i,name] of [base,base+'-tree'].entries()){
   const schema=i===0?pinned.sdk:pinned.tree;
   const db=await openDatabase(name,schema.version,(database,_tx,oldVersion)=>{
    if(oldVersion!==0)throw Error('Legacy fixture already existed');
    createSchema(database,schema);
   },check);
   try{
    if(kind==='sdk-populated'&&i===0){
     const tx=db.transaction('settings','readwrite'),done=transactionDone(tx);
     tx.objectStore('settings').put({key:'legacy-public-fixture',value:'must-remain-quarantined'});await done;
    }
    if(kind==='tree-populated'&&i===1){
     const tx=db.transaction('spent','readwrite'),done=transactionDone(tx);
     tx.objectStore('spent').put({id:'legacy-live-leaf',data:{value:1234n}});await done;
    }
   }finally{db.close();}
  }
 },
 async fenceLegacyShared(root:string){await assertNoUnfencedPopulatedLegacyStorage(root,'regtest',check);},
 async inspectLegacyShared(root:string){
  const base=root+'/regtest/2687e55a',list=await indexedDB.databases(),result=[];
  for(const name of [base,base+'-tree']){
   if(!list.some(d=>d.name===name)){result.push({name,exists:false});continue;}
   const db=await openDatabase(name,undefined,()=>{throw Error('Unexpected create');},()=>{});
   try{
    const names=[...db.objectStoreNames].filter(n=>n!==EMPTY_LEGACY_FENCE);
    const tx=db.transaction([...db.objectStoreNames],'readonly'),done=transactionDone(tx);
    const reqs=names.map(n=>({name:n,request:tx.objectStore(n).count()}));
    const marker=db.objectStoreNames.contains(EMPTY_LEGACY_FENCE)?tx.objectStore(EMPTY_LEGACY_FENCE).get('fence'):null;
    await done;
    result.push({name,exists:true,version:db.version,rows:reqs.map(o=>({name:o.name,count:o.request.result})),fenced:marker?.result??null});
   }finally{db.close();}
  }
  return result;
 },
 async explicitLegacyReopenRejected(root:string){
  const base=root+'/regtest/2687e55a',versions=[23,6],names=[base,base+'-tree'],result=[];
  for(let i=0;i<2;i++)result.push(await new Promise<boolean>(resolve=>{
   const r=indexedDB.open(names[i],versions[i]);
   r.onsuccess=()=>{r.result.close();resolve(false);};
   r.onerror=()=>resolve(r.error?.name==='VersionError');
  }));
  return result;
 },
 async holdLegacyShared(root:string){
  const base=root+'/regtest/2687e55a';
  const db=await openDatabase(base,23,()=>{throw Error('Unexpected create');},()=>{});
  db.onversionchange=()=>{};held.push(db);
 },
 async exportName(root:string){return resolveWalletExportDatabase(root,'regtest',identity,check);},
 async setup(root:string,kind:'owned'|'unowned'|'wrong-owner'|'empty'='owned'){
  active=true;const names=await walletStorageNames(root,'regtest',identity);
  if(kind==='empty')return names;
  for(const p of names.pairs){
   const db=await openDatabase(p.source,p.schema.version,(d)=>{createSchema(d,p.schema);if(kind!=='unowned')d.createObjectStore(OWNER_STORE).add({version:1,identity:kind==='wrong-owner'?'03'+'11'.repeat(32):identity,network:'regtest',role:p.role,state:'owned',source:p.source,target:p.target,sourceVersion:p.schema.version,sourceDigest:null,emptySource:false} satisfies OwnerRecord,'owner');},check);
   const tx=db.transaction([...db.objectStoreNames].filter(n=>n!==OWNER_STORE),'readwrite'),done=transactionDone(tx);
   if(p.role==='sdk'){
    tx.objectStore('settings').put({key:'account_info',value:'{"balance_sats":1234,"token_balances":{}}'});
    tx.objectStore('settings').put({key:'gys:uncertain-fixture',value:'{"state":"unknown","id":"fixture-123"}'});
    tx.objectStore('settings').put({key:'public-binary-fixture',value:new Uint8Array([1,2,3])});
    tx.objectStore('payments').put({id:'fixture-payment',timestamp:1,paymentType:'receive',status:'pending',method:JSON.stringify('spark'),details:null,amount:1234n,fees:1n});
    tx.objectStore('unclaimed_deposits').put({txid:'a'.repeat(64),vout:0,amountSats:1234,refundTx:'fixture-exact-bytes'});
   }else{
    tx.objectStore('leaves').put({id:'fixture-leaf',value:1234n,reservation_id:'pending-attempt',data:{owner_identity_public_key:identity}});
    tx.objectStore('spent').put({id:'fixture-spent',data:{nested:123n}});
   }
   await done;db.close();
  }
  localStorage.setItem('gys:payment-journal:public-fixture','retained-uncertain');
  return names;
 },
 async inspect(root:string){
  const names=await walletStorageNames(root,'regtest',identity),inventory=await indexedDB.databases();const output=[];
  for(const p of names.pairs)for(const name of [p.source,p.target]){
   if(!inventory.some(x=>x.name===name)){output.push({name,exists:false});continue;}
   const db=await openDatabase(name,undefined,()=>{throw Error('Unexpected create');},()=>{});
   try{output.push({name,exists:true,version:db.version,owner:await readRecord(db),digest:await snapshotDigest(await snapshotDatabase(db,p.schema.version,()=>{})),rows:(await snapshotDatabase(db,p.schema.version,()=>{})).rows.map(x=>({name:x.name,count:x.entries.length}))});}finally{db.close();}
  }return output;
 },
 async prepare(root:string){return prepareOwnedWalletStorage({root,network:'regtest',identity,assertCurrent:check});},
 async keepOldOpen(root:string){const names=await walletStorageNames(root,'regtest',identity);for(const p of names.pairs){const db=await openDatabase(p.source,p.schema.version,()=>{throw Error('Unexpected create');},check);db.onversionchange=()=>{};held.push(db);}return held.length;},
 closeOld(){for(const db of held)db.close();held.length=0;},
 async oldOpenRejected(root:string){const {pairs}=await walletStorageNames(root,'regtest',identity);const result=[];for(const p of pairs){try{const db=await openDatabase(p.source,p.schema.version,()=>{throw Error('Unexpected upgrade');},()=>{});db.close();result.push(false);}catch(e){result.push((e as Error).name==='VersionError');}}return result;},
 async adapterRead(root:string){const {pairs}=await walletStorageNames(root,'regtest',identity);const s=await new IndexedDBStorage(pairs[0].target).initialize(),t=await createWebTreeStore(pairs[1].target);try{return {balance:await s.getCachedItem('account_info'),uncertain:await s.getCachedItem('gys:uncertain-fixture'),amount:(await s.getPaymentById('fixture-payment'))?.amount.toString(),deposits:(await s.listDeposits()).length,treeVersion:t.db.version};}finally{s.close();t.close();}},
 async abortNextCopy(root:string){
  const {pairs}=await walletStorageNames(root,'regtest',identity),original=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(...args:Parameters<IDBObjectStore['add']>){
   const result=original.apply(this,args);if(this.transaction.db.name===pairs[0].target&&this.name==='payments'){IDBObjectStore.prototype.add=original;this.transaction.abort();}return result;
  };return ()=>{IDBObjectStore.prototype.add=original;};
 },
 async interruptActivation(root:string){
  const {pairs}=await walletStorageNames(root,'regtest',identity),original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const r=original.apply(this,args);if(this.name===OWNER_STORE&&this.transaction.db.name===pairs[0].source&&args[0]?.state==='retired')r.addEventListener('success',()=>{active=false;IDBObjectStore.prototype.put=original;});return r;};
  return ()=>{IDBObjectStore.prototype.put=original;};
 },
 async injectQuota(root:string){
  const {pairs}=await walletStorageNames(root,'regtest',identity),original=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(...args:Parameters<IDBObjectStore['add']>){if(this.transaction.db.name===pairs[0].target&&this.name==='payments')throw new DOMException('Synthetic quota exhaustion','QuotaExceededError');return original.apply(this,args);};return()=>{IDBObjectStore.prototype.add=original;};
 },
 async noStrictDurability(){
  const original=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){const tx=original.apply(this,args);if(args[1]==='readwrite')Object.defineProperty(tx,'durability',{value:'default'});return tx;};return()=>{IDBDatabase.prototype.transaction=original;};
 },
 async verifyAdapterSchema(root:string){
  const sdk=await new IndexedDBStorage(root+'-schema-sdk').initialize(),tree=await createWebTreeStore(root+'-schema-tree');
  try{return {actual:{sdk:databaseSchema(sdk.db),tree:databaseSchema(tree.db)},expected:{sdk:pinned.sdk,tree:pinned.tree}};}finally{sdk.close();tree.close();}
 },
 async originalAdapterFixture(root:string){
  const {pairs}=await walletStorageNames(root,'regtest',identity);const sdk=await new IndexedDBStorage(pairs[0].source).initialize(),tree=await createWebTreeStore(pairs[1].source);
  try{await sdk.compareAndSwapCachedItem('original-public-fixture',null,'must-not-be-adopted-by-name');}finally{sdk.close();tree.close();}
 },
 async removeSourceFixture(root:string,role:'sdk'|'tree'){
  const {pairs}=await walletStorageNames(root,'regtest',identity);await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase(pairs[role==='sdk'?0:1].source);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('fixture blocked'));});
 },
 async removeTargetFixture(root:string){const {pairs}=await walletStorageNames(root,'regtest',identity);await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase(pairs[0].target);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('fixture blocked'));});},
 async mutateTarget(root:string){const {pairs}=await walletStorageNames(root,'regtest',identity);const s=await new IndexedDBStorage(pairs[0].target).initialize();try{await s.compareAndSwapCachedItem('gys:new-operation',null,'never-overwrite');}finally{s.close();}},
 revoke(){active=false;},resume(){active=true;},
};
Object.assign(window,{gysStorageMigrationLab:lab});
