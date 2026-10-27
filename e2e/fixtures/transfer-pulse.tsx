// Isolated visual harness. No wallet connection, invoice, signer or real transfer.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Payment} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/appearance.css';
import ResultStep from '../../src/features/send/steps/ResultStep';
import PaymentMotion from '../../src/components/PaymentMotion';
import PaymentFeedbackSetting from '../../src/components/PaymentFeedbackSetting';
import {initPresentation} from '../../src/services/presentationPreferences';
function Fixture(){
 const [state,setState]=useState('pending');const [sequence,setSequence]=useState(0);
 const select=(next:string)=>{setSequence(n=>n+1);setState(next)};
 const payment={id:`pulse-fixture-${sequence}`,paymentType:'send',status:'completed',method:'spark',amount:5000n,fees:0n} as Payment;
 return <main className="min-h-dvh bg-spark-dark text-spark-text-primary p-6">
  <nav className="flex flex-wrap gap-4" aria-label="Fixture controls">
   {['pending','sent','received','unknown','failed'].map(value=><button key={value} onClick={()=>select(value)}>{value}</button>)}
  </nav>
  {state==='pending'?<section role="status"><PaymentMotion state="sending"/><h1>Sending</h1></section>
   :state==='received'?<section className="gys-payment-stage"><PaymentMotion state="received" settlementId={payment.id}/><h1>Received</h1><p>5 000 sats</p><button onClick={()=>select('pending')}>Done</button></section>
   :<ResultStep result={state==='sent'?'success':state==='failed'?'failure':'unknown'} payment={state==='sent'?payment:null} error={state==='failed'?'Network unavailable':null} onClose={()=>select('pending')}/>}
  <PaymentFeedbackSetting/>
 </main>;
}
initPresentation();createRoot(document.getElementById('root')!).render(<Fixture/>);
