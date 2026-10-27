import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {startTransferHaptics,type TransferDirection} from '../utils/transferHaptics';
import './transferPulse.css';

// Session-memory identifiers only; no invoice, recipient or wallet secret stored.
// A stable SDK payment id prevents multiple receipt surfaces replaying a pulse.
const presented=new Set<string>();
const MAX_PRESENTED=512;
export const TRANSFER_PULSE_DURATION_MS=1250;
function claim(key:string):boolean {
  if(presented.has(key))return false;
  presented.add(key);
  if(presented.size>MAX_PRESENTED)presented.delete(presented.values().next().value!);
  return true;
}
/** Visual receipt only. Call exclusively for a completed SDK payment. */
export default function TransferPulse({direction,paymentId}:{direction:TransferDirection;paymentId:string}) {
  const [mode,setMode]=useState<'off'|'full'|'reduced'>('off');
  const started=useRef<string|null>(null);
  useEffect(()=>{
    const eventKey=`${direction}:${paymentId}`;
    if(!paymentId || started.current===eventKey)return;
    let cancelled=false;
    let stopHaptics=()=>{};
    let endTimer:ReturnType<typeof setTimeout>|undefined;
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish=()=>{
      cancelled=true;
      clearTimeout(startTimer);
      if(endTimer)clearTimeout(endTimer);
      stopHaptics();
      setMode('off');
    };
    // Defer claiming until after mount, so React's StrictMode effect cleanup
    // can cancel the first rehearsal without consuming the real receipt.
    const startTimer=setTimeout(()=>{
      if(cancelled || document.visibilityState==='hidden')return;
      if(!claim(`${direction}:${paymentId}`))return;
      started.current=eventKey;
      const reduced=media.matches;
      setMode(reduced?'reduced':'full');
      stopHaptics=startTransferHaptics(direction,reduced);
      endTimer=setTimeout(finish,reduced?200:TRANSFER_PULSE_DURATION_MS);
    },0);
    const onVisibility=()=>{if(document.visibilityState==='hidden')finish();};
    document.addEventListener('visibilitychange',onVisibility);
    window.addEventListener('pagehide',finish);
    media.addEventListener('change',finish);
    return()=>{
      cancelled=true;clearTimeout(startTimer);if(endTimer)clearTimeout(endTimer);
      stopHaptics();
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('pagehide',finish);
      media.removeEventListener('change',finish);
    };
  },[direction,paymentId]);
  if(mode==='off')return null;
  return createPortal(<div key={`${direction}:${paymentId}`} aria-hidden="true" data-testid="transfer-pulse"
    data-direction={direction} data-reduced-motion={mode==='reduced'}
    className={`gys-pulse gys-pulse--${direction} ${mode==='reduced'?'gys-pulse--reduced':''}`}>
    <div className="gys-pulse__field"/>
    <div className="gys-pulse__aperture"/>
    <div className="gys-pulse__wave"/>
    <div className="gys-pulse__edge-glow"/>
    <div className="gys-pulse__edge"><span/></div>
    <div className="gys-pulse__logo"><img src="/brand/monogram.svg" alt="" draggable="false"/></div>
  </div>,document.body);
}
