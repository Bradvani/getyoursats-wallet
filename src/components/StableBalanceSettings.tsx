import {useState,useRef} from 'react';
import {useStableBalance} from '../contexts/StableBalanceContext';
import {usePresentation} from '../hooks/usePresentation';
import {STABLE_BALANCE_COPY} from '../locales/stableBalance';
import StableBalanceToggleFlow from './StableBalanceToggleFlow';
/** Holding-asset conversions belong in Settings, never in a display-unit toggle. */
export default function StableBalanceSettings(){
 const stable=useStableBalance();const {language}=usePresentation();const copy=STABLE_BALANCE_COPY[language];
 const [direction,setDirection]=useState<'toToken'|'toBitcoin'|null>(null);
 const reviewButton=useRef<HTMLButtonElement|null>(null);
 const closeFlow=()=>{setDirection(null);requestAnimationFrame(()=>reviewButton.current?.focus());};
 const isStable=stable.activeLabel==='USDB';
 return <section aria-label={copy.section} className="rounded-2xl border border-spark-border bg-spark-dark p-4 space-y-3" data-testid="balance-mode-settings">
  <h3 className="font-display font-semibold text-spark-text-primary">{copy.section}</h3>
  <p className="text-sm font-medium text-spark-text-primary">{isStable?copy.stable:copy.bitcoin}</p>
  <p className="text-sm leading-relaxed text-spark-text-secondary">{copy.what}</p>
  <p className="text-sm leading-relaxed text-spark-text-secondary">{copy.cost}</p>
  <button ref={reviewButton} type="button" disabled={stable.isToggling} onClick={()=>setDirection(isStable?'toBitcoin':'toToken')}
   className="w-full min-h-11 rounded-xl border border-spark-border px-4 py-3 text-start text-sm font-semibold text-spark-text-primary disabled:opacity-50" data-testid="review-balance-mode">
    {isStable?copy.toBitcoin:copy.toStable}
  </button>
  <a className="inline-flex min-h-11 items-center text-sm text-spark-primary underline underline-offset-4" href={`/support.html?lang=${language}#stable-mode`} target="_blank" rel="noopener noreferrer">{copy.learn}</a>
  {direction&&<StableBalanceToggleFlow isOpen direction={direction} onCancel={closeFlow} onComplete={closeFlow}/>}
 </section>;
}
