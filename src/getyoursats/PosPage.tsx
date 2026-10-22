import React,{useState} from 'react';
import QRCode from 'react-qr-code';
import {useWallet} from '../contexts/WalletContext';
export default function PosPage({onClose}:{onClose:()=>void}) {
 const sdk=useWallet(),[amount,setAmount]=useState(''),[note,setNote]=useState('Order'),[invoice,setInvoice]=useState(''),[fee,setFee]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const create=async()=>{
  const n=Number(amount);
  if(!/^\d+$/.test(amount)||!Number.isSafeInteger(n)||n<=0){setError('Enter a positive whole-satoshi amount');return}
  setBusy(true);setError('');
  try{const x=await sdk.receivePayment({paymentMethod:{type:'bolt11Invoice',description:note.slice(0,200),amountSats:n}});setInvoice(x.paymentRequest);setFee(Number(x.fee))}
  catch(e){setError(e instanceof Error?e.message:'Invoice failed')}
  finally{setBusy(false)}
 };
 return <div role="dialog" aria-modal="true" aria-label="Merchant POS" className="gys-pos"><div className="gys-pos-card">
 <header><strong>Accept Bitcoin</strong><button onClick={onClose} aria-label="Close">✕</button></header>
 {!invoice?<section><label>Amount in sats<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="numeric" placeholder="10000"/></label><label>Order reference<input value={note} onChange={e=>setNote(e.target.value)} maxLength={200}/></label><button className="gys-primary" disabled={busy} onClick={()=>void create()}>{busy?'Creating…':'Create invoice'}</button></section>:
 <section className="gys-invoice"><div className="gys-qr"><QRCode value={invoice.toUpperCase()} size={210}/></div><h2>{Number(amount).toLocaleString()} sats</h2><p>Awaiting settlement</p><button onClick={()=>void navigator.clipboard.writeText(invoice)}>Copy Lightning invoice</button><small>Estimated receiver fee: {fee} sats</small><button className="gys-primary" onClick={()=>{setInvoice('');setAmount('')}}>New sale</button></section>}
 {error&&<p role="alert" className="gys-error">{error}</p>}
 </div></div>;
}
