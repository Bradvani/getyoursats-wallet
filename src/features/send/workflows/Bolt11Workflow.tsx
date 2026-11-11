import {useWalletConnection} from '../../../contexts/WalletContext';
import {isRestrictedBrowserWallet} from '../../../security/browserReleasePolicy';
import React from 'react';
import type { SendPaymentMethod, ConversionEstimate } from '@breeztech/breez-sdk-spark';
import ConfirmStep from '../steps/ConfirmStep';
import { getSendDestination } from '../utils';

interface Bolt11WorkflowProps {
  method: Extract<SendPaymentMethod, { type: 'bolt11Invoice' }>;
  amountSats: bigint;
  feesIncluded?: boolean;
  conversionEstimate?: ConversionEstimate | null;
  balanceSats?: number;
  tokenBalance?: bigint;
  onBack: () => void;
  onSend: (options: { type: 'bolt11Invoice'; preferSpark: boolean }) => Promise<void>;
}

const Bolt11Workflow: React.FC<Bolt11WorkflowProps> = ({ method, amountSats, feesIncluded, conversionEstimate, balanceSats, tokenBalance, onBack, onSend }) => {
  const {sdk}=useWalletConnection();
  const requireLightning=!!sdk&&isRestrictedBrowserWallet(sdk);
  const handleSend = () => {
    const preferSpark = !requireLightning&&method.sparkTransferFeeSats != null;
    return onSend({ type: 'bolt11Invoice', preferSpark });
  };

  // Compute display fees from prepared response
  let feesSat: number | null = null;
  if (!requireLightning&&method.sparkTransferFeeSats != null) {
    feesSat = method.sparkTransferFeeSats;
  } else if (method.lightningFeeSats != null) {
    feesSat = method.lightningFeeSats;
  }

  return <ConfirmStep amountSats={amountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} destination={getSendDestination(method)} error={null} isLoading={false} onBack={onBack} onConfirm={handleSend} />;
};

export default Bolt11Workflow;
