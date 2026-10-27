import {useFlowText} from '@/hooks/useFlowText';
import {useEffect,useState} from 'react';
import {getDisplayFiatCurrency} from '../services/settings';
import {isFiatDenomination,type Denomination} from './denomination';
interface Props {value:Denomination;onChange:(next:Denomination)=>void;disabled?:boolean;inrAvailable?:boolean;fiatAvailable?:boolean}
export default function DenominationTabs({value,onChange,disabled=false,inrAvailable,fiatAvailable}:Props){
 const t=useFlowText();
 const [preferred,setPreferred]=useState(getDisplayFiatCurrency);
 useEffect(()=>{
  const sync=()=>setPreferred(getDisplayFiatCurrency());
  window.addEventListener('gys:fiat-pref-changed',sync);
  return()=>window.removeEventListener('gys:fiat-pref-changed',sync);
 },[]);
 const fiat=isFiatDenomination(value)?value:preferred;
 const available=fiatAvailable??inrAvailable??true;
 return <div className="gys-unit-switch" role="group" aria-label={t("Amount denomination")}>
  {(['sats','BTC',fiat] as const).map(unit=><button key={unit} type="button"
   aria-pressed={unit===value} disabled={disabled||(!available&&unit===fiat)}
   title={!available&&unit===fiat?t('Current {currency}/BTC quote unavailable',{currency:fiat}):undefined}
   onClick={()=>onChange(unit)}>{unit==='sats'?'丰 sats':unit}</button>)}
 </div>;
}
