import {beforeEach,describe,expect,it,vi} from 'vitest';
import {assertNoExitRecordsForRemoval,EXIT_PLAN_STORAGE_PREFIX,EXIT_PENDING_STORAGE_PREFIX} from './removalProtection';

beforeEach(()=>localStorage.clear());
describe('wallet removal preserves unfinished exit recovery',()=>{
 it.each([
  [EXIT_PLAN_STORAGE_PREFIX,JSON.stringify({phase:'active'})],
  [EXIT_PLAN_STORAGE_PREFIX,JSON.stringify({phase:'redo'})],
  [EXIT_PLAN_STORAGE_PREFIX,JSON.stringify({phase:'complete'})],
  [EXIT_PENDING_STORAGE_PREFIX,JSON.stringify({fundingAddress:'fixture'})],
  [EXIT_PLAN_STORAGE_PREFIX,'{damaged'],
  [EXIT_PENDING_STORAGE_PREFIX,'{damaged'],
  [EXIT_PLAN_STORAGE_PREFIX,''],
  [EXIT_PENDING_STORAGE_PREFIX,''],
 ])('blocks %s records without interpreting or deleting their bytes %#',(prefix,value)=>{
  const key=prefix+'another-wallet:regtest';
  localStorage.setItem(key,value);
  expect(()=>assertNoExitRecordsForRemoval()).toThrow(/Bitcoin recovery/);
  expect(localStorage.getItem(key)).toBe(value);
 });
 it('allows archived exits and unrelated preferences alone',()=>{
  localStorage.setItem('unilateral-exit-archive:another-wallet:mainnet','[{"completedAt":1}]');
  localStorage.setItem('preferred-language','ja');
  expect(()=>assertNoExitRecordsForRemoval()).not.toThrow();
 });
 it('fails closed if storage cannot be enumerated',()=>{
  const storage={get length():number{throw new Error('Storage access denied')},key:vi.fn()};
  expect(()=>assertNoExitRecordsForRemoval(storage)).toThrow(/Storage access denied/);
  expect(storage.key).not.toHaveBeenCalled();
 });
 it('fails closed if enumeration changes during the check',()=>{
  expect(()=>assertNoExitRecordsForRemoval({length:1,key:()=>null})).toThrow(/changed/);
 });
});
