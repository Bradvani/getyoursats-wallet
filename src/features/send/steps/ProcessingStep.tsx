import type { ProcessingPhase } from '../hooks/useSendPayment';
import PaymentMotion from '../../../components/PaymentMotion';
import {usePresentation} from '../../../hooks/usePresentation';
import {PAYMENT_EXPERIENCE} from '../../../locales/paymentExperience';
export interface ProcessingStepProps { operationType?: 'payment' | 'withdraw'; processingPhase?: ProcessingPhase }
export default function ProcessingStep({ operationType = 'payment', processingPhase = 'sending' }: ProcessingStepProps) {
  const {language} = usePresentation();
  const text = PAYMENT_EXPERIENCE[language];
  const state = operationType === 'withdraw' ? 'receiving' : processingPhase === 'converting' ? 'converting' : 'sending';
  return <div className="gys-payment-stage" role="status" aria-live="polite" aria-busy="true">
    <PaymentMotion state={state} />
    <span className="gys-overline">{text.preparing}</span>
    <h3>{text[state]}</h3>
    <p>{state === 'receiving' ? text.receivingBody : state === 'converting' ? text.convertingBody : text.sendingBody}</p>
    <span className="gys-payment-stage__note">{text.checkActivity}</span>
  </div>;
}
