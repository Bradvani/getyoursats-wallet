import {invoiceExpiresAt} from './invoiceExpiry';
import {useInvoiceExpiry} from '../hooks/useInvoiceExpiry';
import {trustCopy} from './trustCopy';
import {usePresentation} from '../hooks/usePresentation';
import {useEffect,useRef,useState} from 'react';
import BrandedQrCode from '../components/BrandedQrCode';
import PaymentMotion from '../components/PaymentMotion';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {useWallet} from '../contexts/WalletContext';
import {useFiatData} from '../contexts/FiatDataContext';
import {useInvoicePaid} from '../hooks/useInvoicePaid';
import {formatWithSpaces} from '../utils/formatNumber';
import {getDisplayFiatCurrency} from '../services/settings';
import {amountToSats,getDenomination,saveDenomination,satsToAmount,type Denomination} from './denomination';
import DenominationTabs from './DenominationTabs';
import PosQrBoundary from '../components/PosQrBoundary';
import {readPosOrders,savePosOrders,reconcilePosOrders,type PosOrder} from './posLedger';
import {validatePosInvoiceResponse} from './posInvoice';

const isFiat=(unit:Denomination)=>unit!=='sats'&&unit!=='BTC';
/** OS number-keyboards have obscured Charge in iOS Safari/standalone mode.
 * The amount is entered exclusively by an accessible in-app keypad. */
