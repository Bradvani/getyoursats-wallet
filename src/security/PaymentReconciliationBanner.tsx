import {useEffect,useState} from 'react';
import {useWallet} from '../contexts/WalletContext';
import {getOperationReconciliation} from './operationGateway';
import {isUnresolved,subscribeOperationJournal,type OperationRecord} from './operationJournal';

export default function PaymentReconciliationBanner(){
 const wallet=useWallet();
 const controller=getOperationReconciliation(wallet);
 const [records,setRecords]=useState<ReadonlyArray<OperationRecord>>([]);
 const [error,setError]=useState('');
 const [checking,setChecking]=useState(false);
 useEffect(()=>{
  if(!controller)return;
  let mounted=true,sequence=0;
  const refresh=()=>{
   const current=++sequence;
   void controller.status().then(items=>{
    if(mounted&&current===sequence){setRecords(items);setError('');}
   }).catch(()=>{if(mounted&&current===sequence)setError('Payment status could not be read. Keep this wallet on the device and contact support before paying again.');});
  };
  refresh();
  const unsubscribe=subscribeOperationJournal(refresh);
  return()=>{mounted=false;sequence++;unsubscribe();};
 },[controller]);
 const pending=records.filter(isUnresolved);
 if(!controller||(!pending.length&&!error))return null;
 const check=async()=>{
  if(checking)return;
  setChecking(true);setError('');
  try{setRecords(await controller.reconcile());}
  catch{setError('Status is still unavailable. Do not repeat the payment.');}
  finally{setChecking(false);}
 };
 return <section aria-label="Payment status" className="m-4 rounded-xl border border-spark-warning bg-spark-surface p-4 text-spark-text-primary space-y-3">
  <h2 className="font-semibold">Check your previous payment</h2>
  <p role="status" className="text-sm">{error||'A payment is pending or its outcome is unknown. Sending and wallet removal are paused to prevent an accidental second payment.'}</p>
  <p className="text-xs text-spark-text-secondary">Missing or failed status alone does not confirm that funds were returned. A status check does not send another payment.</p>
  <button type="button" disabled={checking} onClick={()=>void check()} className="min-h-11 rounded-lg border border-spark-border px-4 font-semibold disabled:opacity-50">
   {checking?'Checking status…':'Check payment status'}
  </button>
 </section>;
}
