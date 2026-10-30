import {useEffect,useState} from 'react';
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
  const [currency,setCurrency]=useState(getDisplayFiatCurrency);
  const [quoteUnit,setQuoteUnit]=useState<MarketQuoteUnitId>(selectedMarketUnit);
  const [clock,setClock]=useState(()=>Date.now());

  useEffect(()=>{
    const timer=window.setInterval(()=>setClock(Date.now()),30000);
    const sync=()=>setCurrency(getDisplayFiatCurrency());
    window.addEventListener('gys:fiat-pref-changed',sync);
    return()=>{window.clearInterval(timer);window.removeEventListener('gys:fiat-pref-changed',sync)};
  },[]);

  const rate=fiatRates.find(x=>x.coin===currency)?.value;
  const unit=MARKET_QUOTE_UNITS.find(x=>x.id===quoteUnit)??MARKET_QUOTE_UNITS[0];
  const stale=!fetchedAt||clock-fetchedAt>120000;
  const price=formatMarketFiat(rate,currency,unit.satoshis);
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
    aria-label="Bitcoin market price" data-testid="bitcoin-market">
    <div className="gys-market-pulse__top">
      <span className="gys-market-pulse__tag">
        <span className={'gys-market-pulse__dot'+(stale?' gys-market-pulse__dot--stale':'')} aria-hidden="true"/>
        BITCOIN MARKET
      </span>
      <div className="gys-market-pulse__switches" aria-label="Market currency">
        <button type="button" onClick={cycleCurrency} disabled={currencies.length<2}
          aria-label="Cycle preferred fiat currency">
          {currency}{currencies.length>1?' ↕':''}
        </button>
      </div>
    </div>
    <div className="gys-market-pulse__quote" aria-live="polite" aria-atomic="true">
      <span className="gys-market-pulse__price" data-testid="market-quote-price">{price}</span>
      <span className="gys-market-pulse__unit">for {unit.fullLabel}</span>
    </div>
    <div className="gys-market-pulse__denominations"
      role="group" aria-label="Scroll to choose Bitcoin amount for market price">
      {MARKET_QUOTE_UNITS.map(choice=><button key={choice.id} type="button"
        data-testid={'market-unit-'+choice.id}
        onClick={()=>chooseUnit(choice.id)}
        aria-pressed={quoteUnit===choice.id}
        title={'Show market value of '+choice.fullLabel}
      >{choice.label}</button>)}
    </div>
    <div className="gys-market-pulse__bottom">
      <span>{fetchedAt
        ?(stale?'Last known rate · ':'Updated ')+new Date(fetchedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
        :'Fetching Bitcoin price'} · Indicative only</span>
      <button type="button" onClick={()=>void refreshFiatData()} aria-label="Refresh Bitcoin price">
        ↻ Refresh
      </button>
    </div>
  </section>;
}
