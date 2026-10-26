import {useEffect,useState} from 'react';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {useWallet} from '../contexts/WalletContext';
import {getIncomingClaims} from './incomingClaimController';
import {INCOMING_CLAIM_EVENT,type IncomingClaim} from './incomingClaimJournal';
export default function IncomingPaymentsPanel(){
 const wallet=useWallet(),controller=getIncomingClaims(wallet);
 const [pending,setPending]=useState<readonly Payment[]>([]),[records,setRecords]=useState<readonly IncomingClaim[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!controller)return;
  let active=true;
  const refresh=()=>{void controller.list().then(r=>{if(active)setRecords(r);}).catch(()=>{if(active)setError('Incoming payment records could not be read. Preserve wallet data.');});};
  refresh();window.addEventListener(INCOMING_CLAIM_EVENT,refresh);window.addEventListener('storage',refresh);
  return()=>{active=false;window.removeEventListener(INCOMING_CLAIM_EVENT,refresh);window.removeEventListener('storage',refresh);};
 },[controller]);
 if(!controller)return null;
 const act=async(id?:string)=>{
  if(busy)return;setBusy(true);setError('');
  try{
   if(id)await controller.claim(id);
   setPending(await controller.discover());
   setRecords(await controller.list());
  }catch(e){setError(e instanceof Error?e.message:'Incoming payment check failed');}
  finally{setBusy(false);}
 };
 return <section aria-label="Incoming Spark payments" className="m-4 space-y-2 rounded-xl border border-spark-border p-4 text-spark-text-primary">
  <h2 className="font-semibold">Incoming Spark payments</h2>
  <p className="text-sm">Check for incoming Bitcoin, then approve each receipt. Direct Spark claims have no fee.</p>
  <button type="button" disabled={busy} onClick={()=>void act()} className="min-h-11 rounded-lg border border-spark-border px-3 disabled:opacity-50">{busy?'Checking…':'Check incoming payments'}</button>
  {pending.filter(p=>!records.some(r=>r.paymentId===p.id)).map(p=><div key={p.id} className="space-y-1 rounded-lg border border-spark-border p-3">
   <p>{p.amount.toString()} sats · 0 sats fee</p><p className="break-all text-xs">{p.id}</p>
   <button type="button" disabled={busy} onClick={()=>void act(p.id)} className="min-h-11 rounded-lg border border-spark-border px-3">Review and claim</button>
  </div>)}
  {records.filter(r=>r.state!=='settled').map(r=><p key={r.paymentId} className="break-all text-sm">{r.amountSats} sats · Awaiting settlement evidence. Check status; do not create another claim. Transfer: {r.paymentId}</p>)}
  {error&&<p role="alert" className="text-sm">{error}</p>}
 </section>;
}
