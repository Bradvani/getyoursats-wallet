import './premiumMotion.css';
import { TransferStateIcon, PaymentLightningTrailIcon } from './Icons';

export type PaymentMotionState = 'sending' | 'receiving' | 'converting' | 'sent' | 'received' | 'failed';

/**
 * GetYourSats Orange Lightning Flash.
 *
 * Pure presentation: SDK state comes from the caller. A CSS clock never
 * changes payment status, and a pending transfer never shows our success mark.
 */
export default function PaymentMotion({ state, compact = false, animate = true }: { state: PaymentMotionState; compact?: boolean; animate?: boolean }) {
  const pending = state === 'sending' || state === 'receiving' || state === 'converting';
  const success = state === 'sent' || state === 'received';
  return <div aria-hidden="true" data-motion-state={state}
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
  </div>;
}
