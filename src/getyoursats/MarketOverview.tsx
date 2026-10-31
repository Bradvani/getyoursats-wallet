import {useEffect, useState} from 'react';
import {usePresentation} from '../hooks/usePresentation';
import {PREMIUM_EXPERIENCE} from '../locales/premiumExperience';
import {fiatLocale, formatFiat} from '../utils/formatFiat';

type SentimentClass = 'Extreme Fear'|'Fear'|'Neutral'|'Greed'|'Extreme Greed';
type Overview = {
  supply: {btc:number;updatedAt:number}|null;
  sentiment: {value:number;classification:SentimentClass;updatedAt:number}|null;
};
const sentimentKeys = {'Extreme Fear':'extremeFear',Fear:'fear',Neutral:'neutral',Greed:'greed','Extreme Greed':'extremeGreed'} as const;
const validDate=(value:number,maxAge:number,now:number)=>Number.isSafeInteger(value)&&value>0&&value<=now+60000&&now-value<=maxAge;
export function checkedOverview(raw:Overview, now=Date.now()):Overview {
  const supply=raw?.supply; const sentiment=raw?.sentiment;
  return {
    supply:supply&&Number.isFinite(supply.btc)&&supply.btc>0&&supply.btc<=21000000&&validDate(supply.updatedAt,21600000,now)?supply:null,
    sentiment:sentiment&&Number.isInteger(sentiment.value)&&sentiment.value>=0&&sentiment.value<=100&&
      Object.prototype.hasOwnProperty.call(sentimentKeys,sentiment.classification)&&validDate(sentiment.updatedAt,172800000,now)?sentiment:null,
  };
}

export default function MarketOverview({currency,rate,refreshKey=0}:{currency:string;rate:number|null;refreshKey?:number}) {
  const {language}=usePresentation(); const text=PREMIUM_EXPERIENCE[language];
  const [data,setData]=useState<Overview>({supply:null,sentiment:null});
  const [clock,setClock]=useState(Date.now);
  useEffect(()=>{
    let disposed=false;let pending:AbortController|null=null;
    const refresh=async()=>{
      if(pending)return;
      const controller=new AbortController();pending=controller;
      const timeout=window.setTimeout(()=>controller.abort(),8000);
      try {
        const response=await fetch('/api/market-overview',{credentials:'omit',signal:controller.signal});
        if(!response.ok)throw new Error('Unavailable');
        const result=checkedOverview(await response.json());
        if(!disposed&&!controller.signal.aborted){setData(result);setClock(Date.now());}
      } catch { /* Preserve the source timestamp; never present a refresh failure as new data. */ }
      finally{window.clearTimeout(timeout);pending=null;}
    };
    void refresh();
    const timer=window.setInterval(()=>{setClock(Date.now());if(document.visibilityState==='visible')void refresh();},300000);
    return()=>{disposed=true;pending?.abort();window.clearInterval(timer);};
  },[refreshKey]);
  const {supply,sentiment}=checkedOverview(data,clock);
  const cap=supply&&rate&&Number.isFinite(rate)&&rate>0?supply.btc*rate:null;
  const number=new Intl.NumberFormat(fiatLocale(currency,language),{maximumFractionDigits:2,numberingSystem:'latn'});
  const updated=(time:number)=>new Date(time).toLocaleString(language,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  return <div className="gys-market-overview" data-testid="market-overview">
    <dl className="gys-market-overview__stats">
      <div><dt>{text.cap} <span dir="ltr">· {currency}</span></dt><dd data-testid="market-cap"><bdi>{cap?formatFiat(cap,currency,language):text.unavailable}</bdi></dd></div>
      <div><dt>{text.supply}</dt><dd data-testid="market-supply"><bdi>{supply?`${number.format(supply.btc)} BTC`:text.unavailable}</bdi></dd></div>
    </dl>
    <div className="gys-market-scarcity">
      <div><span>{text.limit} <bdi>{number.format(21000000)} BTC</bdi></span><strong>{supply?`${number.format(supply.btc/210000)}% ${text.issued}`:'—'}</strong></div>
      <progress aria-label={text.supply} max={21000000} value={supply?.btc??0}/>
    </div>
    <section className="gys-market-sentiment" aria-label={text.sentiment}>
      <div className="gys-market-sentiment__heading"><div><h3>{text.sentiment}</h3><p>{text.sentimentHint}</p></div>
        <strong data-testid="market-sentiment">{sentiment?<><bdi>{sentiment.value}<small>/100</small></bdi><span>{text[sentimentKeys[sentiment.classification]]}</span></>:text.unavailable}</strong></div>
      {sentiment&&<div className="gys-market-sentiment__scale" role="meter" aria-label={text.sentiment} aria-valuemin={0} aria-valuemax={100} aria-valuenow={sentiment.value} aria-valuetext={text[sentimentKeys[sentiment.classification]]}>
        <i style={{insetInlineStart:`${sentiment.value}%`}}/></div>}
      <div className="gys-market-sentiment__source"><a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener noreferrer">Alternative.me ↗</a>
        {sentiment&&<time dateTime={new Date(sentiment.updatedAt).toISOString()}>{text.updated} {updated(sentiment.updatedAt)}</time>}</div>
    </section>
    <details className="gys-market-method"><summary>{text.sources}</summary><p>{text.capHint}</p><p>{text.supplyHint}</p>
      <p><a href="https://www.blockchain.com/explorer/charts/total-bitcoins" target="_blank" rel="noopener noreferrer">Blockchain.com ↗</a>{supply&&<> · <time dateTime={new Date(supply.updatedAt).toISOString()}>{updated(supply.updatedAt)}</time></>}</p>
      <p>{text.sentimentNote}</p></details>
  </div>;
}
