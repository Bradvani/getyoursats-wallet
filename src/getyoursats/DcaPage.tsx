import {useEffect,useState} from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import {useFiatData} from '../contexts/FiatDataContext';
import {getDisplayFiatCurrency} from '../services/settings';
import DenominationTabs from './DenominationTabs';
import {getDenomination,isFiatDenomination,saveDenomination,satsToAmount,type Denomination} from './denomination';
import {loadDcaDraft,saveDcaDraft,validateDcaDraft,type DcaFrequency} from './dcaPlan';
export default function DcaPage({onBack}:{onBack:()=>void}){
 const [old]=useState(loadDcaDraft);
 const {fiatRates,fetchedAt}=useFiatData();
 const [unit,setUnit]=useState<Denomination>(old?.denomination??getDenomination);
 const [currency,setCurrency]=useState(getDisplayFiatCurrency);
 const [amount,setAmount]=useState(old?.enteredAmount??'');
 const [frequency,setFrequency]=useState<DcaFrequency>(old?.frequency??'weekly');
 const [message,setMessage]=useState('');
 useEffect(()=>{
  const sync=()=>{setCurrency(getDisplayFiatCurrency());setUnit(getDenomination())};
  window.addEventListener('gys:fiat-pref-changed',sync);
  return()=>window.removeEventListener('gys:fiat-pref-changed',sync);
 },[]);
 const quoteCurrency=isFiatDenomination(unit)?unit:currency;
 const rate=fiatRates.find(r=>r.coin===quoteCurrency)?.value;
 const selectUnit=(next:Denomination)=>{
  const previous=validateDcaDraft({amount,denomination:unit,frequency,fiatCurrency:quoteCurrency,fiatPerBtc:rate}).draft;
  const nextRate=fiatRates.find(r=>r.coin===(isFiatDenomination(next)?next:currency))?.value;
  setUnit(next);saveDenomination(next);
  setAmount(previous?satsToAmount(previous.estimatedSats,next,nextRate):'');
  setMessage('');
 };
 const save=()=>{
  if(!fetchedAt||Date.now()-fetchedAt>120_000||!rate){
   setMessage('A current BTC/'+quoteCurrency+' rate is required to save a draft.');return;
  }
  const result=validateDcaDraft({amount,denomination:unit,frequency,fiatCurrency:quoteCurrency,fiatPerBtc:rate});
  if(!result.draft){setMessage(result.error??'Invalid draft');return;}
  try{saveDcaDraft(result.draft);setMessage('Draft saved locally. No purchase, debit or bank mandate has been created.')}
  catch{setMessage('Could not save this draft on your device.')}
 };
 return <SlideInPage title="Recurring Buys" onClose={onBack} closeStyle="back">
  <div className="gys-dca">
   <p className="gys-dca__eyebrow">BUILD A BITCOIN HABIT</p>
   <h2>Plan recurring Bitcoin purchases</h2>
   <p className="gys-dca__sub">Choose an amount and interval. Purchases require a verified payment partner before activation.</p>
   <label>Purchase amount</label>
   <DenominationTabs value={unit} onChange={selectUnit} fiatAvailable={!!rate}/>
   <input inputMode={unit==='sats'?'numeric':'decimal'} placeholder={isFiatDenomination(unit)?'100.00 '+unit:unit==='BTC'?'0.0001':'1000'}
     value={amount} onChange={e=>{setAmount(e.target.value);setMessage('')}}/>
   <p className="gys-dca__sub">Conversion shown in {quoteCurrency}. Provider minimums and fees are not available until activation.</p>
   <label htmlFor="gys-dca-frequency">Purchase frequency</label>
   <select id="gys-dca-frequency" value={frequency} onChange={e=>setFrequency(e.target.value as DcaFrequency)}>
    <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="every-two-weeks">Every two weeks</option><option value="monthly">Monthly</option>
   </select>
   <button type="button" className="gys-primary" onClick={save}>Save Plan Draft</button>
   {message&&<p role="status" className="gys-dca__message">{message}</p>}
   <p className="gys-dca__sub">This screen does not schedule or execute any fiat purchase.</p>
  </div>
 </SlideInPage>;
}
