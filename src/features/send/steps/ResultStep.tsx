import {trustCopy} from '@/getyoursats/trustCopy';
import {usePresentation} from '@/hooks/usePresentation';
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

  useEffect(() => {
    if (isSuccess) {
      void hapticLight();

    }
  }, [isSuccess]);

  const getTitle = () => {
    if (operationType === 'auth') {
      return 'Authenticated!';
    }
    if (operationType === 'refund') {
      return isSuccess ? 'Refund Sent!' : 'Refund Failed';
    }
    return isSuccess ? 'Payment Sent!' : 'Payment Failed';
  };

  const getSuccessDescription = () => {
    if (description) return description;
    if (operationType === 'refund') {
      return 'Your refund has been sent to the Bitcoin network.';
    }
    return 'Your payment has been successfully sent to the recipient.';
  };

  const getDefaultErrorMessage = () => {
    if (operationType === 'refund') {
      return 'There was an error processing your refund. Please try again.';
    }
    return 'There was an error processing your payment. Please try again.';
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
          {error || getDefaultErrorMessage()}
        </p>

        <PrimaryButton onClick={onClose} className="min-w-[200px]">
          Close
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
        Done
      </PrimaryButton>
    </div>
  );
};

export default ResultStep;
