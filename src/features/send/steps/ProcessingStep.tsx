import {useFlowText} from '@/hooks/useFlowText';
import type { ProcessingPhase } from '../hooks/useSendPayment';
import TransferProgress from '../../../components/TransferProgress';
import PaymentMotion from '../../../components/PaymentMotion';
export interface ProcessingStepProps { operationType?: 'payment' | 'withdraw'; processingPhase?: ProcessingPhase }
export default function ProcessingStep({ operationType = 'payment', processingPhase = 'sending' }: ProcessingStepProps) {
  const t=useFlowText();
  const state = operationType === 'withdraw' ? 'receiving' : processingPhase === 'converting' ? 'converting' : 'sending';
  return <div className="gys-payment-stage" role="status" aria-live="polite" aria-busy="true">
    <PaymentMotion state={state} />
    <TransferProgress/>
    <span className="gys-overline">{state === 'converting' ? t("Preparing your transfer") : t("Bitcoin in motion")}</span>
    <h3>{state === 'receiving' ? t("Waiting for payment…") : state === 'converting' ? t("Converting…") : t("Sending…")}</h3>
    <p>{state === 'receiving' ? t("Waiting for confirmation from the payment network.") : state === 'converting' ? t("Converting the amount before your payment is sent.") : t("Your payment is processing. We’ll show the result when the network responds.")}</p>
    <span className="gys-payment-stage__note">{t("Check your activity before attempting another payment.")}</span>
  </div>;
}
