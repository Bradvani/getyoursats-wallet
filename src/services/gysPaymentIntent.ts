import type {Payment} from '@breeztech/breez-sdk-spark';

const ROOT='gys:payment-intent:v1:';
export const CHECK_PREVIOUS_PAYMENT='Check payment history before sending again.';
type Intent={id:string;recipient:string;amount:string;createdAt:number};
type GetPayment=(request:{paymentId:string})=>Promise<{payment:Payment}>;

export function canTrackGysPayments():boolean{
  return typeof navigator!=='undefined'&&typeof navigator.locks?.request==='function';
}

function keyFor(identity:string):string{
  if(!/^(02|03)[a-f0-9]{64}$/i.test(identity))throw new Error(CHECK_PREVIOUS_PAYMENT);
  return ROOT+identity.toLowerCase();
}

async function readPending(key:string,getPayment:GetPayment):Promise<void>{
  const raw=localStorage.getItem(key);
  if(!raw)return;
  let intent:Intent;
  try{intent=JSON.parse(raw);if(typeof intent.id!=='string')throw new Error();}
  catch{throw new Error(CHECK_PREVIOUS_PAYMENT);}
  let payment:Payment|undefined;
  try{payment=(await getPayment({paymentId:intent.id})).payment;}catch{/* Missing is not failed. */}
  if(payment?.id===intent.id&&['completed','failed'].includes(payment.status))localStorage.removeItem(key);
  // Even a completed previous payment gets a fresh review, never an automatic repeat.
  throw new Error(CHECK_PREVIOUS_PAYMENT);
}

async function locked<T>(identity:string,task:(key:string)=>Promise<T>):Promise<T>{
  if(!canTrackGysPayments())throw new Error(CHECK_PREVIOUS_PAYMENT);
  const key=keyFor(identity);
  return navigator.locks.request(key,{mode:'exclusive'},()=>task(key));
}

export async function checkGysPaymentIntent(identity:string,getPayment:GetPayment):Promise<void>{
  // Read on every native-address attempt, including a Lightning fallback after reload.
  const key=keyFor(identity);
  if(!localStorage.getItem(key))return;
  await locked(identity,current=>readPending(current,getPayment));
}

export async function reserveGysPaymentIntent(identity:string,intent:Intent,getPayment:GetPayment):Promise<void>{
  await locked(identity,async key=>{
    await readPending(key,getPayment);
    const raw=JSON.stringify(intent);
    localStorage.setItem(key,raw);
    if(localStorage.getItem(key)!==raw)throw new Error(CHECK_PREVIOUS_PAYMENT);
  });
}

export async function finishGysPaymentIntent(identity:string,id:string,payment?:Payment):Promise<void>{
  if(payment&&(payment.id!==id||!['completed','failed'].includes(payment.status)))return;
  await locked(identity,async key=>{
    const raw=localStorage.getItem(key);
    if(raw&&JSON.parse(raw).id===id)localStorage.removeItem(key);
  });
}
