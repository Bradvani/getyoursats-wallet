import {amountToSats,type Denomination} from './denomination';
export type DcaFrequency='daily'|'weekly'|'every-two-weeks';
export interface DcaDraft {
  denomination:Denomination;
  enteredAmount:string;
  estimatedSats:number;
  estimatedInr:number;
  frequency:DcaFrequency;
  createdAt:string;
  status:'draft';
}
const KEY='gys:dca-draft:v1';
export function validateDcaDraft(args:{
  amount:string;denomination:Denomination;frequency:DcaFrequency;inrPerBtc?:number;
}):{draft?:DcaDraft;error?:string}{
  const {amount,denomination,frequency,inrPerBtc}=args;
  const sats=amountToSats(amount,denomination,inrPerBtc);
  if(!sats)return {error:'Enter a positive amount using the selected unit and a current BTC/INR rate.'};
  if(!inrPerBtc||!Number.isFinite(inrPerBtc)||inrPerBtc<=0)return {error:'A current INR/BTC price is required to validate the ₹20 minimum.'};
  if(!['daily','weekly','every-two-weeks'].includes(frequency))return {error:'Choose a valid purchase interval.'};
  const inr=(sats/100_000_000)*inrPerBtc;
  if(!Number.isFinite(inr)||inr<20)return {error:'The minimum per-purchase amount is ₹20.'};
  return {draft:{denomination,enteredAmount:amount,estimatedSats:sats,estimatedInr:inr,
    frequency,createdAt:new Date().toISOString(),status:'draft'}};
}
export function saveDcaDraft(draft:DcaDraft):void{
  localStorage.setItem(KEY,JSON.stringify(draft));
}
export function loadDcaDraft():DcaDraft|null{
  try{
    const raw=localStorage.getItem(KEY);
    if(!raw)return null;
    const v=JSON.parse(raw) as DcaDraft;
    return v.status==='draft' && Number.isSafeInteger(v.estimatedSats) ? v : null;
  }catch{return null}
}
