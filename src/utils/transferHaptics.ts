import {Capacitor} from '@capacitor/core';
import {Haptics, ImpactStyle} from '@capacitor/haptics';

export type TransferDirection = 'sent'|'received';
const PREFERENCE='gys:payment-haptics:v1';
export function paymentHapticsEnabled():boolean {
  try{return localStorage.getItem(PREFERENCE)!=='off';}catch{return true;}
}
export function setPaymentHapticsEnabled(enabled:boolean):void {
  try{localStorage.setItem(PREFERENCE,enabled?'on':'off');}catch{/* optional preference */}
}
/** Presentation-only. Never awaited by signing, sending or settlement code. */
export function startTransferHaptics(direction:TransferDirection,reducedMotion=false):()=>void {
  let stopped=false;
  const timers:Array<ReturnType<typeof setTimeout>>=[];
  const native=Capacitor.isNativePlatform();
  let usedWebVibration=false;
  const allowed=()=>!stopped && document.visibilityState!=='hidden' && paymentHapticsEnabled();
  const tap=()=>{
    if(!allowed())return;
    try {
      if(native)void Haptics.impact({style:ImpactStyle.Light}).catch(()=>{});
      else if(typeof navigator.vibrate==='function' && navigator.userActivation?.hasBeenActive){
        usedWebVibration=true;
        navigator.vibrate(12);
      }
    }catch{/* Unsupported/disabled haptics must never affect a payment. */}
  };
  // Two restrained accents: ignition and the wave's arrival. No pending loop.
  tap();
  if(!reducedMotion)timers.push(setTimeout(tap,direction==='sent'?650:760));
  const cancel=()=>{
    stopped=true;timers.forEach(clearTimeout);
    document.removeEventListener('visibilitychange',onVisibility);
    window.removeEventListener('pagehide',cancel);
    if(usedWebVibration){try{navigator.vibrate(0);}catch{/* best effort */}}
  };
  const onVisibility=()=>{if(document.visibilityState==='hidden')cancel();};
  document.addEventListener('visibilitychange',onVisibility);
  window.addEventListener('pagehide',cancel);
  return cancel;
}
