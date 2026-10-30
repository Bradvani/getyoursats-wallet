import {useEffect,useState} from 'react';
import {usePresentation} from '../hooks/usePresentation';
import {MARKET_COPY} from '../locales/market';
import {PAYMENT_FIAT_COPY} from '../locales/paymentFiat';
import {FIAT_ESTIMATE_MAX_AGE_MS} from '../utils/formatFiat';
import {useFiatData} from '../contexts/FiatDataContext';
import {getDisplayFiatCurrency,getFiatSettings,setDisplayFiatCurrency} from '../services/settings';
import {
  MARKET_QUOTE_UNITS,formatMarketFiat,type MarketQuoteUnitId,
} from './marketQuoteUnits';

const PREFERENCE_KEY='gys:market-quote-unit:v1';
function selectedMarketUnit():MarketQuoteUnitId {
  try {
    const saved=localStorage.getItem(PREFERENCE_KEY);
    return MARKET_QUOTE_UNITS.find(x=>x.id===saved)?.id??'btc';
  } catch {return 'btc'}
}

/**
 * Prominent, compact Bitcoin price reference above recent activity.
 * Never an executable trading quote. BTC amount changes affect this card
 * only; wallet custody, balances and payment denominations stay untouched.
 */
export default function MarketPulse(){
  const {fiatRates,fetchedAt,refreshFiatData}=useFiatData();
  const {language}=usePresentation();
  const text=MARKET_COPY[language];
  const [refreshing,setRefreshing]=useState(false);
  const [currency,setCurrency]=useState(getDisplayFiatCurrency);
  const [quoteUnit,setQuoteUnit]=useState<MarketQuoteUnitId>(selectedMarketUnit);
  const [clock,setClock]=useState(()=>Date.now());

  useEffect(()=>{
    const first=window.setTimeout(()=>setClock(Date.now()),0);
    const timer=window.setInterval(()=>setClock(Date.now()),30000);
    const sync=()=>setCurrency(getDisplayFiatCurrency());
    window.addEventListener('gys:fiat-pref-changed',sync);
    return()=>{window.clearInterval(timer);window.clearTimeout(first);window.removeEventListener('gys:fiat-pref-changed',sync)};
  },[fetchedAt]);

  const rate=fiatRates.find(x=>x.coin===currency)?.value;
  const unit=MARKET_QUOTE_UNITS.find(x=>x.id===quoteUnit)??MARKET_QUOTE_UNITS[0];
  const now=clock;
  const hasRate=!!rate&&Number.isFinite(rate)&&rate>0;
  const stale=!hasRate||!fetchedAt||now<fetchedAt||now-fetchedAt>FIAT_ESTIMATE_MAX_AGE_MS;
  const price=hasRate?formatMarketFiat(rate,currency,unit.satoshis,language):PAYMENT_FIAT_COPY[language];
  const refresh=async()=>{
    if(refreshing)return;
    setRefreshing(true);
    try{await refreshFiatData();setClock(Date.now());}
    finally{setRefreshing(false);}
  };
  const currencies=getFiatSettings().selectedCurrencies;

  const cycleCurrency=()=>{
    if(currencies.length<2)return;
    const next=currencies[(Math.max(0,currencies.indexOf(currency))+1)%currencies.length];
    setCurrency(next);
    setDisplayFiatCurrency(next);
  };
  const chooseUnit=(id:MarketQuoteUnitId)=>{
    setQuoteUnit(id);
    try {localStorage.setItem(PREFERENCE_KEY,id)} catch {/* optional preference */}
  };

  return <section className="gys-market-pulse gys-market-pulse--glance"
    aria-label={text.title} data-testid="bitcoin-market">
    <div className="gys-market-pulse__top">
      <span className="gys-market-pulse__tag">
        <span className={'gys-market-pulse__dot'+(stale?' gys-market-pulse__dot--stale':'')} aria-hidden="true"/>
        {text.title.toLocaleUpperCase(language)}
      </span>
      <div className="gys-market-pulse__switches" aria-label={text.currency}>
        <button type="button" onClick={cycleCurrency} disabled={currencies.length<2}
          aria-label={text.currency}>
          {currency}{currencies.length>1?' ↕':''}
        </button>
      </div>
    </div>
    <div className="gys-market-pulse__quote" aria-live="polite" aria-atomic="true">
      <span className="gys-market-pulse__price" data-testid="market-quote-price"><bdi>{price}</bdi></span>
      <span className="gys-market-pulse__unit">{text.for} <bdi>{unit.label}</bdi></span>
    </div>
    <div className="gys-market-pulse__denominations"
      role="group" aria-label={text.amount}>
      {MARKET_QUOTE_UNITS.map(choice=><button key={choice.id} type="button"
        data-testid={'market-unit-'+choice.id}
        onClick={()=>chooseUnit(choice.id)}
        aria-pressed={quoteUnit===choice.id}
        title={text.amount+': '+choice.label}
      >{choice.label}</button>)}
    </div>
    <div className="gys-market-pulse__bottom">
      <span role="status">{hasRate&&fetchedAt
        ?`${stale?text.last:text.updated} ${new Date(fetchedAt).toLocaleTimeString(language,{hour:'2-digit',minute:'2-digit'})}`
        :PAYMENT_FIAT_COPY[language]} · {text.indicative}</span>
      <button type="button" onClick={()=>void refresh()} disabled={refreshing} aria-busy={refreshing}
        aria-label={`${text.refresh} ${text.title}`}>
        ↻ {refreshing?text.refreshing:text.refresh}
      </button>
    </div>
  </section>;
}
