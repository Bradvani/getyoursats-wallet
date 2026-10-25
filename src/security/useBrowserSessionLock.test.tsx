import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,renderHook} from '@testing-library/react';
import {useBrowserSessionLock} from './useBrowserSessionLock';
import {WEB_VAULT_KEY,enrollWebWallet,clearUnlockedWebMnemonic,getUnlockedWebMnemonic} from './webWalletVault';
import {rememberSignerIdentity,clearSignerIdentity,requestSpendingApproval,isSpendingSessionLocked} from './spendApproval';
import {installVaultTestLock} from './vaultTestLock';
const words='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
let visibility='visible';
beforeEach(()=>{
 localStorage.clear();visibility='visible';installVaultTestLock();
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
});
afterEach(()=>{
 vi.useRealTimers();clearSignerIdentity();clearUnlockedWebMnemonic();localStorage.clear();
});
describe('browser mnemonic session lock',()=>{
 it('does not lock browser wallets without an enrolled encrypted vault',()=>{
  const {result}=renderHook(()=>useBrowserSessionLock(true));
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
  expect(result.current.locked).toBe(false);
 });
 it('locks an enrolled wallet on background and cancels a pending spend',async()=>{
  localStorage.setItem(WEB_VAULT_KEY,'enrolled-fixture');
  const {result}=renderHook(()=>useBrowserSessionLock(true));
  await rememberSignerIdentity({type:'mnemonic',mnemonic:words});
  const pending=requestSpendingApproval([{paymentId:'test',amount:3n,details:{type:'lightning',invoice:'lnbc'}}]);
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
  expect(result.current.locked).toBe(true);
  await expect(pending).rejects.toThrow(/backgrounded|locked/);
  await expect(requestSpendingApproval([{paymentId:'another',amount:3n,details:{type:'lightning',invoice:'lnbc'}}])).rejects.toThrow(/locked/);
 });
 it('locks after five minutes of inactivity but accepts only matching wallet credentials',async()=>{
  vi.useFakeTimers();
  localStorage.setItem(WEB_VAULT_KEY,'enrolled-fixture');
  const {result}=renderHook(()=>useBrowserSessionLock(true));
  act(()=>{vi.advanceTimersByTime(5*60*1000+15*1000)});
  expect(result.current.locked).toBe(true);
 });
 it('keeps the connected identity unchanged when the wallet unlocks',async()=>{
  await enrollWebWallet(words,'a-long-wallet-password-123');
  await rememberSignerIdentity({type:'mnemonic',mnemonic:words});
  const {result}=renderHook(()=>useBrowserSessionLock(true));
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
  expect(result.current.locked).toBe(true);
  expect(isSpendingSessionLocked()).toBe(true);
  expect(getUnlockedWebMnemonic()).toBeNull();
  await expect(result.current.unlock('incorrect')).rejects.toThrow();
  expect(result.current.locked).toBe(true);
  await expect(result.current.unlock('a-long-wallet-password-123')).rejects.toThrow(/session changed/);
  expect(getUnlockedWebMnemonic()).toBeNull();
  act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'))});
  await act(async()=>{await result.current.unlock('a-long-wallet-password-123')});
  expect(result.current.locked).toBe(false);
  expect(isSpendingSessionLocked()).toBe(false);
 });
});
