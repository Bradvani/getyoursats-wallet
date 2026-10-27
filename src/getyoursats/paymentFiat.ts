import {currencyDecimals} from './denomination';

/** Display only. Never use an indicative fiat value to prepare or execute a payment. */
export function formatPaymentFiat(sats:number|bigint,rate:number|undefined,currency:string,language:string):string|null {
 const amount=Number(sats);
 if(!Number.isSafeInteger(amount)||amount<0||!rate||!Number.isFinite(rate)||rate<=0||!/^[A-Z]{3}$/.test(currency)||currency==='BTC')return null;
 const value=amount/100_000_000*rate;
 if(!Number.isFinite(value))return null;
 const digits=currencyDecimals(currency);
 const locale=currency==='INR'&&['en','hi','ta'].includes(language)?`${language}-IN`:language;
 try {
  const format=new Intl.NumberFormat(locale,{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits});
  const minimum=10**-digits;
  // A positive transfer must never look like zero fiat after rounding.
  return value>0&&value<minimum?`< ${format.format(minimum)}`:format.format(value);
 }catch{return null;}
}
