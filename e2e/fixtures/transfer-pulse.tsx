// Public, unfunded motion studio. Synthetic states only: no SDK, seed, invoice or signer.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Payment} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/appearance.css';
import ResultStep from '../../src/features/send/steps/ResultStep';
import ProcessingStep from '../../src/features/send/steps/ProcessingStep';
import PaymentMotion from '../../src/components/PaymentMotion';
import TransferProgress from '../../src/components/TransferProgress';
import PaymentFeedbackSetting from '../../src/components/PaymentFeedbackSetting';
import {notifyPaymentFeedback} from '../../src/utils/transferHaptics';
import {initPresentation} from '../../src/services/presentationPreferences';
function Fixture(){
 const [state,setState]=useState('idle');const [sequence,setSequence]=useState(0);
 const select=(next:string)=>{
  const id=`studio-${sequence+1}`;setSequence(n=>n+1);setState(next);
  if(next==='sent'||next==='received')notifyPaymentFeedback('success',id);
  if(next==='failed')notifyPaymentFeedback('error',id);
 };
 const payment={id:`studio-${sequence}`,paymentType:'send',status:'completed',method:'spark',amount:5000n,fees:0n} as Payment;
 const controls=[['pending','Sending'],['receiving','Incoming'],['sent','Confirmed send'],['received','Confirmed receive'],['failed','Failed'],['unknown','Unknown']];
 return <main className="min-h-dvh bg-spark-dark text-spark-text-primary px-5 py-7">
  <div className="mx-auto max-w-md">
   <header className="flex items-center justify-between mb-6"><img src="/brand/wordmark-horizontal-dark.svg" alt="GetYourSats" className="h-8 w-auto"/><span className="text-[10px] tracking-widest uppercase text-spark-text-muted">Motion studio / v2</span></header>
   <p className="text-xs text-spark-text-secondary text-center mb-6">Preview only. No wallet connection and no funds moved.</p>
   <div className="min-h-[390px] grid items-center" data-testid="studio-stage">
   {state==='idle'?<section className="gys-payment-stage"><PaymentMotion state="sent" animate={false}/><h1 className="text-2xl font-bold">Money in motion.</h1><p>Choose a payment state below. Sending and incoming remain pending until you select a confirmed result.</p></section>
    :state==='pending'||state==='receiving'?<ProcessingStep operationType={state==='receiving'?'withdraw':'payment'}/>
    :state==='received'?<section className="gys-payment-stage"><PaymentMotion state="received" settlementId={payment.id}/><TransferProgress confirmed/><h1 className="text-2xl font-bold">Payment Received</h1><p>5 000 sats · Preview amount</p><button className="gys-payment-done" onClick={()=>select('idle')}>Done</button></section>
    :<ResultStep result={state==='sent'?'success':state==='failed'?'failure':'unknown'} payment={state==='sent'?payment:null} error={state==='failed'?'Simulated payment failure':null} onClose={()=>select('idle')}/>}
   </div>
   <nav className="grid grid-cols-2 gap-2 mb-7" aria-label="Preview controls">
    {controls.map(([value,label])=><button data-testid={`preview-${value}`} key={value} aria-pressed={state===value} onClick={()=>select(value)} className="min-h-11 rounded-xl border border-spark-border px-3 text-sm">{label}</button>)}
   </nav>
   <PaymentFeedbackSetting/>
  </div>
 </main>;
}
initPresentation();createRoot(document.getElementById('root')!).render(<Fixture/>);
