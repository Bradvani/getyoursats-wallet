import {useEffect,useRef,useState} from 'react';
import {useSdkEvents} from '../contexts/WalletContext';
import {isConversionPayment} from '../utils/paymentDescription';
import {isMigrationInProgress} from '../services/passkeyService';
import TransferExperience from './TransferExperience';
type Entry={id:string;phase:'confirming'|'failed'};
/** A pending receive and its final receipt share a single motion record keyed to the SDK payment. */
export default function IncomingPaymentNotice({visible=true}:{visible?:boolean}){
 const subscribe=useSdkEvents();const [pending,setPending]=useState<Entry[]>([]);
 const dismissed=useRef(new Set<string>());
 useEffect(()=>subscribe(event=>{
  if(event.type!=='paymentPending'&&event.type!=='paymentSucceeded'&&event.type!=='paymentFailed')return;
  const payment=event.payment;
  if(payment.paymentType!=='receive'||!payment.id||isConversionPayment(payment)||isMigrationInProgress())return;
  if(event.type==='paymentSucceeded'){
   setPending(entries=>entries.filter(entry=>entry.id!==payment.id));dismissed.current.delete(payment.id);return;
  }
  if(event.type==='paymentFailed'){
   setPending(entries=>entries.map(entry=>entry.id===payment.id?{...entry,phase:'failed'}:entry));return;
  }
  if(payment.status!=='pending'||dismissed.current.has(payment.id))return;
  setPending(entries=>entries.some(entry=>entry.id===payment.id)?entries:[...entries,{id:payment.id,phase:'confirming'}].slice(-8) as Entry[]);
 }),[subscribe]);
 const entry=pending[0];
 if(!visible||!entry)return null;
 const dismiss=()=>{dismissed.current.add(entry.id);if(dismissed.current.size>64)dismissed.current.delete(dismissed.current.values().next().value!);setPending(entries=>entries.filter(value=>value.id!==entry.id));};
 return <div data-testid="incoming-payment-notice"><TransferExperience key={entry.id} operationId={entry.id}
  direction="received" phase={entry.phase} onClose={dismiss}/></div>;
}
