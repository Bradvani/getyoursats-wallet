import {FocusTrap} from '@headlessui/react';
import {useState,useId,useRef} from 'react';
import {DialogContainer,DialogCard} from './ui';
import {usePresentation} from '../hooks/usePresentation';
import {STABLE_BALANCE_COPY} from '../locales/stableBalance';
interface Props{isOpen:boolean;onAccept:()=>void;onCancel:()=>void;title?:string;description?:string}
export default function StableBalanceDisclaimer({isOpen,onAccept,onCancel,title,description}:Props){
 const {language}=usePresentation();const copy=STABLE_BALANCE_COPY[language];
 const [acknowledged,setAcknowledged]=useState(false);
 const titleId=useId();const titleRef=useRef<HTMLHeadingElement|null>(null);
 if(!isOpen)return null;
 return <DialogContainer><FocusTrap initialFocus={titleRef} className="w-full max-w-sm" role="dialog" aria-modal="true" aria-labelledby={titleId}
  onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}}}><DialogCard maxWidth="sm"><div className="space-y-4 max-h-[calc(100dvh-160px)] overflow-y-auto overscroll-contain" data-testid="stable-mode-warning">
  <h3 id={titleId} ref={titleRef} tabIndex={-1} style={{outline:'none'}} className="text-lg font-display font-bold text-spark-text-primary">{title??copy.section}</h3>
  <p className="text-sm leading-relaxed text-spark-text-secondary">{description??copy.what}</p>
  <p className="text-sm font-semibold leading-relaxed text-spark-text-primary">{copy.cost}</p>
  <p className="text-sm leading-relaxed text-spark-text-secondary">{copy.automatic}</p>
  <p className="text-xs leading-relaxed text-spark-text-muted">{copy.risk}</p>
  <label className="flex items-start gap-3 min-h-11 text-sm leading-relaxed text-spark-text-primary cursor-pointer">
   <input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#F7931A]"/>
   <span>{copy.ack}</span>
  </label>
  <div className="flex gap-3"><button type="button" onClick={onCancel} className="flex-1 min-h-11 rounded-xl border border-spark-border text-sm text-spark-text-secondary">{copy.cancel}</button>
   <button type="button" disabled={!acknowledged} onClick={()=>{if(acknowledged)onAccept();}} className="button flex-1 min-h-11 text-sm disabled:opacity-40">{copy.review}</button></div>
 </div></DialogCard></FocusTrap></DialogContainer>;
}