export default function PosPage({onClose}:{onClose:()=>void}){
  const sdk=useWallet();
  const {language}=usePresentation();const text=trustCopy(language);
  const {fiatRates,fetchedAt,refreshFiatData}=useFiatData();
  const root=useRef<HTMLDivElement|null>(null);
  const [unit,setUnit]=useState<Denomination>(getDenomination);
  const [amount,setAmount]=useState('');
  const [note,setNote]=useState('');
  const [editingNote,setEditingNote]=useState(false);
  const [invoice,setInvoice]=useState('');
  const expiry=useInvoiceExpiry(invoice);
  const [invoiceSats,setInvoiceSats]=useState(0);
  const [invoiceUnit,setInvoiceUnit]=useState<Denomination>('sats');
  const [fee,setFee]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [paid,setPaid]=useState(false);
  const [freshlyConfirmed,setFreshlyConfirmed]=useState(false);
  const checkedExistingReceiptsRef=useRef(false);
  const [showHistory,setShowHistory]=useState(false);
  const [history,setHistory]=useState<Payment[]>([]);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [walletIdentity,setWalletIdentity]=useState('');
  const [orders,setOrders]=useState<PosOrder[]>([]);
  const [confirmedIds,setConfirmedIds]=useState<Set<string>>(()=>new Set());
  const [journalWarning,setJournalWarning]=useState('');
  // The journal stores PUBLIC invoices only, scoped by the connected wallet's identity.
  // A separate authenticated merchant backend is still required for cross-device records.
  useEffect(()=>{
    let mounted=true;
    void sdk.getInfo({ensureSynced:false}).then(info=>{
      if(!mounted)return;
      const identity=info.identityPubkey;
      if(!identity){setJournalWarning('Wallet identity is unavailable. Charges cannot be tracked yet.');return;}
      const previous=readPosOrders(identity);
      // Preserve the device journal, but never auto-resume a previous invoice.
      // Older orders can be opened explicitly from History if needed.
      setWalletIdentity(identity);setOrders(previous);
    }).catch(()=>{if(mounted)setJournalWarning('Cannot read wallet identity for POS records.');});
    return()=>{mounted=false};
  },[sdk]);
  const fiatCode=isFiat(unit)?unit:getDisplayFiatCurrency();
  const fiatRate=fiatRates.find(r=>r.coin===fiatCode)?.value;
  const validRate=typeof fiatRate==='number'&&Number.isFinite(fiatRate)&&fiatRate>0?fiatRate:undefined;
  const priceSats=amountToSats(amount,unit,validRate);
  const activeOrder=orders.find(order=>order.invoice.toLowerCase()===invoice.toLowerCase());
  const settled=paid || (!!activeOrder && confirmedIds.has(activeOrder.id));
  useEffect(()=>{
    const viewport=window.visualViewport;
    const update=()=>{
      if(!root.current)return;
      root.current.style.setProperty('--gys-pos-view-height',(viewport?.height??window.innerHeight)+'px');
      root.current.style.setProperty('--gys-pos-view-top',(viewport?.offsetTop??0)+'px');
    };
    update();viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);
    return()=>{viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update)};
  },[]);
  useInvoicePaid(invoice,()=>{
    setFreshlyConfirmed(true);
    setPaid(true);
    // A successful SDK event, never an editable local flag, confirms paid.
    void loadHistory();
  });
  const loadAllReceipts=async()=>{
    const payments:Payment[]=[];const seen=new Set<string>();
    for(let page=0;page<100;page++){
      const result=await sdk.listPayments({typeFilter:['receive'],statusFilter:['completed'],offset:page*100,limit:100});
      if(!Array.isArray(result.payments))throw Error('Payment status unavailable');
      for(const payment of result.payments)if(!seen.has(payment.id)){seen.add(payment.id);payments.push(payment);}
      if(result.payments.length<100)return {payments};
    }
    throw Error('History exceeds the beta reconciliation limit. Contact support; records were not deleted.');
  };
  const loadHistory=async()=>{
    setHistoryBusy(true);
    try{
      const result=await loadAllReceipts();

      const matches=reconcilePosOrders(orders,result.payments);
      setHistory([...matches.values()]);
      setConfirmedIds(new Set(matches.keys()));
      if(invoice && orders.some(order=>order.invoice.toLowerCase()===invoice.toLowerCase() && matches.has(order.id))){
        if(checkedExistingReceiptsRef.current && !settled) setFreshlyConfirmed(true);
        setPaid(true);
      }
      checkedExistingReceiptsRef.current=true;
    }catch{setError('Unable to load wallet payments right now.')}
    finally{setHistoryBusy(false)}
  };
  const selectUnit=(next:Denomination)=>{
    if(busy)return;
    const nextRate=isFiat(next)?fiatRates.find(r=>r.coin===next)?.value:undefined;
    if(isFiat(next)&&(!nextRate||!fetchedAt))return;
    const nextAmount=priceSats?satsToAmount(priceSats,next,nextRate):'';
    setUnit(next);
    saveDenomination(next);
    setAmount(nextAmount);
    setError('');
  };
  const input=(key:string)=>{
    if(busy)return;
    setError('');
    setAmount(current=>{
      if(key==='C')return '';
      if(key==='⌫')return current.slice(0,-1);
      if(key==='.')return unit==='sats'||current.includes('.')?current:(current||'0')+'.';
      if(!/^\d$/.test(key))return current;
      const normalized=current==='0'?key:current+key;
      return normalized.length<=17?normalized:current;
    });
  };
  const create=async()=>{
    if(busy||!priceSats)return;
    setBusy(true);setError('');setPaid(false);setFreshlyConfirmed(false);
    try {
      let rate=validRate;let quotedAt=fetchedAt;
      if(isFiat(unit)){
        const latest=await refreshFiatData();
        rate=latest.fiatRates.find(r=>r.coin===unit)?.value;quotedAt=latest.fetchedAt;
        if(!rate||!latest.fetchedAt||Date.now()-latest.fetchedAt>120_000)
          throw new Error('A fresh '+unit+' Bitcoin quote is unavailable. Try sats or BTC.');
      }
      const sats=amountToSats(amount,unit,rate);
      if(!sats)throw new Error('The amount must equal at least one satoshi.');
      if(!walletIdentity)throw new Error('Wallet identity is still loading. Retry the charge.');
      const response=await sdk.receivePayment({paymentMethod:{
        type:'bolt11Invoice',description:(note.trim()||'Payment').slice(0,200),amountSats:sats
      }});
      const validated=validatePosInvoiceResponse(response);
      const parsed=await sdk.parse(validated.invoice);
      const expiresAt=invoiceExpiresAt(parsed);
      if(!expiresAt||expiresAt<=Date.now())throw Error(text.invoiceExpiryUnknown);
      const order:PosOrder={
        id:crypto.randomUUID(),invoice:validated.invoice,amountSats:sats,unit,
        description:(note.trim()||'Payment').slice(0,200),
        createdAt:Date.now(),feeSats:validated.feeSats,originalAmount:amount,
        ...(isFiat(unit)&&rate&&quotedAt?{fiatPerBtc:rate,rateAt:quotedAt}:{}),expiresAt,
      };
      const updated=[order,...orders];
      if(!savePosOrders(walletIdentity,updated)){
        setJournalWarning('This invoice was created, but its local order history could not be saved. Copy the invoice before closing.');
      }
      setOrders(updated);
      setInvoice(validated.invoice);
      setInvoiceSats(sats);
      setInvoiceUnit(unit);
      setFee(validated.feeSats);
    }catch(e){setError(e instanceof Error?e.message:'Could not create the invoice.')}
    finally{setBusy(false)}
  };
  const showList=()=>{
    setShowHistory(true);
    void loadHistory();
  };
  const copy=async()=>{
    if(!expiry.usable)return;
    try{await navigator.clipboard.writeText(invoice)}catch{setError('Could not copy invoice')}
  };
  const reset=()=>{
    setInvoice('');setInvoiceSats(0);setInvoiceUnit('sats');setFee(0);
    setAmount('');setNote('');setEditingNote(false);
    setPaid(false);setFreshlyConfirmed(false);setShowHistory(false);setError('');
  };
  useEffect(()=>{
    if(!walletIdentity || !orders.length)return;
    let active=true;
    const reconcile=async()=>{
      try{
        const result=await sdk.listPayments({typeFilter:['receive'],statusFilter:['completed'],offset:0,limit:100});
        if(!active)return;
        const matches=reconcilePosOrders(orders,result.payments);
        setConfirmedIds(new Set(matches.keys()));
        // A passive SDK event can be missed when a PWA is backgrounded.
        // Initial reconciliation is silent; only later newly completed
        // receipts for the actively displayed charge get a fresh flash.
        const matchingCurrent = orders.find(order =>
          order.invoice.toLowerCase()===invoice.toLowerCase() && matches.has(order.id));
        if(matchingCurrent && !paid) {
          if(checkedExistingReceiptsRef.current) setFreshlyConfirmed(true);
          setPaid(true);
        }
        checkedExistingReceiptsRef.current=true;
      }catch{/* Never synthesize settlement when the SDK is unavailable. */}
    };
    void reconcile();
    const timer=window.setInterval(()=>void reconcile(),20_000);
    return()=>{active=false;window.clearInterval(timer)};
  },[sdk,walletIdentity,orders,invoice,paid]);
  return <div ref={root} role="dialog" aria-modal="true" aria-label="Merchant point of sale" className="gys-pos gys-pos--terminal">
    <div className="gys-pos-terminal">
      <header className="gys-pos-terminal__header">
        <strong>Point of Sale</strong>
        <div>
          <button type="button" onClick={showList} aria-label="Payment history">History</button>
          <button type="button" onClick={onClose} aria-label="Close point of sale">✕</button>
        </div>
      </header>
      <p className="gys-pos-terminal__muted" role="note">{text.betaMerchant}</p>
      {showHistory?<section className="gys-pos-terminal__history">
        <div className="gys-pos-terminal__row"><h2>Merchant sales</h2>
          <button type="button" onClick={()=>setShowHistory(false)}>Back</button></div>
        <p className="gys-pos-terminal__muted">Only completed payments matching invoices in this device’s merchant records are listed.</p>
        {historyBusy?<p role="status">Syncing wallet history…</p>:
          history.length===0?<p>No completed incoming payments found.</p>:
          <ol>{history.map(payment=><li key={payment.id}>
            <span>{new Date(payment.timestamp*1000).toLocaleString()}</span>
            <strong>{formatWithSpaces(payment.amount)} 丰</strong>
          </li>)}</ol>}
      </section>:invoice?<section className="gys-pos-terminal__invoice" aria-live="polite">
        <h2 className="gys-pos-terminal__invoice-title">{settled?'Charge complete':expiry.checking?text.checking:expiry.usable?'Scan to pay':text.invoiceExpired}</h2>
        {settled ? <div className="gys-pos-terminal__success" data-testid="pos-received-motion" role="status">
          <PaymentMotion state="received" animate={freshlyConfirmed} />
          <span className="gys-pos-terminal__success-title">Payment received</span>
        </div> : !expiry.usable?<p role="status">{expiry.checking?text.checking:expiry.expiresAt?text.invoiceExpired:text.invoiceExpiryUnknown}</p>:<div className="gys-pos-terminal__qr" data-testid="pos-invoice-qr"
          aria-label="Scan this Lightning invoice to pay">
          <PosQrBoundary key={invoice}>
            <BrandedQrCode value={invoice.toUpperCase()} size={288} label="Lightning invoice QR code" />
          </PosQrBoundary>
        </div>}
        <h2>{formatWithSpaces(invoiceSats)} <span>丰 sats</span></h2>
        <p>{text.requestedAmount}: {orders.find(order=>order.invoice===invoice)?.originalAmount??'Not recorded'} {invoiceUnit}</p>
        <p>Receives Lightning sats</p>
        {expiry.expiresAt&&<p>{text.expires}: {new Date(expiry.expiresAt).toLocaleString(language)}</p>}
        <strong className={settled?'gys-pos-paid':'gys-pos-pending'}>
          {settled?'Payment confirmed by the wallet':expiry.usable?'Waiting for payment confirmation':text.invoiceExpired}
        </strong>
        {!settled && expiry.usable && <>
          <small>Estimated receiver fee: {fee} sats</small>
          <button type="button" className="gys-pos-terminal__secondary" onClick={()=>void copy()}>Copy invoice</button>
        </>}
        <button type="button" className="gys-pos-terminal__charge" onClick={reset}>New charge</button>
      </section>:<>
        <section className="gys-pos-terminal__amount">
          <p className="gys-pos-terminal__muted">Amount to charge</p>
          <output aria-label="Charge amount" aria-live="polite">
            {amount||'0'} <small>{unit==='sats'?'丰 sats':unit==='BTC'?'₿ BTC':unit}</small>
          </output>
          <DenominationTabs value={unit} onChange={selectUnit} disabled={busy}
            inrAvailable={!!fetchedAt&&!!fiatRates.find(r=>r.coin===getDisplayFiatCurrency())?.value}/>
          {isFiat(unit)&&priceSats!==null&&<p className="gys-pos-terminal__muted">
            Approximately {formatWithSpaces(priceSats)} sats · Indicative SDK rate
          </p>}
        </section>
        <div className="gys-pos-terminal__decimal-row">
          <button type="button" onClick={()=>input('.')} disabled={unit==='sats'} aria-label="Decimal point">. Decimal</button>
          <button type="button" onClick={()=>input('C')} aria-label="Clear amount">Clear</button>
        </div>
        <section className="gys-pos-terminal__note">
          {!editingNote?<button type="button" onClick={()=>setEditingNote(true)}>
            ✎ {note||'Add a note (optional)'}
          </button>:<label>Order note (optional)
            <input autoFocus type="text" value={note} maxLength={200}
              placeholder="Order reference" enterKeyHint="done"
              onFocus={event=>{const input=event.currentTarget;window.setTimeout(()=>input.scrollIntoView({block:'nearest',behavior:'smooth'}),200)}}
              onChange={event=>setNote(event.target.value)}
              onKeyDown={event=>{if(event.key==='Enter')setEditingNote(false)}}/>
            <button type="button" onClick={()=>setEditingNote(false)}>Done</button>
          </label>}
        </section>
        <div className="gys-pos-terminal__keypad" role="group" aria-label="Amount keypad">
          {['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(key=>
            <button key={key} type="button" onClick={()=>input(key)} disabled={busy || (key==='.'&&unit==='sats')}
              aria-label={key==='C'?'Clear amount':key==='⌫'?'Delete last digit':key==='.'?'Decimal point':key}>{key}</button>)}
        </div>
        <footer className="gys-pos-terminal__footer">
          <button type="button" className="gys-pos-terminal__charge"
            onClick={()=>void create()} disabled={busy||!priceSats}>
            {busy?'Creating Lightning invoice…':'Charge'}
          </button>
        </footer>
      </>}
      {!!orders.length&&showHistory&&<section aria-label="Recent device POS orders" className="gys-pos-terminal__history">
        <p className="gys-pos-terminal__muted">Recent orders on this device · wallet verified for completed status</p>
        <ol>{orders.slice(0,5).map(order=><li key={order.id}>
          <button type="button" onClick={()=>{
            setInvoice(order.invoice);setInvoiceSats(order.amountSats);setInvoiceUnit(order.unit);
            setFee(order.feeSats);setPaid(confirmedIds.has(order.id));setFreshlyConfirmed(false);setShowHistory(false);setError('');
          }}>
            {formatWithSpaces(order.amountSats)} sats · {order.description.slice(0,32)} ·
            {confirmedIds.has(order.id)?' Confirmed':' Awaiting verification'}
          </button>
        </li>)}</ol>
      </section>}
      {!!journalWarning&&<p role="status" className="gys-pos-terminal__error">{journalWarning}</p>}
      {!!error&&<p role="alert" className="gys-pos-terminal__error">{error}</p>}
    </div>
  </div>;
}
