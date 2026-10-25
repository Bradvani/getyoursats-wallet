import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {savePlan,savePendingExit,loadPlan,loadPendingExit} from './driver';
import {plan,tx,pendingExit} from './testFixtures';
const wallet={identityPubkey:'02'+'11'.repeat(32),network:'mainnet'};
const planKey='recovery-plan:'+wallet.identityPubkey.slice(0,16)+':mainnet';
beforeEach(()=>localStorage.clear());
afterEach(()=>vi.restoreAllMocks());
describe('non-destructive exit persistence',()=>{
 it('propagates quota failure without dropping the signed snapshot or replacing the previous plan',()=>{
  const previous={...plan([tx({txid:'original'})]),exitStateSnapshot:'original-disposable-snapshot'};
  savePlan(wallet,previous);const old=localStorage.getItem(planKey);
  const write=vi.spyOn(localStorage,'setItem').mockImplementationOnce(()=>{throw new DOMException('quota','QuotaExceededError');});
  expect(()=>savePlan(wallet,{...previous,exitStateSnapshot:'new-snapshot'})).toThrow();
  expect(write).toHaveBeenCalledOnce();expect(localStorage.getItem(planKey)).toBe(old);expect(loadPlan(wallet)).toEqual(previous);
 });
 it('cannot report a first plan persisted after storage rejects it',()=>{
  vi.spyOn(localStorage,'setItem').mockImplementationOnce(()=>{throw new Error('storage unavailable');});
  expect(()=>savePlan(wallet,plan([tx({txid:'new'})]))).toThrow(/storage unavailable/);
  expect(loadPlan(wallet)).toBeNull();
 });
 it('propagates pending-exit persistence failure before funding can be requested',()=>{
  vi.spyOn(localStorage,'setItem').mockImplementationOnce(()=>{throw new Error('storage unavailable');});
  expect(()=>savePendingExit(wallet,pendingExit())).toThrow();expect(loadPendingExit(wallet)).toBeNull();
 });
 it('preserves a previous pending exit on an interrupted replacement',()=>{
  const old=pendingExit();savePendingExit(wallet,old);
  vi.spyOn(localStorage,'setItem').mockImplementationOnce(()=>{throw new Error('storage unavailable');});
  expect(()=>savePendingExit(wallet,{...old,destination:'another'})).toThrow();expect(loadPendingExit(wallet)).toEqual(old);
 });
});
