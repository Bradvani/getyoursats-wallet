import {readBrowserRecoveryReadiness} from '../../src/security/browserRecoveryReadiness';
import {operationWalletKey,writeOperation,updateOperation,readOperations} from '../../src/security/operationJournal';
import type {ListPaymentsRequest,Payment} from '@breeztech/breez-sdk-spark';

// Actual installed adapter + application reader, synthetic local records only.
// No signer, wallet SDK construction, remote service or credentials are used.
const adapterPath='/node_modules/@breeztech/breez-sdk-spark/web/storage/index.js';
const {IndexedDBStorage}=await import(/* @vite-ignore */ adapterPath);
const identity=`02${'11'.repeat(32)}`;
const row=(i:number):Payment=>({id:`history-fixture-${i}`,paymentType:'receive',method:'spark',status:'completed',amount:BigInt(i+1),fees:0n,timestamp:1000+i});
const snapshot=()=>Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]);
const lab={
 async prepare(count:number){
  if(!Number.isSafeInteger(count)||count<0||count>500)throw Error('Invalid fixture count');
  const name=`gys-history-fixture-${crypto.randomUUID()}`,store=await new IndexedDBStorage(name).initialize();
  try{for(let i=0;i<count;i++)await store.applyPaymentUpdate(row(i));}finally{store.close();}
  const walletKey=await operationWalletKey('regtest',identity);
  const record=writeOperation({version:1,walletKey,operationId:crypto.randomUUID(),paymentId:'pending-public-fixture',intentHash:'a'.repeat(64),network:'regtest',route:'spark',amountSats:'10',feeLimitSats:'1',state:'submitting',createdAt:1,updatedAt:1});
  updateOperation(record,{state:'unknown'});
  return {name,before:snapshot()};
 },
 async read(name:string,fault:'none'|'late-page'|'between-scans'='none'){
  if(!/^gys-history-fixture-[0-9a-f-]{36}$/.test(name))throw Error('Only disposable fixture storage is permitted');
  const store=await new IndexedDBStorage(name).initialize();let calls=0;
  try{
   const sdk={getInfo:async()=>({identityPubkey:identity,balanceSats:5000,recoverableFundsSats:0,tokenBalances:new Map()}),
    listPayments:async(q:ListPaymentsRequest)=>{
     calls++;
     if(fault==='late-page'&&q.offset===100)throw Error('Injected second-page read failure');
     if(fault==='between-scans'&&calls===4)await store.applyPaymentUpdate({...row(210),amount:999n});
     return {payments:await store.listPayments(q)};
    },listUnclaimedDeposits:async()=>({deposits:[]})};
   const result=await readBrowserRecoveryReadiness(sdk,'regtest',()=>{});
   const key=await operationWalletKey('regtest',identity);
   return {count:result.localHistoryVerifiedCount,digest:result.localHistoryDigest,displayCount:result.payments.length,
    more:result.historyMayHaveMore,unresolved:result.unresolved,calls,journals:snapshot(),state:readOperations(key)[0].state};
  }finally{store.close();}
 },
};
Object.assign(window,{__gysRecoveryHistoryLab:lab});
