import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {withCoordinatedVaultMutation} from './vaultOperationCoordination';
import {withOperationLock} from './operationJournal';
import {clearSignerIdentity,lockSpendingSession} from './spendApproval';
const origin='gys:origin-wallet-operations:v1',vault='getyoursats-vault-mutation-v1';
let held:Set<string>,calls:string[],releaseWaiting:(()=>void)|undefined;
function installLocks(){
 held=new Set();calls=[];releaseWaiting=undefined;
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async<T>(name:string,options:{ifAvailable?:boolean},cb:(lock:unknown)=>Promise<T>):Promise<T>=>{
  calls.push(name);
  if(held.has(name)){
   if(options.ifAvailable)return cb(null);
   await new Promise<void>(resolve=>{releaseWaiting=resolve;});
  }
  held.add(name);try{return await cb({name});}finally{held.delete(name);}
 }}});
}
beforeEach(()=>{localStorage.clear();clearSignerIdentity();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});installLocks();});
afterEach(()=>{clearSignerIdentity();vi.restoreAllMocks();});
describe('origin-coordinated vault writes',()=>{
 it('denies enrollment or recovery while another tab holds the spending/removal lock',async()=>{
  held.add(origin);const write=vi.fn(async()=>{localStorage.setItem('original','changed');});
  localStorage.setItem('original','preserved');
  await expect(withCoordinatedVaultMutation(write)).rejects.toThrow(/Another tab/);
  expect(write).not.toHaveBeenCalled();expect(localStorage.getItem('original')).toBe('preserved');
 });
 it('holds origin protection throughout asynchronous vault work so removal cannot erase it',async()=>{
  let release!:()=>void;const inFlight=withCoordinatedVaultMutation(async()=>{await new Promise<void>(resolve=>{release=resolve;});return 'saved';});
  await vi.waitFor(()=>expect(held.has(vault)).toBe(true));
  const remove=vi.fn(async()=>{});
  await expect(withOperationLock('a'.repeat(64),remove)).rejects.toThrow(/Another tab/);
  expect(remove).not.toHaveBeenCalled();release();await expect(inFlight).resolves.toBe('saved');
  await expect(withOperationLock('a'.repeat(64),remove)).resolves.toBeUndefined();expect(remove).toHaveBeenCalledOnce();
 });
 it('rejects a stale enrollment callback after a session change while waiting for a legacy vault writer',async()=>{
  held.add(vault);const write=vi.fn(async()=>{});
  const pending=withCoordinatedVaultMutation(write);const rejected=expect(pending).rejects.toThrow(/session|locked/i);
  await vi.waitFor(()=>expect(releaseWaiting).toBeTypeOf('function'));
  lockSpendingSession('Changed while waiting');held.delete(vault);releaseWaiting!();await rejected;
  expect(write).not.toHaveBeenCalled();expect(held.has(origin)).toBe(false);
 });
 it('uses the documented origin-before-vault ordering',async()=>{
  await withCoordinatedVaultMutation(async()=>{});expect(calls).toEqual([origin,vault]);
 });
 it('releases all locks on storage failure without changing any prior bytes',async()=>{
  localStorage.setItem('old','preserved');
  await expect(withCoordinatedVaultMutation(async()=>{throw new DOMException('quota','QuotaExceededError');})).rejects.toThrow(/quota/);
  expect(held.size).toBe(0);expect(localStorage.getItem('old')).toBe('preserved');
  await expect(withOperationLock('a'.repeat(64),async()=>{})).resolves.toBeUndefined();
 });
 it('never falls back to an unlocked write on unsupported browsers',async()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});const write=vi.fn(async()=>{});
  await expect(withCoordinatedVaultMutation(write)).rejects.toThrow(/cannot safely update/);expect(write).not.toHaveBeenCalled();
 });
});
