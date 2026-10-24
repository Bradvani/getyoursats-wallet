import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { SatAmount } from './SatAmount';
import { useFiatData } from '../contexts/FiatDataContext';
import { getTokenAmountFromPayment, formatTokenAmount, buildTokenDisplayConfig, withAssetDecimals } from '../utils/tokenFormatting';
import PaymentMotion from './PaymentMotion';
import { hapticLight } from '@/utils/haptics';

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
    let revealFrame: number | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let hapticPlayed = false;

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
        if (!hapticPlayed) {
          hapticPlayed = true;
          void hapticLight();
        }
      });
      closeTimer = setTimeout(() => {
        setIsVisible(false);
        exitTimer = setTimeout(() => onCloseRef.current(), 350);
      }, 5200);
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
  }, [payment.id]);

  // Determine display: token amount or sats
  // Always show token denomination for token payments, even if stable balance is off
  let displayText: string | null = null;
  const tokenInfo = getTokenAmountFromPayment(payment);
  if (tokenInfo) {
    const base = stableBalance.displayConfig ?? buildTokenDisplayConfig(tokenInfo.metadata, fiatCurrencies);
    displayText = formatTokenAmount(tokenInfo.amount, withAssetDecimals(base, tokenInfo.metadata.decimals));
  }

  return createPortal(
    <div
      data-testid={isSent ? 'payment-sent-moment' : 'payment-received-moment'}
      className={`gys-moment fixed inset-0 z-100 flex items-center justify-center transition-all duration-500 motion-reduce:transition-none ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      role="status" aria-live="polite" aria-atomic="true"
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-spark-void/95 backdrop-blur-sm" />

      {/* Main content */}
      <div
        className={`relative z-10 flex flex-col items-center transform transition-all duration-500 motion-reduce:transition-none motion-reduce:transform-none ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-50 translate-y-20'
        }`}
      >
        <PaymentMotion state={isSent ? 'sent' : 'received'} />

        {/* Title */}
        <h2 className="gys-moment__title text-2xl font-display font-bold text-spark-text-primary mb-2">
          {isSent ? 'Payment Sent' : 'Payment Received'}
        </h2>

        <p className="text-sm text-spark-text-secondary mb-5">
          {isSent ? 'Confirmed by your wallet' : 'Sats confirmed in your wallet'}
        </p>

        {/* Exact SDK amount, displayed with a visual arrival rather than a misleading simulated count. */}
        <div data-testid="payment-moment-amount" className="gys-moment__amount relative text-center">
          <div className="absolute inset-0 blur-2xl rounded-full" style={{ background: 'rgba(247,147,26,0.25)' }} />
          {displayText ? (
            <span className="relative text-5xl font-display font-bold text-spark-primary">
              {isSent ? '-' : '+'}{(() => {
                const match = displayText.match(/^([^\d-]+)(.*)/);
                if (match) return <><span className="text-3xl opacity-70">{match[1]}</span>{match[2]}</>;
                return displayText;
              })()}
            </span>
          ) : (
            <span className="relative inline-flex items-center gap-1 text-5xl font-mono font-bold text-spark-primary">
              {isSent && '-'}
              <SatAmount sats={Number(payment.amount)} />
            </span>
          )}
        </div>

        <button type="button" className="gys-payment-done mt-10" onClick={onClose}>
          Done
        </button>
      </div>
    </div>,
    document.body
  );
};

export default PaymentCelebration;
