import type {Denomination} from './denomination';
interface Props {value:Denomination;onChange:(next:Denomination)=>void;disabled?:boolean;inrAvailable?:boolean}
export default function DenominationTabs({value,onChange,disabled=false,inrAvailable=true}:Props){
  return <div className="gys-unit-switch" role="group" aria-label="Amount denomination">
    {(['sats','BTC','INR'] as const).map(unit=><button key={unit} type="button"
      aria-pressed={unit===value} disabled={disabled||(!inrAvailable&&unit==='INR')}
      title={!inrAvailable&&unit==='INR'?'Current INR/BTC rate unavailable':undefined}
      onClick={()=>onChange(unit)}>{unit}</button>)}
  </div>;
}
