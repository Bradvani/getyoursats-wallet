import {getDisplayFiatCurrency} from '../services/settings';
/** Pure UI units. All Breez Lightning invoices and BTC sends still settle in sats. */
export type Denomination=string;
const STORAGE_KEY='gys:denomination:v1';
const validFiat=(code:string)=>/^[A-Z]{3}$/.test(code)&&code!=='BTC';
export const isFiatDenomination=(unit:Denomination)=>unit!=='sats'&&unit!=='BTC'&&validFiat(unit);
export const satoshiSymbol='丰';
export function currencyDecimals(code:string):number{
 try{return new Intl.NumberFormat('en',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits}
 catch{return 2}
}
export function getDenomination():Denomination{
 try{
  const value=localStorage.getItem(STORAGE_KEY);
  return value&&(value==='sats'||value==='BTC'||validFiat(value))?value:'sats';
 }catch{return 'sats'}
}
export function saveDenomination(unit:Denomination){
 if(unit!=='sats'&&unit!=='BTC'&&!validFiat(unit))throw Error('Invalid unit');
 try{localStorage.setItem(STORAGE_KEY,unit)}catch{/* optional preference */}
 if(typeof window!=='undefined')window.dispatchEvent(new Event('gys:currency-pref-changed'));
}
export function currentFiatUnit(unit:Denomination):string {
 return isFiatDenomination(unit)?unit:getDisplayFiatCurrency();
}
export function amountToSats(raw:string,unit:Denomination,fiatPerBtc?:number):number|null{
 const input=raw.trim();
 if(!input||!/^\d+(?:\.\d+)?$/.test(input))return null;
 if(unit!=='sats'&&unit!=='BTC'&&!validFiat(unit))return null;
 const decimals=unit==='sats'?0:unit==='BTC'?8:currencyDecimals(unit);
 if((input.split('.')[1]||'').length>decimals)return null;
 const value=Number(input);
 if(!Number.isFinite(value)||value<=0)return null;
 const sats=unit==='sats'?value:unit==='BTC'?Math.round(value*100_000_000):
  fiatPerBtc&&Number.isFinite(fiatPerBtc)&&fiatPerBtc>0?Math.round(value*100_000_000/fiatPerBtc):0;
 return Number.isSafeInteger(sats)&&sats>=1?sats:null;
}
export function satsToAmount(sats:number,unit:Denomination,fiatPerBtc?:number):string{
 if(!Number.isSafeInteger(sats)||sats<0)return '';
 if(unit==='sats')return String(sats);
 if(unit==='BTC')return (sats/100_000_000).toFixed(8).replace(/\.?0+$/,'');
 if(!validFiat(unit)||!fiatPerBtc||!Number.isFinite(fiatPerBtc)||fiatPerBtc<=0)return '';
 return ((sats/100_000_000)*fiatPerBtc).toFixed(currencyDecimals(unit));
}
