import {useState} from 'react';
import QRCode from 'react-qr-code';
import {useWallet} from '../contexts/WalletContext';
import {useFiatData} from '../contexts/FiatDataContext';
import {useInvoicePaid} from '../hooks/useInvoicePaid';
import {formatWithSpaces} from '../utils/formatNumber';
import {amountToSats, getDenomination, saveDenomination, satsToAmount, type Denomination} from './denomination';
import DenominationTabs from './DenominationTabs';

export default function PosPage({onClose}:{onClose:()=>void}){
  const sdk=useWallet();
  const {fiatRates, fetchedAt, refreshFiatData}=useFiatData();
  const [unit,setUnit]=useState<Denomination>(getDenomination);
  const [amount,setAmount]=useState('');
  const [note,setNote]=useState('Order');
  const [invoice,setInvoice]=useState('');
  const [invoiceSats,setInvoiceSats]=useState(0);
  const [invoiceUnit,setInvoiceUnit]=useState<Denomination>('sats');
  const [fee,setFee]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [paid,setPaid]=useState(false);

  const inrRate=fiatRates.find(r=>r.coin==='INR')?.value;
  const isRateFresh=!!fetchedAt && Date.now()-fetchedAt < 120_000;
  const displayRate=isRateFresh ? inrRate : undefined;
  const approxSats=amountToSats(amount,unit,displayRate);
  const onUnit=(next:Denomination)=>{
    if(next==='INR'&&!displayRate)return;
    const current=amountToSats(amount,unit,displayRate);
    setAmount(current ? satsToAmount(current,next,displayRate):'');
    setUnit(next);saveDenomination(next);setError('');
  };
  // Only a matching Breez paymentSucceeded SDK event means paid.
  useInvoicePaid(invoice,()=>setPaid(true));
  const create=async()=>{
    if(busy)return;
    setBusy(true);setError('');setPaid(false);
    try{
      const latest=unit==='INR' ? await refreshFiatData() : null;
      const currentRate=latest?.fiatRates.find(r=>r.coin==='INR')?.value;
      if(unit==='INR'&&(!latest?.fetchedAt||Date.now()-latest.fetchedAt>120_000||!currentRate)){
        setError('A live INR/BTC rate is unavailable. Try sats or BTC instead.');
        return;
      }
      const n=amountToSats(amount,unit,currentRate);
      if(!n){setError('Enter a valid amount that converts to at least one satoshi.');return}
      const x=await sdk.receivePayment({paymentMethod:{
        type:'bolt11Invoice',description:note.slice(0,200),amountSats:n
      }});
      setInvoice(x.paymentRequest);setInvoiceSats(n);setInvoiceUnit(unit);setFee(Number(x.fee));
    }catch(e){
      setError(e instanceof Error ? e.message : 'Unable to create a Lightning invoice');
    }finally{setBusy(false)}
  };
  return <div role="dialog" aria-modal="true" aria-label="Merchant POS" className="gys-pos">
    <div className="gys-pos-card">
      <header><strong>Accept Bitcoin</strong><button type="button" onClick={onClose} aria-label="Close">✕</button></header>
      {!invoice ? <section>
        <label>Amount <DenominationTabs value={unit} onChange={onUnit} disabled={busy} inrAvailable={!!displayRate}/>
          <input value={amount} onChange={e=>setAmount(e.target.value)}
            inputMode={unit==='sats'?'numeric':'decimal'}
            placeholder={unit==='sats'?'10 000':unit==='BTC'?'0.0001':'₹ 20.00'}/>
        </label>
        {unit==='INR' && <small className="gys-pos-note">Indicative conversion from Breez's latest BTC/INR rate. Payment settles in sats.</small>}
        {unit!=='sats' && approxSats && <div className="gys-pos-equivalent">≈ {formatWithSpaces(approxSats)} sats</div>}
        <label>Order reference<input value={note} onChange={e=>setNote(e.target.value)} maxLength={200}/></label>
        <button type="button" className="gys-primary" disabled={busy} onClick={()=>void create()}>
          {busy?'Creating invoice…':'Create Lightning invoice'}
        </button>
      </section>:<section className="gys-invoice">
        <div className="gys-qr"><QRCode value={invoice.toUpperCase()} size={210}/></div>
        <h2>{formatWithSpaces(invoiceSats)} sats</h2>
        <p className="gys-pos-note">Entered in {invoiceUnit} · Settlement in Bitcoin</p>
        <p aria-live="polite" className={paid?'gys-pos-paid':'gys-pos-pending'}>
          {paid?'Payment confirmed':'Awaiting payment'}
        </p>
        <button type="button" onClick={()=>void navigator.clipboard.writeText(invoice)}>Copy invoice</button>
        <small>Receiver fee estimate: {fee} sats</small>
        <button type="button" className="gys-primary" onClick={()=>{setInvoice('');setAmount('');setPaid(false)}}>New sale</button>
      </section>}
      {error&&<p role="alert" className="gys-error">{error}</p>}
    </div>
  </div>;
}
