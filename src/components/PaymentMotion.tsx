import './premiumMotion.css';
import { TransferStateIcon } from './Icons';
export type PaymentMotionState = 'sending' | 'receiving' | 'converting' | 'sent' | 'received' | 'failed';
/** Visual only. The caller owns the actual SDK state; time never implies success. */
export default function PaymentMotion({ state, compact = false }: { state: PaymentMotionState; compact?: boolean }) {
  const pending = state === 'sending' || state === 'receiving' || state === 'converting';
  return <div aria-hidden="true" data-motion-state={state} className={`gys-transfer gys-transfer--${state} ${pending ? 'gys-transfer--pending' : ''} ${compact ? 'gys-transfer--compact' : ''}`}>
    <span className="gys-transfer__orbit" />
    <span className="gys-transfer__core">
      <TransferStateIcon state={state} />
    </span>
    <i className="gys-transfer__particle" />
  </div>;
}
