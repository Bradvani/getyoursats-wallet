import {useEffect, useState} from 'react';
import {PRODUCT_POLISH} from '../locales/productPolish';
import {usePresentation} from '../hooks/usePresentation';
import {PREMIUM_EXPERIENCE} from '../locales/premiumExperience';
import {fiatLocale, formatFiat, formatMarketMagnitude} from '../utils/formatFiat';

type SentimentClass = 'Extreme Fear'|'Fear'|'Neutral'|'Greed'|'Extreme Greed';
type Overview = {
  change?:{percent:number;updatedAt:number}|null;
  supply: {btc:number;updatedAt:number}|null;
  sentiment: {value:number;classification:SentimentClass;updatedAt:number}|null;
};
const sentimentKeys = {'Extreme Fear':'extremeFear',Fear:'fear',Neutral:'neutral',Greed:'greed','Extreme Greed':'extremeGreed'} as const;
const validDate=(value:number,maxAge:number,now:number)=>Number.isSafeInteger(value)&&value>0&&value<=now+60000&&now-value<=maxAge;
export function checkedOverview(raw:Overview, now=Date.now()):Overview {
  const supply=raw?.supply; const sentiment=raw?.sentiment;
  const change=raw?.change;
  return {
    change:change&&Number.isFinite(change.percent)&&change.percent>=-100&&validDate(change.updatedAt,900000,now)?change:null,
    supply:supply&&Number.isFinite(supply.btc)&&supply.btc>0&&supply.btc<=21000000&&validDate(supply.updatedAt,21600000,now)?supply:null,
    sentiment:sentiment&&Number.isInteger(sentiment.value)&&sentiment.value>=0&&sentiment.value<=100&&
      Object.prototype.hasOwnProperty.call(sentimentKeys,sentiment.classification)&&validDate(sentiment.updatedAt,172800000,now)?sentiment:null,
  };
}

export default function MarketOverview({currency,rate,refreshKey=0}:{currency:string;rate:number|null;refreshKey?:number}) {
  const {language}=usePresentation(); const text=PREMIUM_EXPERIENCE[language]; const copy=PRODUCT_POLISH[language];
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
  const {supply,sentiment,change}=checkedOverview(data,clock);
  const cap=supply&&rate&&Number.isFinite(rate)&&rate>0?supply.btc*rate:null;
  const number=new Intl.NumberFormat(fiatLocale(currency,language),{maximumFractionDigits:2,numberingSystem:'latn'});
  const updated=(time:number)=>new Date(time).toLocaleString(language,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  return <div className="gys-market-overview" data-testid="market-overview">
    <div className="gys-market-change" data-testid="market-change"><span>{copy.change}</span><strong><bdi>{change?`${change.percent>0?'+':''}${number.format(change.percent)}%`:text.unavailable}</bdi></strong></div>
    <dl className="gys-market-overview__stats">
      <div><dt>{text.cap} <span dir="ltr">· {currency}</span></dt><dd>{cap?<details className="gys-market-cap-detail"><summary><bdi data-testid="market-cap">{formatMarketMagnitude(cap,currency,language)}</bdi><span className="sr-only"> · {copy.exact}</span></summary><p className="text-sm mt-2" data-testid="market-cap-exact"><bdi>{formatFiat(cap,currency,language)}</bdi></p></details>:<span data-testid="market-cap">{text.unavailable}</span>}</dd></div>
      <div><dt>{text.supply}</dt><dd data-testid="market-supply"><bdi>{supply?`${number.format(supply.btc)} BTC`:text.unavailable}</bdi></dd></div>
    </dl>
    <div className="gys-market-scarcity">
      <div><span>{text.limit} <bdi>{number.format(21000000)} BTC</bdi></span><strong>{supply?`${number.format(supply.btc/210000)}% ${text.issued}`:'—'}</strong></div>
      <p className="gys-market-remaining"><span>{copy.remaining}</span><strong data-testid="market-remaining"><bdi>{supply?number.format(Math.max(0,21000000-supply.btc)):text.unavailable}</bdi></strong></p>
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
      <p>{text.sentimentNote}</p><p><a href="https://www.coingecko.com/en/coins/bitcoin" target="_blank" rel="noopener noreferrer">CoinGecko ↗</a>{change&&<> · <time dateTime={new Date(change.updatedAt).toISOString()}>{updated(change.updatedAt)}</time></>}</p></details>
  </div>;
}
