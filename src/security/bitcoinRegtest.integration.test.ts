import {describe,it,expect,vi} from 'vitest';
import {createSignedRecoveryController,type RecoverySdk} from './signedRecoveryController';
import {createRecoveryTransport} from './recoveryTransport';
import {readRecoveries} from './signedRecoveryJournal';
import {rememberSignerIdentity,clearSignerIdentity,getSpendingRequest,finishSpendingApproval} from './spendApproval';
const enabled=process.env.GYS_DISPOSABLE_BITCOIN_REGTEST==='1';
const seed={type:'mnemonic' as const,mnemonic:'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'};
const base='http://127.0.0.1:3002';
async function testPost(path:string,body?:unknown){const r=await fetch(base+path,{method:'POST',body:body===undefined?'':JSON.stringify(body),headers:{'content-type':'application/json'}});if(!r.ok)throw new Error('Regtest fixture control failed');}
async function approve(){await vi.waitFor(()=>expect(getSpendingRequest()).not.toBeNull());finishSpendingApproval(getSpendingRequest()!.id,true);}
describe.skipIf(!enabled)('actual disposable Bitcoin Core regtest settlement',()=>{
 it('survives lost acknowledgement, exact-byte rebroadcast, confirmation and a stale reorg view',async()=>{
  const f=await (await fetch(base+'/test/fixture')).json() as {txid:string;vout:number;destination:string;amountSats:number;feeSats:number;txId:string;txHex:string};
  expect(f.destination.startsWith('bcrt1')).toBe(true);
  vi.stubEnv('VITE_ESPLORA_BASE_URL',base);vi.stubEnv('VITE_MEMPOOL_BASE_URL',base);
  localStorage.clear();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_opts:unknown,cb:(lock:unknown)=>Promise<unknown>)=>{if(held.has(name))return cb(null);held.add(name);try{return await cb({name});}finally{held.delete(name);}}}});
  await rememberSignerIdentity(seed);
  const signed={txId:f.txId,txHex:f.txHex};
  // Bitcoin Core supplies the actual signed transaction. Spark wallet creation
  // and SDK signing remain outside this test; do not report them as verified.
  const signing=vi.fn(async()=>signed);
  const sdk={parse:async()=>({type:'bitcoinAddress',network:'regtest',address:f.destination}),
   getInfo:async()=>({identityPubkey:'public-disposable-regtest-identity'}),
   fetchClaimDepositQuote:async()=>({amountSats:f.amountSats}),signRefundDeposit:signing,
   verifyRefundTransaction:async()=>signed,inspectRecoveryTransaction:()=>({txId:f.txId,inputOutpoints:[f.txid+':'+f.vout],outputs:[]}),
   listUnclaimedDeposits:async()=>({deposits:[{txid:f.txid,vout:f.vout,amountSats:f.amountSats,refundTx:f.txHex,refundTxId:f.txId}]}),
  } as unknown as RecoverySdk;
  const create=()=>createSignedRecoveryController({network:'regtest',raw:()=>sdk,walletKey:async()=>'a'.repeat(64),assertConnection:()=>{},transport:()=>createRecoveryTransport('regtest')});
  try{
   const first=create().refund({txid:f.txid,vout:f.vout,destinationAddress:f.destination,fee:{type:'fixed',amount:f.feeSats}});
   const uncertain=expect(first).rejects.toThrow(/uncertain/);await approve();await uncertain;
   const record=readRecoveries()[0];expect(record.state).toBe('uncertain');
   const remote=await (await fetch(base+'/test/state')).json() as {mempool:string[];posts:string[]};
   expect(remote.mempool).toContain(f.txId);expect(remote.posts).toEqual([f.txId]);
   clearSignerIdentity();await rememberSignerIdentity(seed);
   const restarted=create();const resumed=restarted.resume(record.operationId);await approve();await resumed;
   expect(signing).toHaveBeenCalledOnce();expect(readRecoveries()[0].state).toBe('submitted');
   expect((await (await fetch(base+'/test/state')).json() as {posts:string[]}).posts).toEqual([f.txId,f.txId]);
   await testPost('/test/mine');await restarted.check(record.operationId);expect(readRecoveries()[0].state).toBe('confirmed');
   await testPost('/test/fault',{fault:'wrong-bytes'});await restarted.check(record.operationId);expect(readRecoveries()[0].state).toBe('uncertain');
   await testPost('/test/fault',{fault:'none'});await restarted.check(record.operationId);expect(readRecoveries()[0].state).toBe('confirmed');
   await testPost('/test/reorg');
   // A stale status from the invalidated block cannot establish confirmation.
   await expect(createRecoveryTransport('regtest').confirmed(f.txId,f.txHex)).rejects.toThrow();
   await testPost('/test/fault',{fault:'none'});await restarted.check(record.operationId);expect(readRecoveries()[0].state).toBe('uncertain');
   await testPost('/test/mine');await restarted.check(record.operationId);expect(readRecoveries()[0].state).toBe('confirmed');
   expect(signing).toHaveBeenCalledOnce();
  }finally{clearSignerIdentity();vi.unstubAllEnvs();}
 },60_000);
});
