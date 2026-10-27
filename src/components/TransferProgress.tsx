import {usePresentation} from '../hooks/usePresentation';
import {TRANSFER_FEEDBACK} from '../locales/transferFeedback';
/** There is no numeric payment-progress field in the SDK. Never animate a fictitious percentage. */
export default function TransferProgress({confirmed=false}:{confirmed?:boolean}){
 const {language}=usePresentation();const copy=TRANSFER_FEEDBACK[language];
 return <div className={`gys-transfer-progress ${confirmed?'gys-transfer-progress--complete':''}`}>
  <div role="progressbar" aria-label={copy.waiting} aria-valuemin={0} aria-valuemax={100}
   aria-valuenow={confirmed?100:undefined} aria-valuetext={confirmed?copy.confirmed:copy.waiting}>
   {confirmed?<strong>100%</strong>:<span>{copy.waiting}</span>}
   <div className="gys-transfer-progress__line"/>
  </div>
  {!confirmed&&<small>{copy.noPercentage}</small>}
 </div>;
}
