import {useEffect, useState} from 'react';
import QRCode from 'react-qr-code';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {useWallet, useSdkEvents} from '../contexts/WalletContext';
import {useFiatData} from '../contexts/FiatDataContext';
import {formatWithSpaces} from '../utils/formatNumber';
import {amountToSats, getDenomination, saveDenomination, satsToAmount, type Denomination} from './denomination';
import {matchingPosPayment, readPosOrders, reconcilePosOrders, savePosOrders, type PosOrder} from './posLedger';
import DenominationTabs from './DenominationTabs';

/**
 * Merchant POS built on the current connected self-custodial Breez wallet.
 * Local journal is a convenience, NOT an independent immutable merchant ledger.
 * Paid state comes only from confirmed SDK receive events / SDK history,
 * never from editable browser storage.
 */
export default function PosPage({onClose}:{onClose:()=>void}){
  const sdk=useWallet();
  const subscribe=useSdkEvents();
  const {fiatRates,fetchedAt,refreshFiatData}=useFiatData();
  const [unit,setUnit]=useState<Denomination>(getDenomination);
  const [amount,setAmount]=useState('');
  const [note,setNote]=useState('Order');
  const [identity,setIdentity]=useState('');
  const [orders,setOrders]=useState<PosOrder[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [confirmed,setConfirmed]=useState<Map<string,Payment>>(()=>new Map());
  const [fee,setFee]=useState(0);
  const [busy,setBusy]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [error,setError]=useState('');
  const [storageAvailable,setStorageAvailable]=useState(true);
  const active=orders.find(order=>order.id===selectedId);
  const settled=active?confirmed.get(active.id):null;

  // The Spark public identity isolates this device's journal from a different
  // wallet restored in the same browser. It is not used as authentication.
  useEffect(()=>{
    let live=true;
    void (async()=>{
      try {
        const info=await sdk.getInfo({ensureSynced:false});
        if(!live)return;
        const id=info.identityPubkey;
        if(!id){setStorageAvailable(false);return;}
        const saved=readPosOrders(id);
        setIdentity(id);
        setOrders(saved);
        setSelectedId(saved[0]?.id??null);
        setConfirmed(new Map());
      }catch{if(live)setStorageAvailable(false);}
    })();
    return ()=>{live=false};
  },[sdk]);

  // Stream-confirmation: receiving wallet, completed status, exact invoice,
  // and at least the expected sats. Do not trust payer claims or UI buttons.
  useEffect(()=>subscribe(event=>{
    if(event.type!=='paymentSucceeded')return;
    for(const order of orders) {
      if(matchingPosPayment(event.payment,order)) {
        setConfirmed(current=>new Map(current).set(order.id,event.payment));
      }
    }
  }),[orders,subscribe]);

  // SDK history reconciliation catches successful payments whose event occurred
  // while the POS dialog was closed or the browser was reloading.
  useEffect(()=>{
    if(!identity||!orders.length)return;
    let live=true;
    const check=async()=>{
      try {
        const response=await sdk.listPayments({
          typeFilter:['receive'],statusFilter:['completed'],offset:0,limit:100
        });
        if(!live)return;
        const fresh=reconcilePosOrders(orders,response.payments);
        setConfirmed(previous=>{
          const next=new Map(previous);
          for(const [id,payment] of fresh)next.set(id,payment);
          return next;
        });
      }catch{ /* network outages never become a synthetic Paid state */ }
    };
    void check();
    const timer=window.setInterval(()=>void check(),20_000);
    return ()=>{live=false;window.clearInterval(timer)};
  },[sdk,identity,orders]);

  const inrRate=fiatRates.find(r=>r.coin==='INR')?.value;
  const displayRate=fetchedAt ? inrRate:undefined;
  const approxSats=amountToSats(amount,unit,displayRate);
  const onUnit=(next:Denomination)=>{
    if(next==='INR'&&!displayRate)return;
    const current=amountToSats(amount,unit,displayRate);
    setAmount(current ? satsToAmount(current,next,displayRate):'');
    setUnit(next);saveDenomination(next);setError('');
  };

  const create=async()=>{
    if(busy)return;
    setBusy(true);setError('');
    try{
      const latest=unit==='INR'?await refreshFiatData():null;
      const currentRate=latest?.fiatRates.find(r=>r.coin==='INR')?.value;
      if(unit==='INR'&&(!latest?.fetchedAt||Date.now()-latest.fetchedAt>120_000||!currentRate)){
        setError('A live INR/BTC rate is unavailable. Try sats or BTC instead.');
        return;
      }
      const n=amountToSats(amount,unit,currentRate);
      if(!n){setError('Enter a valid amount that converts to at least one satoshi.');return;}
      const result=await sdk.receivePayment({paymentMethod:{
        type:'bolt11Invoice',description:note.slice(0,200),amountSats:n
      }});
      const order:PosOrder={
        id:crypto.randomUUID(),
        invoice:result.paymentRequest,
        amountSats:n,unit,
        description:note.slice(0,200),
        createdAt:Date.now(),
        feeSats:Number(result.fee),
      };
      const updated=[order,...orders].slice(0,50);
      if(!identity || !savePosOrders(identity,updated))setStorageAvailable(false);
      setOrders(updated);setSelectedId(order.id);setFee(order.feeSats);
    }catch(e){
      setError(e instanceof Error?e.message:'Unable to create a Lightning invoice');
    }finally{setBusy(false);}
  };

  const checkNow=async()=>{
    if(syncing)return;
    setSyncing(true);setError('');
    try{
      await sdk.syncWallet({});
      const response=await sdk.listPayments({typeFilter:['receive'],statusFilter:['completed'],offset:0,limit:100});
      const result=reconcilePosOrders(orders,response.payments);
      setConfirmed(previous=>{
        const next=new Map(previous);
        for(const [id,payment] of result)next.set(id,payment);
        return next;
      });
    }catch{
      setError('Cannot check the wallet right now. Keep this invoice pending until the SDK confirms payment.');
    }finally{setSyncing(false);}
  };

  const copyReceipt=async()=>{
    if(!active||!settled)return;
    const receipt=[
      'GetYourSats merchant payment',
      `Order: ${active.id}`,
      `Memo: ${active.description}`,
      `Amount: ${formatWithSpaces(active.amountSats)} sats`,
      'Status: confirmed by wallet SDK',
      `Payment ID: ${settled.id}`,
      `Date: ${new Date(settled.timestamp*1000).toISOString()}`,
    ].join('\n');
    try{await navigator.clipboard.writeText(receipt);}
    catch{setError('Clipboard is unavailable. The confirmed payment remains in wallet history.');}
  };

  return <div role="dialog" aria-modal="true" aria-label="Merchant POS" className="gys-pos">
    <div className="gys-pos-card">
      <header><strong>Accept sats · Merchant POS</strong><button type="button" onClick={onClose} aria-label="Close">✕</button></header>
      {!active ? <section>
        <label>Amount <DenominationTabs value={unit} onChange={onUnit} disabled={busy} inrAvailable={!!displayRate}/>
          <input value={amount} onChange={e=>setAmount(e.target.value)}
            inputMode={unit==='sats'?'numeric':'decimal'}
            placeholder={unit==='sats'?'10 000':unit==='BTC'?'0.0001':'₹ 20.00'}/>
        </label>
        {unit==='INR'&&<small className="gys-pos-note">Indicative conversion from Breez's latest BTC/INR rate. Payment settles in sats.</small>}
        {unit!=='sats'&&approxSats&&<div className="gys-pos-equivalent">≈ {formatWithSpaces(approxSats)} sats</div>}
        <label>Order reference<input value={note} onChange={e=>setNote(e.target.value)} maxLength={200}/></label>
        <button type="button" className="gys-primary" disabled={busy} onClick={()=>void create()}>
          {busy?'Creating invoice…':'Create Lightning invoice'}
        </button>
      </section> : <section className="gys-invoice">
        <div className="gys-qr"><QRCode value={active.invoice.toUpperCase()} size={210}/></div>
        <h2>{formatWithSpaces(active.amountSats)} sats</h2>
        <p className="gys-pos-note">Order: {active.description} · Entered in {active.unit}</p>
        <p aria-live="polite" className={settled?'gys-pos-paid':'gys-pos-pending'}>
          {settled?'Payment confirmed by wallet':'Awaiting verified payment'}
        </p>
        {settled && <small className="gys-pos-note">Payment ID: {settled.id}</small>}
        <button type="button" onClick={()=>void navigator.clipboard.writeText(active.invoice)}>Copy invoice</button>
        <small>Receiver fee estimate: {active.feeSats || fee} sats</small>
        <button type="button" onClick={()=>void checkNow()} disabled={syncing}>
          {syncing?'Checking network…':'Check wallet payment status'}
        </button>
        {settled&&<button type="button" onClick={()=>void copyReceipt()}>Copy payment receipt</button>}
        <button type="button" className="gys-primary" onClick={()=>{setSelectedId(null);setAmount('');}}>New sale</button>
      </section>}
      {!!orders.length&&<section className="gys-pos-orders" aria-label="This device merchant orders">
        <h3>Recent local orders</h3>
        {orders.slice(0,8).map(order=><button type="button" key={order.id}
          className="gys-pos-orders__row" onClick={()=>setSelectedId(order.id)}>
          <span>{order.description}<small>{new Date(order.createdAt).toLocaleString()}</small></span>
          <span>{formatWithSpaces(order.amountSats)} sats
            <small>{confirmed.has(order.id)?'Confirmed':'Not yet verified'}</small>
          </span>
        </button>)}
        <small className="gys-pos-note">
          Stored on this device only; amounts are never marked paid from local storage.
          This is not yet a merchant-grade accounting ledger.
        </small>
      </section>}
      {!storageAvailable&&<p className="gys-pos-note" role="status">
        Local order history is unavailable on this device. Save the invoice before closing.
      </p>}
      {error&&<p role="alert" className="gys-error">{error}</p>}
    </div>
  </div>;
}
