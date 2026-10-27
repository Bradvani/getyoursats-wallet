import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useSdkEvents} from '../contexts/WalletContext';
import {usePresentation} from '../hooks/usePresentation';
import {isConversionPayment} from '../utils/paymentDescription';
import {isMigrationInProgress} from '../services/passkeyService';
import {TRANSFER_FEEDBACK} from '../locales/transferFeedback';
import PaymentMotion from './PaymentMotion';
/** Only actual incoming SDK events create this indicator. Opening a QR is not an incoming payment. */
export default function IncomingPaymentNotice({visible=true}:{visible?:boolean}){
 const subscribe=useSdkEvents();const [pending,setPending]=useState<string[]>([]);
 const dismissed=useRef(new Set<string>());
 const {language}=usePresentation();const copy=TRANSFER_FEEDBACK[language];
 useEffect(()=>subscribe(event=>{
  if(event.type!=='paymentPending'&&event.type!=='paymentSucceeded'&&event.type!=='paymentFailed')return;
  const payment=event.payment;
  if(event.type!=='paymentPending'){
   setPending(ids=>ids.filter(id=>id!==payment.id));dismissed.current.delete(payment.id);return;
  }
  if(payment.paymentType!=='receive'||payment.status!=='pending'||!payment.id||dismissed.current.has(payment.id)
    ||isConversionPayment(payment)||isMigrationInProgress())return;
  setPending(ids=>ids.includes(payment.id)?ids:[...ids,payment.id].slice(-8));
 }),[subscribe]);
 const id=pending[0];
 if(!visible||!id)return null;
 return createPortal(<aside className="gys-incoming-notice" data-testid="incoming-payment-notice">
  <PaymentMotion key={id} state="receiving"/>
  <div role="status" aria-live="polite"><strong className="block text-sm">{copy.incoming}</strong><span className="text-xs text-spark-text-secondary">{copy.waiting}</span></div>
  <button type="button" aria-label={copy.dismiss} onClick={()=>{
   dismissed.current.add(id);if(dismissed.current.size>64)dismissed.current.delete(dismissed.current.values().next().value!);
   setPending(ids=>ids.filter(value=>value!==id));
  }}>×</button>
 </aside>,document.body);
}
