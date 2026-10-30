import {assertCurrentSession,getSpendingSessionEpoch} from './spendApproval';

/** Lock order is always origin -> vault (or origin -> wallet for spending).
 * Fail rather than queue an old enrollment/password-reset behind removal. All
 * participating new clients share this lock; older cached clients still require
 * a separately verified service-worker/version cutover. */
export async function withCoordinatedVaultMutation<T>(operation:()=>Promise<T>):Promise<T>{
 const epoch=getSpendingSessionEpoch();
 if(typeof navigator==='undefined'||!navigator.locks?.request)
  throw new Error('This browser cannot safely update wallet protection. Use an up-to-date browser.');
 return navigator.locks.request('gys:origin-wallet-operations:v1',{mode:'exclusive',ifAvailable:true},async origin=>{
  if(!origin)throw new Error('Another tab is sending, recovering or removing this wallet. Retry wallet protection after it finishes.');
  assertCurrentSession(epoch);
  return navigator.locks.request('getyoursats-vault-mutation-v1',{mode:'exclusive'},async()=>{
   // Covers lock/background/identity changes while waiting for an older vault
   // writer. Never activate stale signing material when a callback resumes.
   assertCurrentSession(epoch);
   return operation();
  });
 });
}
