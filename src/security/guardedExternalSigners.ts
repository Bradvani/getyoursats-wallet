/** Application-level signing veto; the default signer remains software-backed. */
import type {ExternalSigners,ExternalBreezSigner,ExternalSparkSigner} from '@breeztech/breez-sdk-spark';
import {assertCurrentSession,getSignerIdentityToken,getSpendingSessionEpoch,isSpendingSessionLocked,subscribeSpendingSessionLock} from './spendApproval';
export function guardExternalSigners(signers:ExternalSigners){
 const identity=getSignerIdentityToken();
 const breez=signers.breezSigner,spark=signers.sparkSigner;
 let revoked=false,disposed=false;
 const inFlight=new Set<Promise<unknown>>();
 let disposal:Promise<void>|null=null;
 const revoke=()=>{revoked=true;};
 const unsubscribe=subscribeSpendingSessionLock(revoke);
 const check=()=>{
  if(revoked||disposed||isSpendingSessionLocked()||!identity||getSignerIdentityToken()!==identity)
   throw new Error('Wallet signing session is locked or replaced');
  const epoch=getSpendingSessionEpoch();assertCurrentSession(epoch);return epoch;
 };
 function guard<T extends object>(target:object):T{
  return new Proxy(Object.create(null) as T,{
   get:(_object,key)=>{
    if(typeof key==='symbol'||key==='then')return undefined;
    if(key==='isRemote')return()=>{check();return Reflect.apply(Reflect.get(target,key),target,[])};
    if(key==='free')return undefined;
    return async(...args:unknown[])=>{
     const epoch=check();
     const method=Reflect.get(target,key);
     if(typeof method!=='function')throw new Error('Signing capability unavailable');
     const operation=Promise.resolve(Reflect.apply(method,target,args));
     inFlight.add(operation);
     try {
      const result=await operation;
      check();assertCurrentSession(epoch);
      return result;
     }finally{inFlight.delete(operation);}
    };
   },
   set:()=>false,defineProperty:()=>false,setPrototypeOf:()=>false,
  });
 }
 return {
  breezSigner:guard<ExternalBreezSigner>(breez),sparkSigner:guard<ExternalSparkSigner>(spark),revoke,
  dispose:()=>{
   if(disposal)return disposal;
   revoke();unsubscribe();disposed=true;
   disposal=(async()=>{
    await Promise.allSettled([...inFlight]);
    breez.free();spark.free();signers.free();
   })();
   return disposal;
  },
 };
}
