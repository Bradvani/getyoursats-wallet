import {amountToSats,type Denomination} from './denomination';
export type DcaFrequency='daily'|'weekly'|'every-two-weeks';
export interface DcaDraft {
 denomination:Denomination;enteredAmount:string;estimatedSats:number;
 estimatedFiat:number;fiatCurrency:string;frequency:DcaFrequency;
 createdAt:string;status:'draft';
}
const KEY='gys:dca-draft:v1';
/** This is a local-only plan. No provider has confirmed a global minimum,
 * so a hard-coded rupee threshold would mislead users in other countries. */
export function validateDcaDraft(args:{
 amount:string;denomination:Denomination;frequency:DcaFrequency;
 fiatCurrency?:string;fiatPerBtc?:number;inrPerBtc?:number;
}):{draft?:DcaDraft;error?:string}{
 const fiatCurrency=args.fiatCurrency??'USD';
 const fiatPerBtc=args.fiatPerBtc??args.inrPerBtc;
 if(!fiatPerBtc||!Number.isFinite(fiatPerBtc)||fiatPerBtc<=0)
   return {error:'A live BTC/'+fiatCurrency+' quote is needed for this draft.'};
 const sats=amountToSats(args.amount,args.denomination,fiatPerBtc);
 if(!sats)return {error:'Enter an amount worth at least one satoshi.'};
 if(!['daily','weekly','every-two-weeks'].includes(args.frequency))
   return {error:'Choose a valid purchase interval.'};
 const estimatedFiat=(sats/100_000_000)*fiatPerBtc;
 if(!Number.isFinite(estimatedFiat)||estimatedFiat<=0)return {error:'Invalid conversion quote.'};
 return {draft:{denomination:args.denomination,enteredAmount:args.amount,estimatedSats:sats,
   estimatedFiat,fiatCurrency,frequency:args.frequency,createdAt:new Date().toISOString(),status:'draft'}};
}
export function saveDcaDraft(draft:DcaDraft):void{localStorage.setItem(KEY,JSON.stringify(draft))}
export function loadDcaDraft():DcaDraft|null{
 try{
  const raw=localStorage.getItem(KEY);if(!raw)return null;
  const v=JSON.parse(raw) as DcaDraft;
  return v.status==='draft'&&Number.isSafeInteger(v.estimatedSats)&&v.estimatedSats>0?v:null;
 }catch{return null}
}
