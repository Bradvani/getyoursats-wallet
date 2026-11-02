import {usePresentation} from '@/hooks/usePresentation';
import {trustCopy} from '@/getyoursats/trustCopy';
import {PAYMENT_UX} from '@/locales/paymentUx';
import React from 'react';
import { CopyableRow, PrimaryButton, FormError } from '../../../components/ui';
import { useSheetBack } from '../../../components/ui/sheets/BottomSheetCardContext';
import { FeeBreakdownCard, SimpleFeeBreakdown } from '../../../components/FeeBreakdownCard';
import { SpinnerIcon } from '../../../components/Icons';
import { SatAmount } from '../../../components/SatAmount';
import PaymentFiatAmount from '../../../components/PaymentFiatAmount';
import { formatTokenAmount } from '../../../utils/tokenFormatting';
import { truncateAddress } from '../../../utils/crossChainFormat';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { useBalanceValidation } from '../hooks/useBalanceValidation';
import { toSats } from '../../../types/sats';
import type { ConversionEstimate } from '@breeztech/breez-sdk-spark';

export interface SendDestination {
  label: string;
  value: string;
}

export interface ConfirmStepProps {
  amountSats: bigint | null;
  feesSat: number | null;
  feesIncluded?: boolean;
  conversionEstimate?: ConversionEstimate | null;
  balanceSats?: number;
  tokenBalance?: bigint;
  /** Who the payment pays. Absent only when there is no prepared payment method
   *  to read it from, i.e. the prepare-failed render. */
  destination?: SendDestination;
  error: string | null;
  isLoading: boolean;
  /** Force the send action disabled regardless of the balance check, e.g. when
   *  prepare failed and there is no response to send. */
  disableConfirm?: boolean;
  onBack?: () => void;
  onConfirm: () => void;
}

const ConfirmStep: React.FC<ConfirmStepProps> = ({ amountSats, feesSat, feesIncluded, conversionEstimate, balanceSats, tokenBalance, destination, error, isLoading, disableConfirm, onBack, onConfirm }) => {
  const {language}=usePresentation();
  const text=trustCopy(language);
  const ux=PAYMENT_UX[language];
  const stableBalance = useStableBalance();
  const isTokenMode = stableBalance.isActive && !!stableBalance.displayConfig && !!conversionEstimate;
  const balance = useBalanceValidation(isTokenMode, undefined, balanceSats, tokenBalance);
  useSheetBack(isLoading ? undefined : onBack);

  const amount = Number(amountSats ?? 0n);
  const fee = feesSat ?? 0;
  const total = feesIncluded ? amount : amount + fee;
  // Missing fees are not a zero-fee quote. Require whole, nonnegative sats
  // and a positive recipient output before exposing a spend confirmation.
  const validQuote = amountSats !== null && toSats(amount) !== null && amount > 0
    && feesSat !== null && Number.isSafeInteger(feesSat) && feesSat >= 0
    && toSats(total) !== null && (!feesIncluded || amount > fee);

  // Convert the total to a validated Sats for the balance check. `total` is
  // sourced from a prepare response so in practice this never exceeds the
  // cap; if it somehow did, treat as insufficient funds.
  const totalSats = toSats(total);
  // The prepare-failed render has no fee and no conversion estimate to check
  // against, so the check reduces to "amount > sat balance" and reports
  // insufficient funds for a wallet holding its balance in a token. Skip it:
  // the prepare error is the one worth showing, and send is disabled anyway.
  const insufficientBalance = !disableConfirm && (totalSats === null
    ? true
    : balance.checkInsufficientFunds({ totalSats, conversionEstimate }));
  const balanceError = insufficientBalance ? ux.exceeds : null;

  // Token-formatted values from conversion estimate
  const tokenAmount = isTokenMode && balance.config
    ? formatTokenAmount(BigInt(conversionEstimate!.amountIn), balance.config)
    : null;
  const tokenFee = isTokenMode && balance.config
    ? formatTokenAmount(BigInt(conversionEstimate!.fee), balance.config, { fullPrecision: true })
    : null;

  return (
    <div className="space-y-6">
      {/* Total amount display — always show sats */}
      <div className="text-center py-4">
        <p className="text-spark-text-muted text-sm mb-2">{text.totalDeducted}</p>
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-4xl font-mono font-bold text-spark-text-primary">
            {validQuote ? <SatAmount sats={total} /> : <span>&mdash;</span>}
          </span>
        </div>
        {validQuote&&<PaymentFiatAmount sats={total} className="mt-2 text-base text-spark-text-secondary"/>}
      </div>

      {destination && (
        <CopyableRow
          label={destination.label}
          value={destination.value}
          display={truncateAddress(destination.value, 32)}
          data-testid="send-destination"
        />
      )}

      {/* Sats breakdown */}
      {validQuote ? <SimpleFeeBreakdown amount={feesIncluded ? amount - fee : amount} fee={fee} feeLabel={text.networkFee} totalLabel={ux.total} amountLabel={feesIncluded ? text.recipientReceives : ux.amount} /> : <FeeBreakdownCard items={[
        {label: ux.amount, pending: true},
        {label: text.networkFee, pending: true},
        {label: ux.total, pending: true},
      ]} />}

      {/* Token conversion details */}
      {isTokenMode && tokenAmount && tokenFee && (
        <FeeBreakdownCard
          useRawStrings
          items={[
            { label: ux.conversionAmount, value: tokenAmount },
            { label: ux.conversionFee, value: tokenFee },
          ]}
        />
      )}

      <FormError error={balanceError || error} />

      <PrimaryButton
        onClick={onConfirm}
        disabled={isLoading || !validQuote || insufficientBalance || disableConfirm}
        className="w-full"
        data-testid="send-confirm-button"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <SpinnerIcon size="md" />
            {ux.processing}
          </span>
        ) : (
          text.confirmSend
        )}
      </PrimaryButton>
    </div>
  );
};

export default ConfirmStep;
