// No wallet or SDK connection. Controls dispatch explicitly synthetic lifecycle events.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/getyoursats/appearance.css';
import TransferExperience from '../../src/components/TransferExperience';
import {TransferBrandMark} from '../../src/components/Icons';
import PaymentFeedbackSetting from '../../src/components/PaymentFeedbackSetting';
import {notifyPaymentFeedback} from '../../src/utils/transferHaptics';
import type {TransferPhase,TransferDirection} from '../../src/utils/transferSequence';
import {initPresentation} from '../../src/services/presentationPreferences';
function Fixture(){
 const [attempt,setAttempt]=useState<{id:string;direction:TransferDirection;phase:TransferPhase}|null>(null);
 const counter=useRef(0),timers=useRef<Array<ReturnType<typeof setTimeout>>>([]);
 const clear=()=>{timers.current.forEach(clearTimeout);timers.current=[];};
 useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
 const dispatch=(phase:TransferPhase)=>setAttempt(current=>{
  if(!current)return current;
  if(phase==='confirmed')notifyPaymentFeedback('success',current.id);
  if(phase==='failed')notifyPaymentFeedback('error',current.id);
  return {...current,phase};
 });
 const start=(direction:TransferDirection,automated=false)=>{
  clear();const id=`studio-v3-${++counter.current}`;setAttempt({id,direction,phase:'preparing'});
  if(automated){
   // Demo events only. The production UI never uses these timers as payment evidence.
   timers.current=[setTimeout(()=>dispatch('processing'),1200),setTimeout(()=>dispatch('confirming'),2600),setTimeout(()=>dispatch('confirmed'),4200)];
  }
 };
 const choose=(phase:TransferPhase)=>{clear();dispatch(phase);};
 const leave=()=>{clear();setAttempt(null);};
 return <main inert={!!attempt} aria-hidden={attempt?true:undefined} className="min-h-dvh bg-spark-dark text-spark-text-primary px-5 py-7">
  <div className="mx-auto max-w-md">
   <header className="flex items-center justify-between mb-8"><img src="/brand/wordmark-horizontal-dark.svg" alt="GetYourSats" className="h-8 w-auto"/><span className="text-[10px] tracking-widest uppercase text-spark-text-muted">Motion studio / v3</span></header>
   <section className="grid justify-items-center text-center gap-4 py-8">
    {!attempt&&<TransferBrandMark direction="received"/>}
    <h1 className="text-3xl font-semibold">One transfer. One flow.</h1>
    <p className="text-sm text-spark-text-secondary">Preview only. No wallet connection or funds. Percentage shows completed steps, not network time.</p>
    <div className="grid grid-cols-2 gap-3 w-full mt-4">
     <button className="gys-sequence__close" data-testid="preview-send" onClick={()=>start('sent',true)}>Preview send</button>
     <button className="gys-sequence__close" data-testid="preview-receive" onClick={()=>start('received',true)}>Preview receive</button>
     <button className="min-h-11 border border-spark-border rounded-xl" data-testid="manual-send" onClick={()=>start('sent')}>Manual send</button>
     <button className="min-h-11 border border-spark-border rounded-xl" data-testid="manual-receive" onClick={()=>start('received')}>Manual receive</button>
    </div>
   </section>
   <PaymentFeedbackSetting/>
  </div>
  {attempt&&<TransferExperience key={attempt.id} operationId={attempt.id} direction={attempt.direction} phase={attempt.phase}
    receiptId={attempt.phase==='confirmed'?attempt.id:undefined} amount={attempt.phase==='confirmed'?'5 000 sats · Preview':undefined} onClose={leave}>
    <p className="mb-2 opacity-70">Simulated payment events · No funds moved</p>
    <nav aria-label="Preview event controls" className="grid grid-cols-3 gap-2">
     <button data-testid="stage-processing" onClick={()=>choose('processing')} disabled={attempt.phase!=='preparing'}>Request started</button>
     <button data-testid="stage-confirming" onClick={()=>choose('confirming')} disabled={!['preparing','processing'].includes(attempt.phase)}>Awaiting confirmation</button>
     <button data-testid="stage-confirmed" onClick={()=>choose('confirmed')} disabled={attempt.phase==='confirmed'||attempt.phase==='failed'}>Confirm</button>
     <button data-testid="stage-failed" onClick={()=>choose('failed')} disabled={attempt.phase==='confirmed'}>Fail mid-flow</button>
     <button data-testid="stage-unknown" onClick={()=>choose('unknown')} disabled={attempt.phase==='confirmed'}>Mark unknown</button>
     <button onClick={leave}>Close preview</button>
    </nav>
   </TransferExperience>}
 </main>;
}
initPresentation();createRoot(document.getElementById('root')!).render(<Fixture/>);
