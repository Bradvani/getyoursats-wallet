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
  // The prepared SDK quote is authoritative. Missing or malformed fees must
  // not appear as a free transfer, even when the expected Spark fee is zero.
  const validFee = typeof method.fee === 'bigint' && method.fee >= 0n && method.fee <= BigInt(Number.MAX_SAFE_INTEGER);
  const feesSat = validFee ? Number(method.fee) : null;
  const error = validFee ? null : 'The transfer fee could not be verified. Go back and request a new quote.';
  const handleSend = () => onSend();
  return <ConfirmStep amountSats={amountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} destination={getSendDestination(method)} error={error} disableConfirm={!validFee} isLoading={false} onBack={onBack} onConfirm={handleSend} />;
};

export default SparkWorkflow;
