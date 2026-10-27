import {Capacitor} from '@capacitor/core';
import {Haptics,NotificationType} from '@capacitor/haptics';
export type TransferDirection='sent'|'received';
export type PaymentFeedbackKind='success'|'error'|'test';
export type FeedbackResult='accepted'|'unsupported'|'blocked'|'disabled'|'hidden'|'error';
const PREFERENCE='gys:payment-haptics:v1';
const delivered=new Set<string>();
export function paymentHapticsEnabled():boolean{try{return localStorage.getItem(PREFERENCE)!=='off';}catch{return true;}}
export function setPaymentHapticsEnabled(enabled:boolean):void{try{localStorage.setItem(PREFERENCE,enabled?'on':'off');}catch{/* optional */}}
export function paymentVibrationSupported():boolean{
 return Capacitor.isNativePlatform() || (typeof navigator!=='undefined' && typeof navigator.vibrate==='function');
}
/** Browser acceptance is NOT evidence that a physical motor ran. Never awaited by payment execution. */
export async function playPaymentFeedback(kind:PaymentFeedbackKind):Promise<FeedbackResult>{
 if(!paymentHapticsEnabled())return 'disabled';
 if(document.visibilityState==='hidden')return 'hidden';
 try{
  if(Capacitor.isNativePlatform()){
   await Haptics.notification({type:kind==='error'?NotificationType.Error:NotificationType.Success});
   return 'accepted';
  }
  if(typeof navigator.vibrate!=='function')return 'unsupported';
  // Older supported browsers may not expose userActivation. Let their own
  // activation policy decide rather than incorrectly treating absence as false.
  if(navigator.userActivation && !navigator.userActivation.hasBeenActive)return 'blocked';
  const pattern=kind==='error'?[80,60,100]:kind==='test'?120:70;
  return navigator.vibrate(pattern)?'accepted':'blocked';
 }catch{return 'error';}
}
/** Shared by the SDK event and receipt owners; no repeated buzz for one result. */
export function notifyPaymentFeedback(kind:'success'|'error',paymentId:string):void{
 if(!paymentId)return;
 const key=`${kind}:${paymentId}`;
 if(delivered.has(key))return;
 delivered.add(key);
 if(delivered.size>512)delivered.delete(delivered.values().next().value!);
 void playPaymentFeedback(kind).then(result=>{if(result!=='accepted')delivered.delete(key);});
}
