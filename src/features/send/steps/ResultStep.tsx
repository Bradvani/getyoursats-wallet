import {trustCopy} from '@/getyoursats/trustCopy';
import {usePresentation} from '@/hooks/usePresentation';
import {PAYMENT_EXPERIENCE} from '../../../locales/paymentExperience';
import React, { useEffect, type ReactNode } from 'react';
import { PrimaryButton } from '../../../components/ui';
import PaymentMotion from '../../../components/PaymentMotion';
import { hapticLight } from '@/utils/haptics';

export interface ResultStepProps {
  result: 'success' | 'failure' | 'unknown';
  error: string | null;
  onClose: () => void;
  /** Operation type to customize messaging (default: 'payment') */
  operationType?: 'payment' | 'auth' | 'refund';
  /** Replaces the operation's default success line. */
  description?: string;
  /** Shown on success between the description and Done, e.g. a transaction ID. */
  children?: ReactNode;
}

const ResultStep: React.FC<ResultStepProps> = ({ result, error, onClose, operationType = 'payment', description, children }) => {
  const isSuccess = result === 'success';
  const {language}=usePresentation();
  const copy=trustCopy(language);
  const text=PAYMENT_EXPERIENCE[language];

  useEffect(() => {
    if (isSuccess) {
      void hapticLight();

    }
  }, [isSuccess]);

  const getTitle = () => {
    if (operationType === 'auth') {
      return isSuccess ? text.authenticated : text.authFailed;
    }
    if (operationType === 'refund') {
      return isSuccess ? text.refundSent : text.refundFailed;
    }
    return isSuccess ? text.sent : text.failed;
  };

  const getSuccessDescription = () => {
    if (description) return description;
    if (operationType === 'refund') {
      return text.refundBody;
    }
    return operationType === 'auth' ? text.authBody : text.sentBody;
  };

  const getDefaultErrorMessage = () => {
    return operationType === 'auth' ? text.authFailedBody : text.failedBody;
  };

  if(result==='unknown') return <div className="gys-payment-stage" data-testid="payment-unknown" role="status">
    <h3 className="font-display text-2xl font-bold text-spark-text-primary">{copy.unknownTitle}</h3>
    <p className="text-sm text-spark-text-secondary leading-relaxed">{copy.unknownBody}</p>
    <PrimaryButton onClick={onClose} className="w-full">{copy.close}</PrimaryButton>
  </div>;
  if (!isSuccess) {
    // Payment failure: circular error icon with glow
    return (
      <div className="gys-payment-stage" data-testid="payment-failure">
        <PaymentMotion state="failed" />

        <h3 className="font-display text-2xl font-bold mb-2 text-spark-primary">
          {getTitle()}
        </h3>

        <p className="text-spark-text-secondary text-center max-w-xs mb-8">
          {getDefaultErrorMessage()}
        </p>
        {error && <details className="w-full text-sm mb-4 break-words">
          <summary>{text.errorDetails}</summary>
          <p dir="auto">{error}</p>
        </details>}

        <PrimaryButton onClick={onClose} className="min-w-[200px]">
          {copy.close}
        </PrimaryButton>
      </div>
    );
  }

  // Success: show icon, title, description, and done button
  return (
    <div className="gys-payment-stage" data-testid={isSuccess ? 'payment-success' : 'payment-failure'}>
      <PaymentMotion state="sent" />

      {/* Title */}
      <h3 className="font-display text-2xl font-bold mb-2 text-spark-primary">
        {getTitle()}
      </h3>

      {/* Description */}
      <p className="text-spark-text-secondary text-center max-w-xs mb-8">
        {getSuccessDescription()}
      </p>

      {children && <div className="w-full mb-8">{children}</div>}

      {/* Action button */}
      <PrimaryButton onClick={onClose} className="min-w-[200px]">
        {text.done}
      </PrimaryButton>
    </div>
  );
};

export default ResultStep;
