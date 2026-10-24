import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Payment } from '@breeztech/breez-sdk-spark';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { SatAmount } from './SatAmount';
import { useFiatData } from '../contexts/FiatDataContext';
import { getTokenAmountFromPayment, formatTokenAmount, buildTokenDisplayConfig, withAssetDecimals } from '../utils/tokenFormatting';
import './premiumMotion.css';
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

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => setIsVisible(true));
    void hapticLight();

    // Start dot animation after the logo settles in

    // Auto close after animation
    const closeTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 500);
    }, 4000);

    return () => {
      clearTimeout(closeTimer);
    };
  }, [onClose]);

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
      className={`fixed inset-0 z-100 flex items-center justify-center transition-all duration-500 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={() => {
        setIsVisible(false);
        setTimeout(onClose, 500);
      }}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-spark-void/90 backdrop-blur-md" />

      {/* Main content */}
      <div
        className={`relative z-10 flex flex-col items-center transform transition-all duration-700 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-50 translate-y-20'
        }`}
      >
        <div className={`gys-payment-motion ${isSent ? 'gys-payment-motion--sent' : 'gys-payment-motion--received'} mb-8 w-28 h-28 rounded-full border border-[#F7931A]/40 bg-[#17110b] flex items-center justify-center`}>
          <span className="gys-payment-motion__bolt" aria-hidden="true">{isSent ? '↗' : '↙'}</span>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-display font-bold text-spark-text-primary mb-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          {isSent ? 'Payment Sent' : 'Payment Received'}
        </h2>

        {/* Amount with brand glow */}
        <div className="relative animate-fade-in-up text-center" style={{ animationDelay: '0.4s' }}>
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

        {/* Tap to dismiss hint */}
        <p className="mt-10 text-spark-text-muted text-sm animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
          Tap anywhere to dismiss
        </p>
      </div>
    </div>,
    document.body
  );
};

export default PaymentCelebration;
