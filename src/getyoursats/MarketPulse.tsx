import {useState} from 'react';
import {useFiatData} from '../contexts/FiatDataContext';

/** Quotes come from the wallet's own Breez SDK fiat-rate feed (refreshed
 * every 60 seconds by FiatDataProvider). No independently polled API keys
 * or invented exchange/settlement rates. */
export default function MarketPulse() {
  const {fiatRates, fetchedAt, refreshFiatData} = useFiatData();
  const [currency, setCurrency] = useState<'INR'|'USD'>('INR');
  const [unit, setUnit] = useState<'BTC'|'sats'>('BTC');
  const rate = fiatRates.find(item => item.coin === currency)?.value;
  const validRate = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
  const stale = !fetchedAt || Date.now() - fetchedAt > 120_000;
  const money = (value: number, minDecimals: number, maxDecimals: number) =>
    new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency, minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
    }).format(value);
  const price = validRate !== null
    ? (unit === 'BTC' ? money(validRate, 0, 0) : money(validRate / 100_000, 2, 4))
    : 'Rate unavailable';

  return <section className="gys-market-pulse" aria-label="Bitcoin market price">
    <div className="gys-market-pulse__top">
      <span className="gys-market-pulse__tag">
        <span className={'gys-market-pulse__dot'+(stale?' gys-market-pulse__dot--stale':'')} aria-hidden="true"/>
        BTC MARKET RATE
      </span>
      <div className="gys-market-pulse__switches" aria-label="Market rate display">
        <button type="button" onClick={()=>setUnit(unit==='BTC'?'sats':'BTC')}
          aria-label={unit==='BTC'?'Show the local value of 1,000 sats':'Show Bitcoin price'}
          title="Switch BTC / sats">{unit==='BTC'?'1 BTC':'1,000 sats'} ↕</button>
        <button type="button" onClick={()=>setCurrency(currency==='INR'?'USD':'INR')}
          aria-label={currency==='INR'?'Show BTC price in USD':'Show BTC price in INR'}
          title="Switch local currency">{currency} ↕</button>
      </div>
    </div>
    <div className="gys-market-pulse__quote">
      <span className="gys-market-pulse__price">{price}</span>
      <span className="gys-market-pulse__unit">/ {unit==='BTC'?'BTC':'1k sats'}</span>
    </div>
    <div className="gys-market-pulse__bottom">
      <span>{fetchedAt
        ? (stale ? 'Last known rate · ' : 'Updated ') + new Date(fetchedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
        : 'Waiting for an SDK quote'} · Indicative, not a trade offer</span>
      <button type="button" onClick={()=>void refreshFiatData()} title="Refresh SDK market quote"
        aria-label="Refresh Bitcoin price">↻ Refresh</button>
    </div>
  </section>;
}
