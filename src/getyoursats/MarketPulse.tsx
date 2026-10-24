import {useEffect,useState} from 'react';
import {useFiatData} from '../contexts/FiatDataContext';
import {getDisplayFiatCurrency,getFiatSettings,setDisplayFiatCurrency} from '../services/settings';
/** Display-only SDK market quotes. No fabricated exchange or sale prices. */
export default function MarketPulse(){
 const {fiatRates,fetchedAt,refreshFiatData}=useFiatData();
 const [currency,setCurrency]=useState(getDisplayFiatCurrency);
 const [unit,setUnit]=useState<'BTC'|'sats'>('BTC');
 const [clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{
  const timer=window.setInterval(()=>setClock(Date.now()),30000);
  const sync=()=>setCurrency(getDisplayFiatCurrency());
  window.addEventListener('gys:fiat-pref-changed',sync);
  return()=>{window.clearInterval(timer);window.removeEventListener('gys:fiat-pref-changed',sync)};
 },[]);
 const rate=fiatRates.find(x=>x.coin===currency)?.value;
 const valid=typeof rate==='number'&&Number.isFinite(rate)&&rate>0?rate:null;
 const stale=!fetchedAt||clock-fetchedAt>120000;
 const value=valid==null?'Rate unavailable':(()=>{
  const amount=unit==='BTC'?valid:valid/100000;
  try{return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:unit==='BTC'?2:4}).format(amount)}
  catch{return currency+' '+amount.toFixed(2)}
 })();
 const currencies=getFiatSettings().selectedCurrencies;
 const cycle=()=>{
  if(currencies.length<2)return;
  const next=currencies[(Math.max(0,currencies.indexOf(currency))+1)%currencies.length];
  setCurrency(next);setDisplayFiatCurrency(next);
 };
 return <section className="gys-market-pulse" aria-label="Bitcoin market price">
  <div className="gys-market-pulse__top">
   <span className="gys-market-pulse__tag"><span className={'gys-market-pulse__dot'+(stale?' gys-market-pulse__dot--stale':'')} aria-hidden="true"/>BTC MARKET RATE</span>
   <div className="gys-market-pulse__switches" aria-label="Market rate display">
    <button type="button" onClick={()=>setUnit(unit==='BTC'?'sats':'BTC')}
     aria-label={unit==='BTC'?'Show value of 1,000 sats':'Show Bitcoin price'}>{unit==='BTC'?'1 BTC':'1,000 丰'} ↕</button>
    <button type="button" onClick={cycle} disabled={currencies.length<2}
     aria-label="Cycle preferred fiat currency">{currency}{currencies.length>1?' ↕':''}</button>
   </div>
  </div>
  <div className="gys-market-pulse__quote"><span className="gys-market-pulse__price">{value}</span>
   <span className="gys-market-pulse__unit">/ {unit==='BTC'?'BTC':'1k sats'}</span></div>
  <div className="gys-market-pulse__bottom">
   <span>{fetchedAt?(stale?'Last known rate · ':'Updated ')+new Date(fetchedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Waiting for a wallet quote'} · Indicative only</span>
   <button type="button" onClick={()=>void refreshFiatData()} aria-label="Refresh Bitcoin price">↻ Refresh</button>
  </div>
 </section>;
}
