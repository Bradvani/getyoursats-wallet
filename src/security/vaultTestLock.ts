/** Test-only model of the browser Web Locks mutual-exclusion contract. */
export function installVaultTestLock(){
 let queue=Promise.resolve();
 const lockRequest=async <T>(_name:string,_options:unknown,cb:()=>Promise<T>):Promise<T>=>{
  const predecessor=queue;
  let release!:()=>void;
  queue=new Promise<void>(resolve=>{release=resolve});
  await predecessor;
  try{return await cb()}
  finally{release()}
 };
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:lockRequest}});
}
