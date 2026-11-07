import React from 'react';
import type { SendPaymentMethod, SendPaymentOptions, ConversionEstimate } from '@breeztech/breez-sdk-spark';
import ConfirmStep from '../steps/ConfirmStep';
import { getSendDestination } from '../utils';

interface SparkWorkflowProps {
  method: Extract<SendPaymentMethod, { type: 'sparkAddress' }>;
  amountSats: bigint;
  feesIncluded?: boolean;
  conversionEstimate?: ConversionEstimate | null;
  balanceSats?: number;
  tokenBalance?: bigint;
  recipient?: {label:string;value:string};
  isLoading?: boolean;
  onBack: () => void;
  onSend: (options?: SendPaymentOptions) => Promise<void>;
}

const SparkWorkflow: React.FC<SparkWorkflowProps> = ({ method, amountSats, feesIncluded, conversionEstimate, balanceSats, tokenBalance, recipient, isLoading=false, onBack, onSend }) => {
  const validFee=method.fee>=0n&&method.fee<=BigInt(Number.MAX_SAFE_INTEGER);
  const feesSat=validFee?Number(method.fee):null;
  const handleSend = () => onSend();
  return <ConfirmStep amountSats={amountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} destination={recipient??getSendDestination(method)} error={validFee?null:'Couldn’t get a quote'} disableConfirm={!validFee} isLoading={isLoading} onBack={onBack} onConfirm={handleSend} />;
};

export default SparkWorkflow;
