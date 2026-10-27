import type { ProcessingPhase } from '../hooks/useSendPayment';
import TransferProgress from '../../../components/TransferProgress';
import PaymentMotion from '../../../components/PaymentMotion';
export interface ProcessingStepProps { operationType?: 'payment' | 'withdraw'; processingPhase?: ProcessingPhase }
export default function ProcessingStep({ operationType = 'payment', processingPhase = 'sending' }: ProcessingStepProps) {
  const state = operationType === 'withdraw' ? 'receiving' : processingPhase === 'converting' ? 'converting' : 'sending';
  return <div className="gys-payment-stage" role="status" aria-live="polite" aria-busy="true">
    <PaymentMotion state={state} />
    <TransferProgress/>
    <span className="gys-overline">{state === 'converting' ? 'Preparing your transfer' : 'Bitcoin in motion'}</span>
    <h3>{state === 'receiving' ? 'Waiting for payment…' : state === 'converting' ? 'Converting…' : 'Sending…'}</h3>
    <p>{state === 'receiving' ? 'Waiting for confirmation from the payment network.' : state === 'converting' ? 'Converting the amount before your payment is sent.' : 'Your payment is processing. We’ll show the result when the network responds.'}</p>
    <span className="gys-payment-stage__note">Check your activity before attempting another payment.</span>
  </div>;
}
