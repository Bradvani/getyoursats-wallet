import {Capacitor} from '@capacitor/core';
import {Haptics,NotificationType,ImpactStyle} from '@capacitor/haptics';
export type TransferDirection='sent'|'received';
export type PaymentFeedbackKind='success'|'error'|'test';
export type FeedbackResult='accepted'|'unsupported'|'blocked'|'disabled'|'hidden'|'error';
const PREFERENCE='gys:payment-haptics:v1';
const delivered=new Set<string>();
const isHidden=()=>document.visibilityState==='hidden';
export function paymentHapticsEnabled():boolean{try{return localStorage.getItem(PREFERENCE)!=='off';}catch{return true;}}
export function setPaymentHapticsEnabled(enabled:boolean):void{try{localStorage.setItem(PREFERENCE,enabled?'on':'off');}catch{/* optional */}}
export function paymentVibrationSupported():boolean{
 return Capacitor.isNativePlatform() || (typeof navigator!=='undefined' && typeof navigator.vibrate==='function');
}
/** Browser acceptance is NOT evidence that a physical motor ran. Never awaited by payment execution. */
export async function playPaymentFeedback(kind:PaymentFeedbackKind,direction?:TransferDirection):Promise<FeedbackResult>{
 if(!paymentHapticsEnabled())return 'disabled';
 if(isHidden())return 'hidden';
 try{
  if(Capacitor.isNativePlatform()){
   if(kind==='success'&&direction){
    const styles=direction==='received'?[ImpactStyle.Light,ImpactStyle.Medium,ImpactStyle.Heavy]:[ImpactStyle.Heavy,ImpactStyle.Medium,ImpactStyle.Light];
    for(let i=0;i<styles.length;i++){
     if(i)await new Promise(resolve=>setTimeout(resolve,70));
     if(!paymentHapticsEnabled()||isHidden())return 'hidden';
     await Haptics.impact({style:styles[i]});
    }
   }else if(kind==='error')await Haptics.notification({type:NotificationType.Error});
   else await Haptics.impact({style:ImpactStyle.Light});
   return 'accepted';
  }
  if(typeof navigator.vibrate!=='function')return 'unsupported';
  // Older supported browsers may not expose userActivation. Let their own
  // activation policy decide rather than incorrectly treating absence as false.
  if(navigator.userActivation && !navigator.userActivation.hasBeenActive)return 'blocked';
  const pattern=kind==='error'?[40,50,40]:kind==='success'&&direction?(direction==='received'?[15,45,30,35,55]:[55,35,30,45,15]):20;
  return navigator.vibrate(pattern)?'accepted':'blocked';
 }catch{return 'error';}
}
/** Shared by the SDK event and receipt owners; no repeated buzz for one result. */
export function notifyPaymentFeedback(kind:'success'|'error',paymentId:string,direction?:TransferDirection):void{
 if(!paymentId)return;
 const key=`${kind}:${paymentId}`;
 if(delivered.has(key))return;
 delivered.add(key);
 if(delivered.size>512)delivered.delete(delivered.values().next().value!);
 void playPaymentFeedback(kind,direction).then(result=>{if(result!=='accepted')delivered.delete(key);});
}
