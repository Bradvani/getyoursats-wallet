import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {TransferDirection} from '../utils/transferHaptics';
import './transferPulse.css';
import {TransferContourCanvas} from './Icons';
import {contourPoint} from '../utils/transferContours';

const presented=new Set<string>();
export const TRANSFER_PULSE_DURATION_MS=4600;
function claim(key:string){
 if(presented.has(key))return false;
 presented.add(key);
 if(presented.size>512)presented.delete(presented.values().next().value!);
 return true;
}
/** Decorative only: no progress, status or wallet operation is driven by this clock. */
export default function TransferPulse({direction,paymentId,anchor,pending=false}:{
 direction:TransferDirection;paymentId:string;anchor?:RefObject<SVGSVGElement|null>;pending?:boolean;
}){
 const [mode,setMode]=useState<'off'|'full'|'reduced'>('off');
 const svgRef=useRef<SVGSVGElement>(null);
 const maskRef=useRef<SVGRectElement>(null);
 const paths=useRef<Array<SVGPathElement|null>>([]);
 const maskId=useId().replace(/:/g,'');
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const stop=()=>{clearTimeout(timer);setMode('off');};
  const start=setTimeout(()=>{
   if(document.visibilityState==='hidden'||!paymentId||(!pending&&!claim(`${direction}:${paymentId}`)))return;
   setMode(media.matches?'reduced':'full');
   if(!pending)timer=setTimeout(stop,media.matches?300:TRANSFER_PULSE_DURATION_MS);
  },0);
  const visibility=()=>{if(document.visibilityState==='hidden')stop();else if(pending)setMode(media.matches?'reduced':'full');};
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',stop);
  const preference=()=>{if(pending && document.visibilityState!=='hidden')setMode(media.matches?'reduced':'full');else stop();};
  media.addEventListener('change',preference);
  return()=>{clearTimeout(start);clearTimeout(timer);
   document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',stop);media.removeEventListener('change',preference);
  };
 },[direction,paymentId,pending]);
 useEffect(()=>{
  if(mode!=='full')return;
  let frame=0,last=-Infinity,start:number|undefined;
  const draw=(now:number)=>{
   frame=requestAnimationFrame(draw);
   if(now-last<1000/30)return;last=now;
   start??=now;
   const svg=svgRef.current;if(!svg)return;
   const width=window.innerWidth,height=window.innerHeight;
   svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
   const box=anchor?.current?.getBoundingClientRect();
   const size=box?.width||112;
   const cx=box?box.x+box.width/2:width/2,cy=box?box.y+box.height/2:height/2;
   const cut=maskRef.current;
   if(cut){cut.setAttribute('x',String(cx-size/2));cut.setAttribute('y',String(cy-size/2));cut.setAttribute('width',String(size));cut.setAttribute('height',String(size));cut.setAttribute('rx',String(size*110/512));}
   const elapsed=now-start;
   paths.current.forEach((path,i)=>{
    if(!path)return;
    const raw=(elapsed-i*260)/(pending?4200:3000);
    const phase=pending?((raw%1)+1)%1:Math.max(0,Math.min(1,raw));
    if(raw<0||(!pending&&raw>1)){path.style.opacity='0';return;}
    // Smooth, near-linear travel. No abrupt expansion in the first frames.
    const travel=phase*phase*(3-2*phase);
    const p=direction==='sent'?travel:1-travel;
    const w=size+(width-14-size)*p,h=size+(height-14-size)*p;
    const ox=cx+(width/2-cx)*p,oy=cy+(height/2-cy)*p;
    const ripple=Math.sin(Math.PI*p)*(pending?5:11);
    const points:Array<string>=[];
    for(let n=0;n<=80;n++){
     const t=n/80,angle=t*Math.PI*2;
     const [x,y]=contourPoint(t,w,h,size*.215+(26-size*.215)*p);
     const wave=ripple*(Math.sin(angle*5+elapsed/1100+i*.5)+.35*Math.sin(angle*9-elapsed/1500));
     points.push(`${n?'L':'M'}${(ox+x+Math.cos(angle-Math.PI/2)*wave).toFixed(2)},${(oy+y+Math.sin(angle-Math.PI/2)*wave).toFixed(2)}`);
    }
    path.setAttribute('d',points.join(' ')+'Z');
    path.style.opacity=String(Math.sin(Math.PI*phase)**.55*(pending?.24:.62)*(1-i*.055));
   });
  };
  frame=requestAnimationFrame(draw);
  return()=>cancelAnimationFrame(frame);
 },[mode,anchor,direction,pending]);
 if(mode==='off')return null;
 return createPortal(<div aria-hidden="true" data-testid={pending?'transfer-flow':'transfer-pulse'}
   data-direction={direction} data-reduced-motion={mode==='reduced'}
   className={`gys-pulse gys-pulse--${direction} ${mode==='reduced'?'gys-pulse--reduced':''}`}>
   <TransferContourCanvas svgRef={svgRef} maskRef={maskRef} paths={paths} maskId={maskId}/>
   <span className="gys-pulse__reduced-border"/>
 </div>,document.body);
}
