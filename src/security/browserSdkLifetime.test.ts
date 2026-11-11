import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk} from '@breeztech/breez-sdk-spark';
import {createBrowserSdkLifetime} from './browserSdkLifetime';
import {rememberSignerIdentity,lockSpendingSession,clearSignerIdentity} from './spendApproval';
const seed={type:'mnemonic' as const,mnemonic:'disposable-test-wallet-identity'};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
beforeEach(async()=>{await rememberSignerIdentity(seed)});
afterEach(()=>{clearSignerIdentity()});
describe('browser SDK lifetime',()=>{
 it('revokes cached methods synchronously, waits for shutdown then frees the handle',async()=>{
  const shutdown=deferred();
  const raw={getInfo:vi.fn(async()=>({balanceSats:1n})),disconnect:vi.fn(()=>shutdown.promise),free:vi.fn()};
  const lifetime=createBrowserSdkLifetime(),sdk=await lifetime.attach(raw as unknown as BreezSdk);
  const cached=sdk.getInfo;
  expect(await cached({})).toEqual({balanceSats:1n});
  lockSpendingSession();
  expect(()=>cached({})).toThrow(/closed/);
  expect(()=>sdk.syncWallet({})).toThrow(/closed/);
  expect(raw.disconnect).toHaveBeenCalledOnce();expect(raw.free).not.toHaveBeenCalled();
  shutdown.resolve();await lifetime.stop();
  expect(raw.free).toHaveBeenCalledOnce();
  await lifetime.stop();expect(raw.disconnect).toHaveBeenCalledOnce();
 });
 it('disposes a connection that finishes building after a lock',async()=>{
  const lifetime=createBrowserSdkLifetime();lockSpendingSession();
  const raw={disconnect:vi.fn(async()=>{}),free:vi.fn()};
  await expect(lifetime.attach(raw as unknown as BreezSdk)).rejects.toThrow(/session changed|locked/);
  expect(raw.disconnect).toHaveBeenCalledOnce();expect(raw.free).toHaveBeenCalledOnce();
 });
 it('retains a shutdown failure for unlock and never reopens the old SDK',async()=>{
  const raw={disconnect:vi.fn(async()=>{throw new Error('shutdown failed')}),free:vi.fn()};
  const lifetime=createBrowserSdkLifetime(),sdk=await lifetime.attach(raw as unknown as BreezSdk);
  lockSpendingSession();
  await expect(lifetime.stop()).rejects.toThrow(/shutdown failed/);
  expect(()=>sdk.getInfo({})).toThrow(/closed/);expect(raw.free).toHaveBeenCalledOnce();
 });
 it('does not label an already-started API operation cancelled or execute it again',async()=>{
  const execution=deferred();
  const raw={sendPayment:vi.fn(async()=>{await execution.promise;return {payment:{id:'committed'}}}),disconnect:vi.fn(async()=>{}),free:vi.fn()};
  const lifetime=createBrowserSdkLifetime(),sdk=await lifetime.attach(raw as unknown as BreezSdk);
  const pending=sdk.sendPayment({} as never);lockSpendingSession();await lifetime.stop();
  execution.resolve();await expect(pending).resolves.toEqual({payment:{id:'committed'}});
  expect(raw.sendPayment).toHaveBeenCalledOnce();expect(()=>sdk.sendPayment({} as never)).toThrow(/closed/);
 });
});
