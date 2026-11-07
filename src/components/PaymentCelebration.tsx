import React, { useEffect, useState } from 'react';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { SatAmount } from './SatAmount';
import { useFiatData } from '../contexts/FiatDataContext';
import { getTokenAmountFromPayment, formatTokenAmount, buildTokenDisplayConfig, withAssetDecimals } from '../utils/tokenFormatting';
import {notifyPaymentFeedback} from '../utils/transferHaptics';
import TransferExperience from './TransferExperience';
import PaymentReceiptSummary from './PaymentReceiptSummary';
import PaymentFiatAmount from './PaymentFiatAmount';

interface PaymentCelebrationProps {
  payment: Payment;
  onClose: () => void;
}

const PaymentCelebration: React.FC<PaymentCelebrationProps> = ({ payment, onClose }) => {
  // Sends only reach here when the send sheet was dismissed mid-payment,
  // so this is the only report the user gets of the outcome.
  const isSent = payment.paymentType === 'send';
  const stableBalance = useStableBalance();
  const { fiatCurrencies } = useFiatData();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if(payment.status!=='completed')return;
    let frame=0;
    const show=()=>{
      cancelAnimationFrame(frame);
      if(document.visibilityState==='hidden')return;
      frame=requestAnimationFrame(()=>{
        setIsVisible(true);
        notifyPaymentFeedback('success',payment.id,payment.paymentType==='send'?'sent':'received');
      });
    };
    document.addEventListener('visibilitychange',show);show();
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',show);};
  },[payment.id,payment.status,payment.paymentType]);

  // Determine display: token amount or sats
  // Always show token denomination for token payments, even if stable balance is off
  let displayText: string | null = null;
  const tokenInfo = getTokenAmountFromPayment(payment);
  if (tokenInfo) {
    const base = stableBalance.displayConfig ?? buildTokenDisplayConfig(tokenInfo.metadata, fiatCurrencies);
    displayText = formatTokenAmount(tokenInfo.amount, withAssetDecimals(base, tokenInfo.metadata.decimals));
  }

  if(payment.status!=='completed')return null;

  if(!isVisible)return null;
  return <div data-testid={isSent?'payment-sent-moment':'payment-received-moment'}>
    <TransferExperience key={payment.id} operationId={payment.id} receiptId={payment.id}
      direction={isSent?'sent':'received'} phase="confirmed" onClose={onClose}
      amount={displayText ?? <SatAmount sats={payment.amount}/>}
      receipt={<PaymentReceiptSummary payment={payment}/>}
      fiatAmount={<PaymentFiatAmount payment={payment}/>}/>
  </div>;
};

export default PaymentCelebration;
