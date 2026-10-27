import {useEffect,useState} from 'react';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {useFiatData} from '../contexts/FiatDataContext';
import {usePresentation} from '../hooks/usePresentation';
import {getDisplayFiatCurrency} from '../services/settings';
import {getTokenAmountFromPayment} from '../utils/tokenFormatting';
import {formatPaymentFiat} from '../getyoursats/paymentFiat';
import {PAYMENT_FIAT_COPY} from '../locales/paymentFiat';

type Props={sats?:number|bigint;payment?:Payment;className?:string};
/** Uses this device's selected fiat, never the sender's currency or an invented USD fallback. */
export default function PaymentFiatAmount({sats,payment,className=''}:Props){
 const {fiatRates=[],fetchedAt}=useFiatData();
 const {language}=usePresentation();
 const [currency,setCurrency]=useState(getDisplayFiatCurrency);
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  const sync=()=>{setCurrency(getDisplayFiatCurrency());setNow(Date.now());};
  window.addEventListener('gys:fiat-pref-changed',sync);
  document.addEventListener('visibilitychange',sync);
  const timer=window.setInterval(()=>setNow(Date.now()),30000);
  return()=>{window.removeEventListener('gys:fiat-pref-changed',sync);document.removeEventListener('visibilitychange',sync);window.clearInterval(timer);};
 },[]);
 // Token base units are not satoshis. Preserve their existing denomination;
 // do not invent a BTC conversion or assume a stablecoin's market peg.
 if(payment&&getTokenAmountFromPayment(payment))return null;
 const amount=payment?.amount??sats;
 if(amount===undefined||!Number.isSafeInteger(Number(amount))||Number(amount)<0)return null;
 const fresh=!!fetchedAt&&now-fetchedAt<=120000;
 const rate=fresh?fiatRates.find(item=>item.coin===currency)?.value:undefined;
 const formatted=formatPaymentFiat(amount,rate,currency,language);
 return <div className={className} data-testid="payment-fiat-amount" data-currency={currency} data-rate-available={formatted!==null}>
  <bdi>{formatted?`≈ ${formatted} ${currency}`:`${currency} · ${PAYMENT_FIAT_COPY[language]}`}</bdi>
 </div>;
}
