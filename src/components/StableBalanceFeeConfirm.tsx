import {DialogContainer,DialogCard} from './ui';
import {SpinnerIcon} from './Icons';
import {formatTokenAmount,type TokenDisplayConfig} from '../utils/tokenFormatting';
import type {ConversionEstimate} from '@breeztech/breez-sdk-spark';
import {usePresentation} from '../hooks/usePresentation';
import {STABLE_BALANCE_COPY} from '../locales/stableBalance';
interface Props{
 isOpen:boolean;direction:'toToken'|'toBitcoin';conversionEstimate:ConversionEstimate|null;displayConfig:TokenDisplayConfig|null;
 isEstimating:boolean;isExecuting:boolean;error:string|null;info:string|null;canConfirm:boolean;onConfirm:()=>void;onCancel:()=>void;onRefresh:()=>void;
}
export default function StableBalanceFeeConfirm({isOpen,direction,conversionEstimate,displayConfig,isEstimating,isExecuting,error,info,canConfirm,onConfirm,onCancel,onRefresh}:Props){
 const {language}=usePresentation();const copy=STABLE_BALANCE_COPY[language];
 if(!isOpen)return null;
 const fee=conversionEstimate&&displayConfig?formatTokenAmount(conversionEstimate.fee,displayConfig,{fullPrecision:true}):null;
 return <DialogContainer><DialogCard maxWidth="sm"><div className="space-y-4 max-h-[calc(100dvh-160px)] overflow-y-auto overscroll-contain" data-testid="stable-mode-review">
  <h3 className="font-display text-lg font-bold text-spark-text-primary">{direction==='toToken'?copy.toStable:copy.toBitcoin}</h3>
  <p className="text-sm leading-relaxed text-spark-text-secondary">{copy.cost}</p>
  {isEstimating&&<div className="flex justify-center py-5" role="status"><SpinnerIcon size="lg"/></div>}
  {!isEstimating&&fee&&<div className="rounded-xl border border-spark-border p-4 space-y-2"><p className="text-sm text-spark-text-secondary">{copy.fee}</p><p className="font-mono text-lg text-spark-text-primary">{fee}</p><p className="text-xs leading-relaxed text-spark-text-muted">{copy.quoteNote}</p></div>}
  {!isEstimating&&info&&<p className="text-sm leading-relaxed text-spark-text-secondary">{info}</p>}
  {error&&<p role="alert" className="text-sm leading-relaxed text-spark-warning">{error}</p>}
  {!isEstimating&&!canConfirm&&!isExecuting&&<button type="button" onClick={onRefresh} className="min-h-11 text-sm text-spark-primary underline">{copy.review}</button>}
  <div className="flex gap-3"><button type="button" onClick={onCancel} disabled={isExecuting} className="flex-1 min-h-11 rounded-xl border border-spark-border text-sm text-spark-text-secondary disabled:opacity-40">{copy.cancel}</button>
   <button type="button" onClick={onConfirm} disabled={isEstimating||isExecuting||!!error||!canConfirm} className="button flex-1 min-h-11 text-sm disabled:opacity-40">{isExecuting?<SpinnerIcon size="md"/>:copy.confirm}</button></div>
 </div></DialogCard></DialogContainer>;
}
