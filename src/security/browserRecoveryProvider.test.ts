import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk,Payment} from '@breeztech/breez-sdk-spark';
import {createOperationGateway} from './operationGateway';
import {readBrowserRecoveryReadiness} from './browserRecoveryReadiness';
import {rememberSignerIdentity,clearSignerIdentity,unlockSpendingSession,lockSpendingSession} from './spendApproval';
import {operationWalletKey,writeOperation} from './operationJournal';
const identity='02'+'11'.repeat(32);
const seed={type:'mnemonic' as const,mnemonic:'disposable-readonly-recovery-test'};
const amount=()=>({identityPubkey:identity,balanceSats:900,recoverableFundsSats:0,tokenBalances:new Map()});
function fixture(){
 const next=vi.fn(async()=>amount());
 const payments=vi.fn(async()=>({payments:[] as Payment[]}));
 const deposits=vi.fn(async()=>({deposits:[]}));
 const observe=vi.fn(async()=>amount());
 const sync=vi.fn(),claim=vi.fn();
 const sdk=createOperationGateway('regtest').protect({
  getInfo:next,listPayments:payments,listUnclaimedDeposits:deposits,
  observeWalletState:observe,syncWallet:sync,claimIncomingTransfer:claim
 } as unknown as BreezSdk);
 return {sdk,next,payments,deposits,observe,sync,claim};
}
beforeEach(async()=>{
 localStorage.clear();
 const held=new Set<string>();
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_opts:unknown,run:(lock:unknown)=>Promise<unknown>)=>{
  if(held.has(name))return run(null);
  held.add(name);try{return await run({name})}finally{held.delete(name)}
 }}});
 await rememberSignerIdentity(seed);
 await unlockSpendingSession(seed);
});
afterEach(()=>{clearSignerIdentity();vi.restoreAllMocks()});
describe('provider-first browser restoration',()=>{
 it('reads provider state before disclosing a restored wallet and never bulk-syncs or claims',async()=>{
  const h=fixture();const observedBalance=2500;
  h.observe.mockImplementationOnce(async()=>{
   h.next.mockResolvedValue({...amount(),balanceSats:observedBalance});
   return {...amount(),balanceSats:observedBalance};
  });
  const result=await readBrowserRecoveryReadiness(h.sdk,'regtest',()=>{});
  expect(result.info.balanceSats).toBe(observedBalance);
  expect(h.observe).toHaveBeenCalledOnce();
  expect(h.payments).toHaveBeenCalledTimes(2);
  expect(h.sync).not.toHaveBeenCalled();
  expect(h.claim).not.toHaveBeenCalled();
 });
 it('fails closed when read-only provider recovery is unavailable',async()=>{
  const h=fixture();h.observe.mockRejectedValueOnce(Error('provider unavailable'));
  await expect(readBrowserRecoveryReadiness(h.sdk,'regtest',()=>{})).rejects.toThrow(/provider unavailable/);
  expect(h.payments).not.toHaveBeenCalled();
  expect(h.claim).not.toHaveBeenCalled();
 });
 it('preserves original operation records and refuses a changed journal during observation',async()=>{
  const key=await operationWalletKey('regtest',identity);
  const record={version:1 as const,walletKey:key,operationId:'11111111-1111-4111-8111-111111111111',
   paymentId:'opaque-fixture',intentHash:'a'.repeat(64),network:'regtest' as const,
   route:'spark' as const,amountSats:'100',feeLimitSats:'0',state:'submitting' as const,
   createdAt:1,updatedAt:1};
  const original=writeOperation(record),h=fixture();
  h.observe.mockImplementationOnce(async()=>{
   writeOperation({...record,operationId:'22222222-2222-4222-8222-222222222222'});
   return amount();
  });
  await expect(readBrowserRecoveryReadiness(h.sdk,'regtest',()=>{})).rejects.toThrow(/records changed/);
  expect(h.claim).not.toHaveBeenCalled();expect(h.sync).not.toHaveBeenCalled();
  expect(original.state).toBe('submitting');
 });
 it('does not publish a late provider result after wallet lock',async()=>{
  const h=fixture();
  h.observe.mockImplementationOnce(async()=>{lockSpendingSession();return amount()});
  await expect(readBrowserRecoveryReadiness(h.sdk,'regtest',()=>{})).rejects.toThrow(/session changed|locked/);
  expect(h.payments).not.toHaveBeenCalled();expect(h.claim).not.toHaveBeenCalled();
 });
});
