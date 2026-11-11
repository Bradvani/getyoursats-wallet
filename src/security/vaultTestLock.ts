/** Test-only Web Locks model. Separate names have separate queues. */
export function installVaultTestLock(){
  const queues=new Map<string,Promise<void>>();
  const request=async<T>(name:string,options:{ifAvailable?:boolean},cb:(lock:unknown)=>Promise<T>):Promise<T>=>{
    if(options.ifAvailable&&queues.has(name))return cb(null);
    const previous=queues.get(name)??Promise.resolve();
    let release!:()=>void;
    const current=new Promise<void>(resolve=>{release=resolve});
    queues.set(name,current);
    await previous;
    try{return await cb({name});}
    finally{release();if(queues.get(name)===current)queues.delete(name);}
  };
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request}});
}
