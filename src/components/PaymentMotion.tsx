import './premiumMotion.css';
import {useRef} from 'react';
import {TransferBrandMark as TransferMark} from './Icons';
import TransferPulse from './TransferPulse';
import { TransferStateIcon, PaymentLightningTrailIcon } from './Icons';

export type PaymentMotionState = 'sending' | 'receiving' | 'converting' | 'sent' | 'received' | 'failed';

/**
 * GetYourSats Orange Lightning Flash.
 *
 * Pure presentation: SDK state comes from the caller. A CSS clock never
 * changes payment status, and a pending transfer never shows our success mark.
 */
export default function PaymentMotion({ state, compact = false, animate = true, settlementId }: { state: PaymentMotionState; compact?: boolean; animate?: boolean; settlementId?:string }) {
  const anchor=useRef<SVGSVGElement>(null);
  const pending = state === 'sending' || state === 'receiving' || state === 'converting';
  const success = state === 'sent' || state === 'received';
  if(!compact && state!=='failed'){
    const direction=state==='received'||state==='receiving'?'received':'sent';
    return <div className="gys-contour-slot" aria-hidden="true" data-motion-state={state}>
      <TransferMark ref={anchor} direction={direction} settled={success} animate={animate}/>
      {animate && (pending||settlementId) && <TransferPulse key={`${state}:${settlementId??'pending'}`} direction={direction}
        paymentId={settlementId??'pending'} anchor={anchor} pending={pending}/>}
    </div>;
  }
  return <><div aria-hidden="true" data-motion-state={state}
    className={`gys-transfer gys-transfer--${state} ${pending ? 'gys-transfer--pending' : ''} ${success ? 'gys-transfer--success' : ''} ${compact ? 'gys-transfer--compact' : ''} ${!animate ? 'gys-transfer--static' : ''}`}>
    <span className="gys-transfer__glow" />
    <span className="gys-transfer__orbit" />
    <PaymentLightningTrailIcon />
    <span className="gys-transfer__core">
      {success
        ? <img className="gys-transfer__mark" src="/brand/monogram.svg" alt="" />
        : <TransferStateIcon state={state} />}
      {success && <span className="gys-transfer__seal">✓</span>}
    </span>
    <i className="gys-transfer__particle" />
  </div>
  </>;
}
