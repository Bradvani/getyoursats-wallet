import {useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {TransferBrandMark,TransferSequenceCanvas} from './Icons';
import {useTransferSequence} from '../hooks/useTransferSequence';
import {usePresentation} from '../hooks/usePresentation';
import {TRANSFER_SEQUENCE_COPY} from '../locales/transferSequence';
import {bitcoinFill,finalFillProgress,isInterrupted,type TransferPhase,type TransferDirection} from '../utils/transferSequence';
import {contourPoint} from '../utils/transferContours';
import './transferSequence.css';

type Props={operationId:string;direction:TransferDirection;phase:TransferPhase;receiptId?:string;amount?:ReactNode;error?:string|null;onClose:()=>void;children?:ReactNode};
function pathAt(progress:number,layer:number,width:number,height:number,cx:number,cy:number,size:number){
 const p=Math.max(0,Math.min(1,progress));
 const w=size+(width+36-size)*p,h=size+(height+36-size)*p;
 const ox=cx+(width/2-cx)*p,oy=cy+(height/2-cy)*p;
 const r=size*110/512*(1-p)+24*p;
 const ripple=Math.sin(Math.PI*p)*10;
 const points:string[]=[];
 for(let n=0;n<=120;n++){
  const t=n/120,a=t*Math.PI*2-Math.PI/2;
  const [x,y]=contourPoint(t,w,h,r);
  const wave=ripple*(Math.sin(a*5+layer*.6)+.35*Math.sin(a*9-layer*.4));
  points.push(`${n?'L':'M'}${(ox+x+Math.cos(a)*wave).toFixed(2)},${(oy+y+Math.sin(a)*wave).toFixed(2)}`);
 }
 return points.join(' ')+'Z';
}
/** One payment screen owns pending, confirmation and interruption. No UI timer changes SDK state. */
export default function TransferExperience({operationId,direction,phase:requestedPhase,receiptId,amount,error,onClose,children}:Props){
 const phase=requestedPhase==='confirmed'&&!receiptId?'unknown':requestedPhase;
 const {language}=usePresentation();const copy=TRANSFER_SEQUENCE_COPY[language];
 const sequence=useTransferSequence(direction,operationId,phase,receiptId);
 const logo=useRef<SVGSVGElement>(null),surface=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null);
 const latestClose=useRef(onClose);useLayoutEffect(()=>{latestClose.current=onClose;},[onClose]);
 const id=useId().replace(/:/g,'');
 const [geometry,setGeometry]=useState({width:390,height:844,cx:195,cy:340,size:144});
 useLayoutEffect(()=>{
  const measure=()=>{const b=logo.current?.getBoundingClientRect();setGeometry({width:window.innerWidth,height:window.innerHeight,cx:b?b.x+b.width/2:window.innerWidth/2,cy:b?b.y+b.height/2:window.innerHeight*.4,size:b?.width||144});};
  measure();window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);
  return()=>{window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);};
 },[]);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  close.current?.focus({preventScroll:true});
  const keyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();latestClose.current();}
   if(event.key!=='Tab')return;
   const buttons=Array.from(surface.current?.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled])')??[]);
   const first=buttons[0],last=buttons[buttons.length-1];
   if(event.shiftKey&&(document.activeElement===first||!surface.current?.contains(document.activeElement))){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!surface.current?.contains(document.activeElement))){event.preventDefault();first?.focus();}
  };
  const node=surface.current;node?.addEventListener('keydown',keyboard);
  return()=>{node?.removeEventListener('keydown',keyboard);if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 const interrupted=isInterrupted(phase),fill=sequence.reduced?0:finalFillProgress(phase,sequence.visual);
 const {width,height,cx,cy,size}=geometry;
 const waves=sequence.reduced?[]:Array.from({length:6},(_,i)=>{
  const progress=i===5?fill:Math.max(0,Math.min(1,(sequence.visual-i*.055)/.70));
  if(i===5&&fill<=0)return '';
  // Each contour traverses its route exactly once, then rests. No modulo clock.
  return pathAt(direction==='sent'?progress:1-progress,i,width,height,cx,cy,size);
 });
 const finalPath=waves[5]??'';
 const canvasOutline=`M-20,-20H${width+20}V${height+20}H-20Z`;
 const fillPath=fill===1?canvasOutline:fill>0?(direction==='sent'?finalPath:canvasOutline+finalPath):'';
 const title=phase==='confirmed'?(direction==='sent'?copy.sent:copy.received):copy[phase];
 const orange=fill===1;
 const bitcoin=bitcoinFill(direction,sequence.visual);
 return createPortal(<section ref={surface} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
  data-testid="transfer-experience" data-phase={phase} data-direction={direction}
  data-visual-progress={sequence.visual.toFixed(4)} data-full-orange={orange} data-stopped={interrupted}
  className={`gys-sequence ${orange?'gys-sequence--orange':''} ${interrupted?'gys-sequence--interrupted':''} ${sequence.reduced?'gys-sequence--reduced':''}`}>
  <TransferSequenceCanvas paths={waves} fillPath={fillPath} fillOpacity={fill>0?1:0} cutout={{x:cx-size/2,y:cy-size/2,size}} glowId={`${id}-radiance`}/>
  <div className="gys-sequence__content" data-testid={phase==='confirmed'?'payment-success':phase==='failed'?'payment-failure':phase==='unknown'?'payment-unknown':'payment-processing'}>
   <div className="gys-sequence__identity"><TransferBrandMark ref={logo} direction={direction} fillFraction={bitcoin}/></div>
   <div className="gys-sequence__evidence" role="progressbar" aria-label={interrupted?copy.lastStep:copy.steps}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={sequence.percent} aria-valuetext={`${sequence.percent}% · ${title}. ${copy.basis}`}>
    <span className="gys-sequence__percent" data-testid="transfer-percentage">{sequence.percent}<span>%</span></span>
    <span className="gys-sequence__caption">{interrupted?copy.lastStep:copy.steps}</span>
    <div className="gys-sequence__steps" aria-hidden="true">{[25,50,75,100].map(n=><i key={n} data-done={sequence.percent>=n}/>)}</div>
   </div>
   <h2 id={`${id}-title`} role={interrupted?'alert':undefined}>{title}</h2>
   <div id={`${id}-description`} className="gys-sequence__description">
    {interrupted?<p>{phase==='unknown'?copy.unknownBody:copy.failedBody}</p>:<p>{copy.basis}</p>}
    {phase==='failed'&&error&&<p className="gys-sequence__error-detail">{error}</p>}
   </div>
   {amount&&<div className="gys-sequence__amount" data-testid="transfer-amount">{amount}</div>}
  </div>
  <footer className="gys-sequence__footer">
   <button ref={close} type="button" className="gys-sequence__close" onClick={onClose}>{phase==='confirmed'?copy.done:copy.returnWallet}</button>
   {children&&<div className="gys-sequence__studio">{children}</div>}
  </footer>
 </section>,document.body);
}
