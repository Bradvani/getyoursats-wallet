import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,renderHook} from '@testing-library/react';
import {useBrowserSessionLock} from './useBrowserSessionLock';
import {WEB_VAULT_KEY,enrollWebWallet,clearUnlockedWebMnemonic,getUnlockedWebMnemonic} from './webWalletVault';
import {rememberSignerIdentity,clearSignerIdentity,requestSpendingApproval,isSpendingSessionLocked,lockSpendingSession,getSpendingSessionEpoch} from './spendApproval';
import {installVaultTestLock} from './vaultTestLock';
const passkeyMock=vi.hoisted(()=>({enabled:false,signIn:vi.fn()}));
vi.mock('../services/passkeyService',()=>({isPasskeyMode:()=>passkeyMock.enabled,getPasskeyLabel:()=>null,signInPinnedToActiveCredential:passkeyMock.signIn}));
const words='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
let visibility='visible';
beforeEach(()=>{
 localStorage.clear();visibility='visible';installVaultTestLock();passkeyMock.enabled=false;passkeyMock.signIn.mockReset();
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
});
afterEach(()=>{
 vi.useRealTimers();clearSignerIdentity();clearUnlockedWebMnemonic();localStorage.clear();
});
describe('browser mnemonic session lock',()=>{
 it.each(['NotAllowedError','AbortError'])('keeps the same session locked after %s without reconnecting',async name=>{
  passkeyMock.enabled=true;await rememberSignerIdentity({type:'mnemonic',mnemonic:words});
  const resume=vi.fn();const {result}=renderHook(()=>useBrowserSessionLock(true,resume));
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
  act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'))});
  passkeyMock.signIn.mockRejectedValueOnce(new DOMException('prompt ended',name));
  await act(async()=>{await expect(result.current.unlock('')).rejects.toThrow('prompt ended')});
  expect(result.current.locked).toBe(true);expect(isSpendingSessionLocked()).toBe(true);
  expect(getUnlockedWebMnemonic()).toBeNull();expect(resume).not.toHaveBeenCalled();
 });

 it('locks passkey wallets on background and unlocks only the same identity',async()=>{
  passkeyMock.enabled=true;await rememberSignerIdentity({type:'mnemonic',mnemonic:words});
  const {result}=renderHook(()=>useBrowserSessionLock(true));
  act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
  expect(result.current.locked).toBe(true);
  act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'))});
  passkeyMock.signIn.mockResolvedValueOnce({wallet:{seed:{type:'mnemonic',mnemonic:'wrong identity'}}});
  await act(async()=>{await expect(result.current.unlock('')).rejects.toThrow(/does not match/)});
  expect(result.current.locked).toBe(true);
  passkeyMock.signIn.mockResolvedValueOnce({wallet:{seed:{type:'mnemonic',mnemonic:words}}});
  await act(async()=>{await result.current.unlock('')});expect(result.current.locked).toBe(false);
 });
 it('keeps the UI locked if authenticated SDK reconnection fails',async()=>{
  passkeyMock.enabled=true;await rememberSignerIdentity({type:'mnemonic',mnemonic:words});
  const resume=vi.fn(async()=>{throw new Error('reconnection failed')});
  const {result}=renderHook(()=>useBrowserSessionLock(true,resume));
  passkeyMock.signIn.mockResolvedValueOnce({wallet:{seed:{type:'mnemonic',mnemonic:words}}});
  await act(async()=>{await expect(result.current.unlock('')).rejects.toThrow(/reconnection failed/)});
  expect(resume).toHaveBeenCalledOnce();expect(result.current.locked).toBe(true);expect(isSpendingSessionLocked()).toBe(true);
 });
 it('rejects a reconnection completed after another background lock',async()=>{
  passkeyMock.enabled=true;await rememberSignerIdentity({type:'mnemonic',mnemonic:words});
  const resume=vi.fn(async()=>{const epoch=getSpendingSessionEpoch();lockSpendingSession();return epoch});
  const {result}=renderHook(()=>useBrowserSessionLock(true,resume));
  passkeyMock.signIn.mockResolvedValueOnce({wallet:{seed:{type:'mnemonic',mnemonic:words}}});
  await act(async()=>{await expect(result.current.unlock('')).rejects.toThrow(/session changed/)});
  expect(result.current.locked).toBe(true);expect(isSpendingSessionLocked()).toBe(true);
 });
 it('does not accept a passkey ceremony interrupted by another lock',async()=>{
  passkeyMock.enabled=true;await rememberSignerIdentity({type:'mnemonic',mnemonic:words});
  const {result}=renderHook(()=>useBrowserSessionLock(true));
  passkeyMock.signIn.mockImplementationOnce(async()=>{lockSpendingSession('another lock');return {wallet:{seed:{type:'mnemonic',mnemonic:words}}}});
  await act(async()=>{await expect(result.current.unlock('')).rejects.toThrow(/session changed/)});
  expect(result.current.locked).toBe(true);
 });
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
