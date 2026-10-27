import {useEffect,useRef,useState} from 'react';
import {advanceEvidence,isInterrupted,readSequence,saveSequence,sequenceKey,sequenceTarget,TRANSFER_SEQUENCE_DURATION_MS,type TransferPhase,type TransferDirection,type TransferSequenceRecord} from '../utils/transferSequence';
/** The frame clock eases the view toward an evidenced checkpoint. It cannot alter the verified percentage. */
export function useTransferSequence(direction:TransferDirection,operationId:string,phase:TransferPhase,receiptId?:string){
 const key=sequenceKey(direction,operationId);
 const initial=readSequence(key)??{visual:0,percent:0,phase,finished:false};
 const record=useRef<TransferSequenceRecord>(initial);
 const [view,setView]=useState(initial);
 const [reduced,setReduced]=useState(false);
 useEffect(()=>{
  let frame=0,last:number|undefined;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const publish=()=>{saveSequence(key,record.current);if(receiptId)saveSequence(sequenceKey(direction,receiptId),record.current);setView({...record.current});};
  const update=()=>{
   record.current=advanceEvidence(record.current,phase);setReduced(media.matches);
   const interrupted=isInterrupted(phase);
   if(interrupted){record.current={...record.current,visual:Math.min(record.current.visual,.69)};publish();return;}
   const target=sequenceTarget(phase);
   if(media.matches){record.current={...record.current,visual:target,finished:phase==='confirmed'};publish();return;}
   publish();
   if(document.visibilityState!=='hidden' && record.current.visual<target)frame=requestAnimationFrame(tick);
  };
  const tick=(now:number)=>{
   if(document.visibilityState==='hidden')return;
   if(last===undefined){last=now;frame=requestAnimationFrame(tick);return;}
   // Account for elapsed foreground time, not frame count. A 50 ms clamp
   // made WebKit/software-rendered frames stretch the 5.6s motion indefinitely.
   // Visibility changes reset `last`, so background time is still excluded.
   const delta=Math.max(0,now-last);last=now;
   const target=sequenceTarget(phase);
   const visual=Math.min(target,record.current.visual+delta/TRANSFER_SEQUENCE_DURATION_MS);
   record.current={...record.current,visual,finished:phase==='confirmed'&&visual===1};publish();
   if(visual<target)frame=requestAnimationFrame(tick);
  };
  const visibility=()=>{cancelAnimationFrame(frame);last=undefined;if(document.visibilityState!=='hidden')update();};
  const preference=()=>{cancelAnimationFrame(frame);last=undefined;update();};
  document.addEventListener('visibilitychange',visibility);media.addEventListener('change',preference);
  const start=setTimeout(update,0);
  return()=>{clearTimeout(start);cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',preference);};
 },[direction,key,phase,receiptId]);
 // Stop immediately on a terminal correction, before the effect runs.
 return {...view,phase,percent:isInterrupted(phase)?Math.min(view.percent,75):phase==='confirmed'?100:view.percent,reduced};
}
