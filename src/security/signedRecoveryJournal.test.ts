import {beforeEach,describe,it,expect,vi} from 'vitest';
import {writeRecovery,updateRecovery,readRecoveries,assertNoUnresolvedRecovery,RECOVERY_JOURNAL_PREFIX,type RecoveryRecord} from './signedRecoveryJournal';
const record=():RecoveryRecord=>({version:1,walletKey:'a'.repeat(64),operationId:'11111111-1111-4111-8111-111111111111',network:'mainnet',purpose:'refund',destination:'bc1qdisposable',amountSats:'1000',feeLimitSats:'100',intentHash:'b'.repeat(64),state:'authorized',revision:0,createdAt:1,updatedAt:1,refund:{txid:'c'.repeat(64),vout:0,destinationAddress:'bc1qdisposable',fee:{type:'fixed',amount:100}},transactions:[]});
const tx={txId:'d'.repeat(64),txHex:'0100',state:'signed' as const};
beforeEach(()=>localStorage.clear());
describe('durable signed recovery journal',()=>{
 it('preserves identity and transaction bytes across a new reader',()=>{
  const r=writeRecovery(record());updateRecovery(r,{state:'signed',transactions:[tx]});
  expect(readRecoveries()[0]).toMatchObject({walletKey:r.walletKey,transactions:[tx],revision:1});
  expect(()=>assertNoUnresolvedRecovery()).toThrow(/pending/);
 });
 it('fails closed on a corrupt record without replacing or removing it',()=>{
  const key=RECOVERY_JOURNAL_PREFIX+'damaged';localStorage.setItem(key,'{broken');
  expect(()=>readRecoveries()).toThrow(/damaged/);expect(localStorage.getItem(key)).toBe('{broken');
 });
 it('rejects duplicate operation creation',()=>{
  writeRecovery(record());expect(()=>writeRecovery(record())).toThrow(/already exists/);
 });
 it('rejects stale concurrent writes without overwriting newer signed bytes',()=>{
  const old=writeRecovery(record());const newer=updateRecovery(old,{state:'signed',transactions:[tx]});
  expect(()=>updateRecovery(old,{state:'uncertain'})).toThrow(/changed/);
  expect(readRecoveries()[0]).toEqual(newer);
 });
 it('does not permit a new fee or destination under an existing authorization',()=>{
  const old=writeRecovery(record());
  expect(()=>writeRecovery({...old,feeLimitSats:'101',refund:{...old.refund!,fee:{type:'fixed',amount:101}},revision:1},old)).toThrow(/authorization cannot/);
  expect(readRecoveries()[0].feeLimitSats).toBe('100');
 });
 it('never changes signed bytes on a retry',()=>{
  const old=writeRecovery(record());const signed=updateRecovery(old,{state:'signed',transactions:[tx]});
  expect(()=>updateRecovery(signed,{transactions:[{...tx,txHex:'0200'}]})).toThrow(/cannot be replaced/);
  expect(readRecoveries()[0].transactions[0].txHex).toBe('0100');
 });
 it('storage quota failure preserves the last durable recovery',()=>{
  const old=writeRecovery(record());
  const spy=vi.spyOn(localStorage,'setItem').mockImplementationOnce(()=>{throw new DOMException('quota','QuotaExceededError');});
  try{expect(()=>updateRecovery(old,{state:'signed',transactions:[tx]})).toThrow();}
  finally{spy.mockRestore();}
  expect(readRecoveries()[0]).toEqual(old);
 });
 it('a broadcast acknowledgement does not release the unresolved guard',()=>{
  let r=writeRecovery(record());r=updateRecovery(r,{state:'signed',transactions:[tx]});
  r=updateRecovery(r,{state:'submitted',transactions:[{...tx,state:'submitted'}]});
  expect(()=>assertNoUnresolvedRecovery()).toThrow();
  updateRecovery(r,{state:'confirmed',transactions:[{...tx,state:'confirmed'}]});
  expect(()=>assertNoUnresolvedRecovery()).not.toThrow();
 });
 it('does not persist accidental top-level credentials',()=>{
  writeRecovery({...record(),mnemonic:'never persist this',password:'not a password'} as RecoveryRecord);
  const value=localStorage.getItem(localStorage.key(0)!)!;
  expect(value).not.toContain('never persist');expect(value).not.toContain('password');
 });
});
