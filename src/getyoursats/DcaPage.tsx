import {useState} from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import {useFiatData} from '../contexts/FiatDataContext';
import DenominationTabs from './DenominationTabs';
import {getDenomination,saveDenomination,satsToAmount,type Denomination} from './denomination';
import {loadDcaDraft,saveDcaDraft,validateDcaDraft,type DcaFrequency} from './dcaPlan';
export default function DcaPage({onBack}:{onBack:()=>void}){
  const old=loadDcaDraft();
  const {fiatRates,fetchedAt}=useFiatData();
  const inrPerBtc=fiatRates.find(r=>r.coin==='INR')?.value;
  const [unit,setUnit]=useState<Denomination>(old?.denomination??getDenomination);
  const [amount,setAmount]=useState(old?.enteredAmount??'');
  const [frequency,setFrequency]=useState<DcaFrequency>(old?.frequency??'weekly');
  const [message,setMessage]=useState('');
  const selectUnit=(next:Denomination)=>{
    if(next==='INR'&&!inrPerBtc)return;
    const prior=validateDcaDraft({amount,denomination:unit,frequency,inrPerBtc}).draft;
    setUnit(next);saveDenomination(next);
    setAmount(prior?satsToAmount(prior.estimatedSats,next,inrPerBtc):'');
    setMessage('');
  };
  const save=()=>{
    if(!fetchedAt||Date.now()-fetchedAt>120_000){
      setMessage('A fresh BTC/INR rate is required before saving this plan.');
      return;
    }
    const result=validateDcaDraft({amount,denomination:unit,frequency,inrPerBtc});
    if(!result.draft){setMessage(result.error??'Invalid plan');return}
    try{
      saveDcaDraft(result.draft);
      setMessage('Draft saved on this device. No bank mandate or purchase has been created.');
    }catch{setMessage('Could not save this draft on your device.')}
  };
  return <SlideInPage title="Recurring buys" onClose={onBack} closeStyle="back">
    <div className="gys-dca">
      <p className="gys-dca__eyebrow">STACK BITCOIN ON YOUR SCHEDULE</p>
      <h2>Build a recurring plan</h2>
      <p className="gys-dca__sub">Choose an amount and rhythm. Orders will require a verified UPI AutoPay and exchange partner before activation.</p>
      <label>Purchase amount</label>
      <DenominationTabs value={unit} onChange={selectUnit} inrAvailable={!!inrPerBtc}/>
      <input inputMode={unit==='sats'?'numeric':'decimal'} placeholder={unit==='INR'?'₹ 20.00':unit==='BTC'?'0.0001':'1000'} value={amount} onChange={e=>{setAmount(e.target.value);setMessage('')}}/>
      <p className="gys-dca__sub">₹20 minimum equivalent per purchase. Exchange spreads and UPI mandate fees are not quoted yet.</p>
      <label htmlFor="gys-dca-frequency">Purchase frequency</label>
      <select id="gys-dca-frequency" value={frequency} onChange={e=>setFrequency(e.target.value as DcaFrequency)}>
        <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="every-two-weeks">Every two weeks</option>
      </select>
      <button type="button" className="gys-primary" onClick={save}>Save plan draft</button>
      {message&&<p role="status" className="gys-dca__message">{message}</p>}
      <p className="gys-dca__sub">Nothing is debited or scheduled from this screen. An approved payment partner must separately authorise recurring collection.</p>
    </div>
  </SlideInPage>;
}
