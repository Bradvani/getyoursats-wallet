/** Display/input denominations, not separate custodial assets or settlement rails.
 * All actual Breez Lightning invoices and BTC sends settle in integer sats.
 */
export type Denomination = 'sats' | 'BTC' | 'INR';
const STORAGE_KEY='gys:denomination:v1';
const allowed=new Set<Denomination>(['sats','BTC','INR']);
export function getDenomination():Denomination{
  try{
    const value=window.localStorage.getItem(STORAGE_KEY) as Denomination|null;
    return value&&allowed.has(value)?value:'sats';
  }catch{return 'sats'}
}
export function saveDenomination(value:Denomination):void{
  if(!allowed.has(value))throw new Error('Invalid unit');
  try{window.localStorage.setItem(STORAGE_KEY,value)}catch{/* Private browsing */ }
}
export function amountToSats(raw:string, unit:Denomination, inrPerBtc?:number):number|null{
  const val=raw.trim();
  if(!val||!/^(?:\d+)(?:\.\d+)?$/.test(val))return null;
  const decimals=unit==='sats'?0:unit==='BTC'?8:2;
  const [,fraction='']=val.split('.');
  if(fraction.length>decimals)return null;
  const numeric=Number(val);
  if(!Number.isFinite(numeric)||numeric<=0)return null;
  let sats:number;
  if(unit==='sats')sats=numeric;
  else if(unit==='BTC')sats=Math.round(numeric*100_000_000);
  else {
    if(!inrPerBtc||!Number.isFinite(inrPerBtc)||inrPerBtc<=0)return null;
    sats=Math.round(numeric*100_000_000/inrPerBtc);
  }
  return Number.isSafeInteger(sats)&&sats>=1?sats:null;
}
export function satsToAmount(sats:number,unit:Denomination,inrPerBtc?:number):string{
  if(!Number.isSafeInteger(sats)||sats<0)return '';
  if(unit==='sats')return String(sats);
  if(unit==='BTC')return (sats/100_000_000).toFixed(8).replace(/\.?0+$/,'');
  if(!inrPerBtc||!Number.isFinite(inrPerBtc)||inrPerBtc<=0)return '';
  return ((sats/100_000_000)*inrPerBtc).toFixed(2);
}
