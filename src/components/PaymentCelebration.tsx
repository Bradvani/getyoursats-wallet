import React, { useEffect, useRef, useState } from 'react';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { SatAmount } from './SatAmount';
import { useFiatData } from '../contexts/FiatDataContext';
import { getTokenAmountFromPayment, formatTokenAmount, buildTokenDisplayConfig, withAssetDecimals } from '../utils/tokenFormatting';
import {notifyPaymentFeedback} from '../utils/transferHaptics';
import TransferExperience from './TransferExperience';
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

  // The SDK owns settlement. This timer only closes the presentation.
  // Hold it while a PWA tab is hidden so a backgrounded receive isn't
  // silently consumed before the user returns to their wallet.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if(payment.status!=='completed')return;
    let revealFrame: number | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;

    const clearPresentationTimers = () => {
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
      clearTimeout(closeTimer);
      clearTimeout(exitTimer);
    };
    const showWhenVisible = () => {
      clearPresentationTimers();
      if (document.visibilityState === 'hidden') return;
      setIsVisible(false);
      revealFrame = requestAnimationFrame(() => {
        setIsVisible(true);
        notifyPaymentFeedback('success',payment.id);
      });
      closeTimer = setTimeout(() => {
        setIsVisible(false);
        exitTimer = setTimeout(() => onCloseRef.current(), 350);
      }, 8000);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearPresentationTimers();
      } else {
        showWhenVisible();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    showWhenVisible();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearPresentationTimers();
    };
  }, [payment.id,payment.status]);

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
      fiatAmount={<PaymentFiatAmount payment={payment}/>}/>
  </div>;
};

export default PaymentCelebration;
