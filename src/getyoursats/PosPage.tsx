import {useEffect,useRef,useState} from 'react';
import QRCode from 'react-qr-code';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {useWallet} from '../contexts/WalletContext';
import {useFiatData} from '../contexts/FiatDataContext';
import {useInvoicePaid} from '../hooks/useInvoicePaid';
import {formatWithSpaces} from '../utils/formatNumber';
import {getDisplayFiatCurrency} from '../services/settings';
import {amountToSats,getDenomination,saveDenomination,satsToAmount,type Denomination} from './denomination';
import DenominationTabs from './DenominationTabs';

const isFiat=(unit:Denomination)=>unit!=='sats'&&unit!=='BTC';
/** OS number-keyboards have obscured Charge in iOS Safari/standalone mode.
 * The amount is entered exclusively by an accessible in-app keypad. */
export default function PosPage({onClose}:{onClose:()=>void}){
  const sdk=useWallet();
  const {fiatRates,fetchedAt,refreshFiatData}=useFiatData();
  const root=useRef<HTMLDivElement|null>(null);
  const [unit,setUnit]=useState<Denomination>(getDenomination);
  const [amount,setAmount]=useState('');
  const [note,setNote]=useState('');
  const [editingNote,setEditingNote]=useState(false);
  const [invoice,setInvoice]=useState('');
  const [invoiceSats,setInvoiceSats]=useState(0);
  const [invoiceUnit,setInvoiceUnit]=useState<Denomination>('sats');
  const [fee,setFee]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [paid,setPaid]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const [history,setHistory]=useState<Payment[]>([]);
  const [historyBusy,setHistoryBusy]=useState(false);
  const fiatCode=isFiat(unit)?unit:getDisplayFiatCurrency();
  const fiatRate=fiatRates.find(r=>r.coin===fiatCode)?.value;
  const validRate=typeof fiatRate==='number'&&Number.isFinite(fiatRate)&&fiatRate>0?fiatRate:undefined;
  const priceSats=amountToSats(amount,unit,validRate);
  const settled=paid;
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
    setPaid(true);
    // A successful SDK event, never an editable local flag, confirms paid.
    void loadHistory();
  });
  const loadHistory=async()=>{
    setHistoryBusy(true);
    try{
      const result=await sdk.listPayments({typeFilter:['receive'],statusFilter:['completed'],offset:0,limit:50});
      setHistory(result.payments);
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
    setBusy(true);setError('');setPaid(false);
    try {
      let rate=validRate;
      if(isFiat(unit)){
        const latest=await refreshFiatData();
        rate=latest.fiatRates.find(r=>r.coin===unit)?.value;
        if(!rate||!latest.fetchedAt||Date.now()-latest.fetchedAt>120_000)
          throw new Error('A fresh '+unit+' Bitcoin quote is unavailable. Try sats or BTC.');
      }
      const sats=amountToSats(amount,unit,rate);
      if(!sats)throw new Error('The amount must equal at least one satoshi.');
      const response=await sdk.receivePayment({paymentMethod:{
        type:'bolt11Invoice',description:(note.trim()||'Payment').slice(0,200),amountSats:sats
      }});
      setInvoice(response.paymentRequest);
      setInvoiceSats(sats);
      setInvoiceUnit(unit);
      setFee(Number(response.fee));
    }catch(e){setError(e instanceof Error?e.message:'Could not create the invoice.')}
    finally{setBusy(false)}
  };
  const showList=()=>{
    setShowHistory(true);
    void loadHistory();
  };
  const copy=async()=>{
    try{await navigator.clipboard.writeText(invoice)}catch{setError('Could not copy invoice')}
  };
  const reset=()=>{setInvoice('');setAmount('');setPaid(false);setShowHistory(false);setError('')};
  return <div ref={root} role="dialog" aria-modal="true" aria-label="Merchant point of sale" className="gys-pos gys-pos--terminal">
    <div className="gys-pos-terminal">
      <header className="gys-pos-terminal__header">
        <strong>Point of Sale</strong>
        <div>
          <button type="button" onClick={showList} aria-label="Payment history">History</button>
          <button type="button" onClick={onClose} aria-label="Close point of sale">✕</button>
        </div>
      </header>
      {showHistory?<section className="gys-pos-terminal__history">
        <div className="gys-pos-terminal__row"><h2>Wallet receipts</h2>
          <button type="button" onClick={()=>setShowHistory(false)}>Back</button></div>
        <p className="gys-pos-terminal__muted">Only completed incoming payments verified by the connected wallet are listed.</p>
        {historyBusy?<p role="status">Syncing wallet history…</p>:
          history.length===0?<p>No completed incoming payments found.</p>:
          <ol>{history.map(payment=><li key={payment.id}>
            <span>{new Date(payment.timestamp*1000).toLocaleString()}</span>
            <strong>{formatWithSpaces(payment.amount)} 丰</strong>
          </li>)}</ol>}
      </section>:invoice?<section className="gys-pos-terminal__invoice" aria-live="polite">
        <div className="gys-pos-terminal__qr"><QRCode value={invoice.toUpperCase()} size={218}/></div>
        <h2>{formatWithSpaces(invoiceSats)} <span>丰 sats</span></h2>
        <p>Requested in {invoiceUnit} · Receives Lightning sats</p>
        <strong className={settled?'gys-pos-paid':'gys-pos-pending'}>
          {settled?'Payment confirmed by the wallet':'Waiting for payment confirmation'}
        </strong>
        <small>Estimated receiver fee: {fee} sats</small>
        <button type="button" className="gys-pos-terminal__secondary" onClick={()=>void copy()}>Copy invoice</button>
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
      {!!error&&<p role="alert" className="gys-pos-terminal__error">{error}</p>}
    </div>
  </div>;
}
