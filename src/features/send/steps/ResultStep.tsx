import {useFlowText} from '@/hooks/useFlowText';
import LocalizedErrorText from '@/components/LocalizedErrorText';
import {trustCopy} from '@/getyoursats/trustCopy';
import {usePresentation} from '@/hooks/usePresentation';
import React, { type ReactNode } from 'react';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {displayPaymentAmount} from '@/getyoursats/paymentDisplay';
import { PrimaryButton } from '../../../components/ui';
import TransferProgress from '../../../components/TransferProgress';
import PaymentFiatAmount from '../../../components/PaymentFiatAmount';
import PaymentMotion from '../../../components/PaymentMotion';

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
  payment?: Payment|null;
}

const ResultStep: React.FC<ResultStepProps> = ({ result, error, onClose, operationType = 'payment', description, children, payment }) => {
  const t=useFlowText();
  const isSuccess = result === 'success';
  const {language}=usePresentation();
  const copy=trustCopy(language);

  const getTitle = () => {
    if (operationType === 'auth') {
      return t("Authenticated!");
    }
    if (operationType === 'refund') {
      return isSuccess ? t("Refund Sent!") : t("Refund Failed");
    }
    return isSuccess ? t("Payment Sent!") : t("Payment Failed");
  };

  const getSuccessDescription = () => {
    if (description) return description;
    if (operationType === 'refund') {
      return t("Your refund has been sent to the Bitcoin network.");
    }
    return t("Your payment has been successfully sent to the recipient.");
  };

  const getDefaultErrorMessage = () => {
    if (operationType === 'refund') {
      return t("There was an error processing your refund. Please try again.");
    }
    return t("There was an error processing your payment. Please try again.");
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

        <div className="text-spark-text-secondary text-center max-w-xs mb-8">
          {error ? <LocalizedErrorText message={error}/> : getDefaultErrorMessage()}
        </div>

        <PrimaryButton onClick={onClose} className="min-w-[200px]">
          {t("Close")}
        </PrimaryButton>
      </div>
    );
  }

  // Success: show icon, title, description, and done button
  return (
    <div className="gys-payment-stage" data-testid={isSuccess ? 'payment-success' : 'payment-failure'}>
      <PaymentMotion state="sent" animate={operationType==='payment'}
        settlementId={operationType==='payment' && payment?.status==='completed' && payment.paymentType==='send'?payment.id:undefined}/>
      {payment?.status==='completed'&&<div className="gys-payment-stage__amount" data-testid="sent-payment-amount">{displayPaymentAmount(payment)}<PaymentFiatAmount payment={payment} className="mt-2 text-base font-normal text-spark-text-secondary"/></div>}
      {operationType==='payment'&&payment?.status==='completed'&&<TransferProgress confirmed/>}

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
        {t("Done")}
      </PrimaryButton>
    </div>
  );
};

export default ResultStep;
