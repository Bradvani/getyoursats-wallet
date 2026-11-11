/**
 * Revoke access immediately, then stop SDK workers and release its WASM handle.
 * This cannot undo a committed transaction or zeroize an outstanding Rust clone.
 */
import type {BreezSdk} from '@breeztech/breez-sdk-spark';
import {assertCurrentSession,getSpendingSessionEpoch,subscribeSpendingSessionLock} from './spendApproval';

export class SdkLifecycleError extends Error {
 readonly cause:unknown;
 readonly additionalErrors:ReadonlyArray<unknown>;
 constructor(message:string,options:{cause:unknown;additionalErrors?:unknown[]}){
  super(message);this.name='SdkLifecycleError';this.cause=options.cause;
  this.additionalErrors=Object.freeze(options.additionalErrors??[]);
 }
}

const lifetimes=new WeakMap<BreezSdk,BrowserSdkLifetime>();
const shutdowns=new Set<Promise<void>>();
/** A failed shutdown blocks creating another signer until a fresh page load. */
export async function waitForBrowserSdkShutdowns():Promise<void>{
 await Promise.all([...shutdowns]);
}
export interface BrowserSdkLifetime {
 attach:(sdk:BreezSdk)=>Promise<BreezSdk>;
 stop:()=>Promise<void>;
 isStopped:()=>boolean;
}

export function createBrowserSdkLifetime(resources?:{revoke:()=>void;dispose:()=>void|Promise<void>}):BrowserSdkLifetime {
 const epoch=getSpendingSessionEpoch();
 let raw:BreezSdk|null=null;
 let stopped=false;
 let attached=false;
 let stopping:Promise<void>|null=null;
 let unsubscribe=()=>{};
 const stop=():Promise<void>=>{
  if(stopping)return stopping;
  stopped=true;
  resources?.revoke();
  unsubscribe();
  // Sever the callable reference before waiting on network/background work.
  const closing=raw;raw=null;
  stopping=(async()=>{
   const errors:unknown[]=[];
   if(closing){
    try{await closing.disconnect();}catch(error){errors.push(error);}
    try{closing.free();}catch(error){errors.push(error);}
   }
   try{await resources?.dispose();}catch(error){errors.push(error);}
   if(errors.length)throw new SdkLifecycleError('Wallet SDK shutdown failed. Reload before reconnecting.',{cause:errors[0],additionalErrors:errors.slice(1)});
  })();
  // Keep failed shutdowns as a fail-closed barrier for every future connection.
  const pending=stopping;
  shutdowns.add(pending);
  void pending.then(()=>{shutdowns.delete(pending)},()=>{});
  return stopping;
 };
 unsubscribe=subscribeSpendingSessionLock(()=>{void stop()});
 const facade=new Proxy(Object.create(null) as BreezSdk,{
  get:(_target,key)=>{
   if(key==='disconnect')return stop;
   if(key==='free')return()=>{void stop()};
   // Event listeners are already removed by disconnect; late React cleanup is safe.
   if(key==='removeEventListener'&&stopped)return async()=>false;
   if(typeof key==='symbol'||key==='then')return undefined;
   return (...args:unknown[])=>{
    const current=raw;
    if(stopped||!current)throw new Error('Wallet signing session is closed. Unlock to reconnect.');
    const method=Reflect.get(current,key);
    if(typeof method!=='function')throw new Error('SDK capability is unavailable');
    return Reflect.apply(method,current,args);
   };
  },
  set:()=>false,defineProperty:()=>false,setPrototypeOf:()=>false,
 });
 return {
  stop,isStopped:()=>stopped,
  attach:async sdk=>{
   if(attached)throw new Error('SDK lifetime already attached');
   attached=true;
   raw=sdk;
   try {
    assertCurrentSession(epoch);
    if(stopped)throw new Error('Wallet locked during connection');
   }catch(error){
    // A build that completes after locking must not escape into application state.
    stopping=null;
    try{await stop();}catch(cleanupError){
     throw new SdkLifecycleError('Wallet locked during connection and cleanup failed',{cause:error,additionalErrors:[cleanupError]});
    }
    throw error;
   }
   return facade;
  },
 };
}

export function registerBrowserSdkLifetime(wallet:BreezSdk,lifetime:BrowserSdkLifetime):void {
 lifetimes.set(wallet,lifetime);
}
export async function stopBrowserSdk(wallet:BreezSdk):Promise<void> {
 const lifetime=lifetimes.get(wallet);
 if(!lifetime)throw new Error('Browser SDK lifecycle is unavailable');
 await lifetime.stop();
}
