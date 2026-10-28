import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {Network,Payment} from '@breeztech/breez-sdk-spark';
import {readBrowserRecoveryReadiness} from './browserRecoveryReadiness';
import {operationWalletKey,writeOperation,updateOperation,readOperations} from './operationJournal';
import {saveIncomingClaim,readIncomingClaims} from './incomingClaimJournal';
import {saveDepositClaim,readDepositClaims} from './depositClaimJournal';
import {writeRecovery,updateRecovery,readRecoveries} from './signedRecoveryJournal';

const identity=`02${'11'.repeat(32)}`,network:Network='regtest';
const uuid='11111111-1111-4111-8111-111111111111';
const info=()=>({identityPubkey:identity,balanceSats:900,recoverableFundsSats:100,tokenBalances:new Map()});
const storage=()=>Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)!).sort().map(k=>[k,localStorage.getItem(k)]);
function sdk(){return {getInfo:vi.fn(async()=>info()),listPayments:vi.fn(async()=>({payments:[] as Payment[]})),listUnclaimedDeposits:vi.fn(async()=>({deposits:[]}))};}
async function pendingRecords(){
 const walletKey=await operationWalletKey(network,identity);
 const first=writeOperation({version:1,walletKey,operationId:uuid,paymentId:'payment-public-fixture',intentHash:'a'.repeat(64),network,route:'spark',amountSats:'100',feeLimitSats:'2',state:'submitting',createdAt:1,updatedAt:1});
 const outgoing=updateOperation(first,{state:'unknown'});
 const incoming=saveIncomingClaim({version:1,walletKey,paymentId:uuid,network,amountSats:'200',expiresAt:61000,state:'submitting',revision:0});
 saveIncomingClaim({...incoming,state:'uncertain',revision:1},incoming);
 const deposit=saveDepositClaim(walletKey,{state:'submitting',intent:{network,txid:'b'.repeat(64),vout:0,amountSats:1000,maxFeeSats:10,minimumCreditSats:990,expiresAt:61000}},null);
 saveDepositClaim(walletKey,{...deposit,state:'uncertain'},deposit);
 const recovery=writeRecovery({version:1,walletKey,operationId:uuid,network,purpose:'refund',destination:'bcrt1q-public-fixture',amountSats:'1000',feeLimitSats:'100',intentHash:'c'.repeat(64),state:'authorized',revision:0,createdAt:1,updatedAt:1,refund:{txid:'d'.repeat(64),vout:0,destinationAddress:'bcrt1q-public-fixture',fee:{type:'fixed',amount:100}},transactions:[]});
 updateRecovery(recovery,{state:'uncertain',transactions:[{txId:'e'.repeat(64),txHex:'0100',state:'uncertain'}]});
 return {walletKey,outgoing};
}
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();});
describe('read-only integrated recovery readiness',()=>{
 it('retains all four uncertain operation families byte-for-byte without resubmission or state promotion',async()=>{
  const {walletKey}=await pendingRecords(),before=storage(),client=sdk();
  const result=await readBrowserRecoveryReadiness(client,network,()=>{});
  expect(result.unresolved).toEqual({payments:1,incoming:1,deposits:1,recoveries:1});
  expect(result.info.balanceSats).toBe(900);expect(result.historyMayHaveMore).toBe(false);
  expect(storage()).toEqual(before);expect(readOperations(walletKey)[0].state).toBe('unknown');
  expect(readIncomingClaims(walletKey)[0].state).toBe('uncertain');expect(readDepositClaims()[0].state).toBe('uncertain');
  expect(readRecoveries(walletKey)[0].transactions[0]).toMatchObject({txHex:'0100',state:'uncertain'});
  expect(client.getInfo).toHaveBeenCalledTimes(2);
  expect(client.listPayments).toHaveBeenCalledWith({offset:0,limit:100});
 });
 it('does not treat a completed SDK payment label as reconciliation authority',async()=>{
  const {walletKey}=await pendingRecords(),before=storage(),client=sdk();
  client.listPayments.mockResolvedValue({payments:[{id:'payment-public-fixture',method:'spark',paymentType:'send',status:'completed',amount:100n,fees:0n,timestamp:1}]});
  await readBrowserRecoveryReadiness(client,network,()=>{});
  expect(readOperations(walletKey)[0].state).toBe('unknown');expect(storage()).toEqual(before);
 });
 it.each(['gys:payment-journal:v2:future','gys:incoming-claim:v2:future','gys:deposit-claim:v2:future','gys:signed-recovery:v2:future'])('preserves and refuses damaged or future-version records: %s',async key=>{
  localStorage.setItem(key,'{original-corrupt');const before=storage(),client=sdk();
  await expect(readBrowserRecoveryReadiness(client,network,()=>{})).rejects.toThrow();
  expect(storage()).toEqual(before);expect(client.listPayments).not.toHaveBeenCalled();
 });
 it('refuses a journal change during awaited history reads without reverting the newer record',async()=>{
  const {outgoing}=await pendingRecords(),client=sdk();
  client.listPayments.mockImplementation(async()=>{updateOperation(outgoing,{state:'pending'});return {payments:[]};});
  await expect(readBrowserRecoveryReadiness(client,network,()=>{})).rejects.toThrow(/records changed/);
  expect(readOperations(outgoing.walletKey)[0].state).toBe('pending');
 });
 it('refuses deletion of a journal during a read without attempting reconstruction',async()=>{
  await pendingRecords();const client=sdk();client.listUnclaimedDeposits.mockImplementation(async()=>{localStorage.removeItem(localStorage.key(0)!);return {deposits:[]};});
  await expect(readBrowserRecoveryReadiness(client,network,()=>{})).rejects.toThrow(/records changed/);
  expect(localStorage.length).toBe(3);
 });
 it('preserves a valid unrelated-wallet journal without attributing it to this wallet',async()=>{
  const other=await operationWalletKey('mainnet',identity);
  writeOperation({version:1,walletKey:other,operationId:uuid,paymentId:'other-public-fixture',intentHash:'a'.repeat(64),network:'mainnet',route:'spark',amountSats:'10',feeLimitSats:'0',state:'submitting',createdAt:1,updatedAt:1});
  const before=storage(),result=await readBrowserRecoveryReadiness(sdk(),network,()=>{});
  expect(result.unresolved.payments).toBe(0);expect(storage()).toEqual(before);
 });
 it('refuses a same-wallet hash carrying a different network record',async()=>{
  const walletKey=await operationWalletKey(network,identity);
  writeOperation({version:1,walletKey,operationId:uuid,paymentId:'mismatch',intentHash:'a'.repeat(64),network:'mainnet',route:'spark',amountSats:'10',feeLimitSats:'0',state:'submitting',createdAt:1,updatedAt:1});
  const before=storage();await expect(readBrowserRecoveryReadiness(sdk(),network,()=>{})).rejects.toThrow(/connected network/);expect(storage()).toEqual(before);
 });
 it.each([-1,NaN,Infinity,1.25,2_100_000_000_000_001])('rejects unreadable or invalid balance %s without publishing zero',async balance=>{
  const client=sdk();client.getInfo.mockResolvedValue({...info(),balanceSats:balance});
  await expect(readBrowserRecoveryReadiness(client,network,()=>{})).rejects.toThrow(/balance/);
 });
 it('does not claim the first page is complete history',async()=>{
  const client=sdk();client.listPayments.mockResolvedValue({payments:Array.from({length:100},(_,i)=>({id:`public-fixture-${i}`,method:'spark',paymentType:'receive',status:'completed',amount:1n,fees:0n,timestamp:i}))});
  expect((await readBrowserRecoveryReadiness(client,network,()=>{})).historyMayHaveMore).toBe(true);
 });
 it('checks session freshness after an asynchronous read and performs no durable changes',async()=>{
  await pendingRecords();const before=storage(),client=sdk();let active=true;
  client.listPayments.mockImplementation(async()=>{active=false;return {payments:[]};});
  await expect(readBrowserRecoveryReadiness(client,network,()=>{if(!active)throw new Error('Session revoked');})).rejects.toThrow('Session revoked');
  expect(storage()).toEqual(before);
 });
 it('does not accept malformed history/deposit container shapes',async()=>{
  const client=sdk();client.listPayments.mockResolvedValue({payments:null} as never);
  await expect(readBrowserRecoveryReadiness(client,network,()=>{})).rejects.toThrow(/history or deposits/);
 });
});
