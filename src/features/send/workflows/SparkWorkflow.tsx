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
  onBack: () => void;
  onSend: (options?: SendPaymentOptions) => Promise<void>;
}

const SparkWorkflow: React.FC<SparkWorkflowProps> = ({ method, amountSats, feesIncluded, conversionEstimate, balanceSats, tokenBalance, onBack, onSend }) => {
  // Use the SDK quote; absence must never be interpreted as a free transfer.
  const feesSat = typeof method.fee === 'bigint' && method.fee >= 0n
    && method.fee <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(method.fee) : null;
  const handleSend = () => onSend();
  return <ConfirmStep amountSats={amountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} destination={getSendDestination(method)} error={null} isLoading={false} onBack={onBack} onConfirm={handleSend} />;
};

export default SparkWorkflow;
