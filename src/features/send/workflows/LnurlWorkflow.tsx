import {validAmountInput} from '../../../utils/decimalInput';
import {usePresentation} from '@/hooks/usePresentation';
import {PAYMENT_UX} from '@/locales/paymentUx';
import {sendDestinationCopy} from '@/locales/sendDestination';
import type {PaymentExecutionResult} from '@/getyoursats/paymentOutcome';
import React, { useId, useMemo, useState } from 'react';
import type { LnurlPayRequestDetails, PrepareLnurlPayRequest, PrepareLnurlPayResponse } from '@breeztech/breez-sdk-spark';
import type { PaymentStep } from '../../../types/domain';
import { FormError, PrimaryButton, AMOUNT_FIELD_CLASS } from '../../../components/ui';
import { useSheetBack } from '../../../components/ui/sheets/BottomSheetCardContext';
import ConfirmStep from '../steps/ConfirmStep';
import { logger, LogCategory } from '@/services/logger';
import { SpinnerIcon } from '@/components/Icons';
import CurrencySwitcher from '../../../components/ui/CurrencySwitcher';
import { formatWithSpaces } from '../../../utils/formatNumber';
import { useAmountInput, useFiatOverride } from '../../../hooks/useAmountInput';
import { useBalanceValidation } from '../hooks/useBalanceValidation';
import { useHasPendingConversion } from '../../../contexts/WalletContext';
import { getLnurlPayAddress } from '../utils';

interface LnurlWorkflowProps {
  parsed: LnurlPayRequestDetails;
  recipientLabel?: string;
  balanceSats?: number;
  tokenBalance?: bigint;
  initialAmount?: string;
  initialFeesIncluded?: boolean;
  onBack: () => void;
  onRun: (runner: () => Promise<PaymentExecutionResult>, hasConversion?: boolean) => Promise<void>;
  onPrepare: (args: PrepareLnurlPayRequest) => Promise<PrepareLnurlPayResponse>;
  onPay: (prepareResponse: PrepareLnurlPayResponse) => Promise<PaymentExecutionResult>;
}

const LnurlWorkflow: React.FC<LnurlWorkflowProps> = ({ parsed, recipientLabel, balanceSats, tokenBalance, initialAmount='', initialFeesIncluded=false, onBack, onRun, onPrepare, onPay }) => {
  const {language}=usePresentation();
  const text=PAYMENT_UX[language];
  const recipientId=useId();
  const balanceKnown=balanceSats!==undefined;
  // USD as a secondary entry option on BTC sends (#253): starts in sats,
  // toggleable to USD, converted to sats client-side.
  const fiatOverride = useFiatOverride();
  const input = useAmountInput({ initialAmount, balanceSats, tokenBalance, fiatOverride });
  const {
    amountInput: amount,
    setAmount,
    setAmountInput,
    isTokenMode,
    setIsTokenMode,
    toggleDenomination,
    isStableBalanceActive,
    tokenIdentifier,
    tokenSymbol,
    config,
    tokenBalanceDisplay,
    formatSatsAsTokenDisplay,
    tokenSendAllBelowThreshold,
  } = input;

  const balance = useBalanceValidation(isTokenMode, setIsTokenMode, balanceSats, tokenBalance, fiatOverride);
  const hasPendingConversion = useHasPendingConversion();

  const [step, setStep] = useState<PaymentStep>('amount');
  const [feesIncluded, setFeesIncluded] = useState(initialFeesIncluded);
  const [comment, setComment] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [prepareResponse, setPrepareResponse] = useState<PrepareLnurlPayResponse | null>(null);

  // derive constraints
  const minSats = useMemo(() => {
    const msat = parsed.minSendable ?? 0;
    return Math.ceil(msat / 1000);
  }, [parsed]);
  const maxSats = useMemo(() => {
    const msat = parsed.maxSendable ?? 0;
    return Math.max(1, Math.floor(msat / 1000));
  }, [parsed]);
  const commentMaxLen = parsed.commentAllowed ?? 0;
  const commentAllowed = commentMaxLen > 0;
  const sendAllAmount = useMemo(() => {
    if (balanceSats !== undefined && balanceSats > 0) return Math.min(balanceSats, maxSats);
    return null;
  }, [balanceSats, maxSats]);

  const hasTokenBalance = tokenBalance !== undefined && tokenBalance > 0n;

  // BTC balance expressed in the token (fiat) display unit, capped at maxSats
  // (LNURL upper bound) and gated by minSats. Uses the hook helper for
  // conversion + sub-threshold handling.
  const sendAllBtcInTokenDisplay = useMemo(() => {
    if (balanceSats === undefined || balanceSats <= 0) return null;
    const cappedSats = Math.min(balanceSats, maxSats);
    if (cappedSats < minSats) return null;
    return formatSatsAsTokenDisplay(cappedSats);
  }, [balanceSats, maxSats, minSats, formatSatsAsTokenDisplay]);

  const isSendAllToken = isTokenMode && hasTokenBalance && amount === tokenBalanceDisplay && feesIncluded;
  const isSendAllBtcInTokenMode = isTokenMode
    && !hasTokenBalance
    && sendAllBtcInTokenDisplay !== null
    && amount === sendAllBtcInTokenDisplay
    && feesIncluded;

  const description = useMemo(() => {
    // metadataStr comes from a third-party LNURL-pay host, so it is
    // untrusted: an unguarded parse here throws during render, which
    // takes the whole tree down rather than failing this one payment.
    try {
      const metadataArr: unknown = JSON.parse(parsed.metadataStr);
      if (Array.isArray(metadataArr)) {
        for (const entry of metadataArr) {
          if (Array.isArray(entry) && entry[0] === 'text/plain') return entry[1];
        }
      }
    } catch {
      // Fall through to the URL.
    }
    return parsed.url;
  }, [parsed]);

  const handleToggleDenomination = () => {
    toggleDenomination();
    setFeesIncluded(false);
  };

  // setError is only called in onAmountNext, so step changes don't
  // need a clearing effect; the confirm-back handler clears inline.
  const onAmountNext = async () => {
    if (!validAmountInput(amount, isTokenMode ? (config?.fractionSize ?? 2) : 0)) return;
    if (!balanceKnown || hasPendingConversion) {setError(text.updating);return;}
    if (feesIncluded && !isSendAllToken && balance.exceedsBalance(Number(amount))) {setError(text.exceeds);return;}
    if (commentAllowed && commentMaxLen && comment.length > commentMaxLen) {
      setError(`${text.comment}: ${comment.length}/${commentMaxLen}`);
      return;
    }

    // Token send-all bypasses validation — amount goes directly as tokenBalance to the SDK
    if (isSendAllToken && tokenIdentifier && tokenBalance) {
      setIsLoading(true);
      setError(null);
      try {
        const resp = await onPrepare({
          amount: tokenBalance,
          comment: comment ? comment : undefined,
          payRequest: parsed,
          feePolicy: feesIncluded ? 'feesIncluded' : undefined,
          tokenIdentifier,
          conversionOptions: {
            conversionType: { type: 'toBitcoin', fromTokenIdentifier: tokenIdentifier },
          },
        });
        setPrepareResponse(resp);
        setStep('confirm');
      } catch (err) {
        logger.error(LogCategory.PAYMENT, 'Failed to prepare LNURL Pay', {
          error: err instanceof Error ? err.message : String(err),
        });
        setError(`Failed to prepare LNURL Pay: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // BTC send-all displayed in token mode — use the raw sats balance (capped
    // at maxSats) to avoid losing precision through fiat→sats round-tripping.
    if (isSendAllBtcInTokenMode && balanceSats !== undefined) {
      const cappedSats = Math.min(balanceSats, maxSats);
      setIsLoading(true);
      setError(null);
      try {
        const resp = await onPrepare({
          amount: BigInt(cappedSats),
          comment: comment ? comment : undefined,
          payRequest: parsed,
          feePolicy: 'feesIncluded',
        });
        setPrepareResponse(resp);
        setStep('confirm');
      } catch (err) {
        logger.error(LogCategory.PAYMENT, 'Failed to prepare LNURL Pay', {
          error: err instanceof Error ? err.message : String(err),
        });
        setError(`Failed to prepare LNURL Pay: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Validate input and balance
    const validationError = balance.validateAmount(amount, feesIncluded);
    if (validationError) {
      setError(validationError === 'Amount exceeds available balance' ? text.exceeds : validationError);
      return;
    }

    // Safe to parse — validateAmount already confirmed the input is valid
    const sats = balance.parseInputToSats(amount)!;

    // LNURL range constraints. Skipped for stable-balance token mode: the SDK
    // validates there, and conversion may adjust the amount. USD-toggle mode
    // (token mode without stable balance) computes exact sats, so check it.
    if (!isTokenMode || !isStableBalanceActive) {
      if (minSats && sats < minSats) {
        setError(`${text.recipientLimits}: ${formatWithSpaces(minSats)} … ${formatWithSpaces(maxSats)} sats`);
        return;
      }
      if (maxSats && sats > maxSats) {
        setError(`${text.recipientLimits}: ${formatWithSpaces(minSats)} … ${formatWithSpaces(maxSats)} sats`);
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    try {
      const resp = await onPrepare({
        amount: BigInt(sats),
        comment: comment ? comment : undefined,
        payRequest: parsed,
        feePolicy: feesIncluded ? 'feesIncluded' : undefined,
      });
      setPrepareResponse(resp);
      setStep('confirm');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to prepare LNURL Pay', {
        error: err instanceof Error ? err.message : String(err),
      });
      setError(`Failed to prepare LNURL Pay: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const onConfirm = async () => {
    if (!prepareResponse) return;
    await onRun(() => onPay(prepareResponse), !!prepareResponse.conversionEstimate);
  };

  const feesSat: number | null = useMemo(() => {
    return prepareResponse?.feeSats ?? null;
  }, [prepareResponse]);

  // Extract conversion estimate from prepare response if available
  const conversionEstimate = useMemo(() => {
    if (!prepareResponse?.conversionEstimate) return null;
    return prepareResponse.conversionEstimate;
  }, [prepareResponse]);

  // The confirm step's ConfirmStep lends its own.
  useSheetBack(step === 'amount' && !isLoading ? onBack : undefined);

  if (step === 'confirm' && prepareResponse) {
    const confirmAmountSats = isSendAllToken
      ? BigInt(prepareResponse.amountSats)
      : BigInt(balance.parseInputToSats(amount) || 0);
    return (
      <ConfirmStep amountSats={confirmAmountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} destination={{ label: text.recipient, value: getLnurlPayAddress(parsed) ?? parsed.domain }} error={error} isLoading={isLoading} onBack={() => { setPrepareResponse(null); setError(null); setStep('amount'); }} onConfirm={onConfirm} />
    );
  }

  const validAmount = validAmountInput(amount, isTokenMode ? (config?.fractionSize ?? 2) : 0);
  const amountNum = isTokenMode ? parseFloat(amount) || 0 : parseInt(amount) || 0;
  const isSendAllSats = !isStableBalanceActive && sendAllAmount !== null && amountNum === sendAllAmount && feesIncluded;
  const isSendAll = isSendAllSats || isSendAllToken || isSendAllBtcInTokenMode;

  // Inline balance error — surface "Amount exceeds available balance" as the
  // user types instead of waiting for Continue. Computed inline (not via
  // useMemo) because we're past the early-return for the confirm step and
  // can't add a Hook here without violating rules-of-hooks.
  const balanceBelowMinimum = balanceKnown && !hasTokenBalance && balanceSats < minSats;
  const inlineBalanceError = amountNum > 0 && !isSendAllToken && balance.exceedsBalance(amountNum)
    ? text.exceeds
    : null;

  // amount + optional comment form
  return (
    <div className="space-y-5">
      {/* Description */}
      <button type="button" onClick={onBack} disabled={isLoading}
        aria-label={sendDestinationCopy(language).edit} aria-describedby={recipientId} data-testid="edit-send-destination"
        className="w-full min-h-11 rounded-xl border border-spark-border bg-spark-dark p-3 text-start disabled:opacity-50">
        <span id={recipientId} className="block break-all text-spark-text-primary font-medium">{recipientLabel ?? description}</span>
        <span className="gys-send-edit-action mt-2 block text-sm text-spark-primary underline">{sendDestinationCopy(language).edit}</span>
      </button>

      <div id="lnurl-balance" role="status" aria-live="polite" className="flex items-center justify-between gap-3">
        <div id="lnurl-balance-description" className="min-w-0">
          <p className="text-xs text-spark-text-secondary">{text.available}</p>
          <p className="text-sm font-semibold text-spark-text-primary">
            <span data-testid="lnurl-available-balance">{balanceKnown ? <bdi dir="ltr">{formatWithSpaces(balanceSats)} sats</bdi> : text.balanceLoading}</span>
            <span className="ms-2 text-xs font-normal text-spark-text-muted">{text.beforeFees}</span>
          </p>
          {isStableBalanceActive && tokenBalanceDisplay && tokenSymbol && <p className="text-sm text-spark-text-primary"><bdi dir="ltr">{tokenBalanceDisplay} {tokenSymbol}</bdi></p>}
          {hasPendingConversion && <p className="text-xs text-spark-text-muted">{text.updating}</p>}
        </div>
          {(hasTokenBalance
            || sendAllBtcInTokenDisplay !== null
            || (sendAllAmount !== null && sendAllAmount >= minSats)) && (
            <button
              onClick={() => {
                if (!isTokenMode && sendAllAmount !== null) {
                  setAmountInput(String(sendAllAmount));
                } else if (hasTokenBalance && tokenBalanceDisplay) {
                  if (!isTokenMode) setIsTokenMode(true);
                  setAmountInput(tokenBalanceDisplay);
                } else if (sendAllBtcInTokenDisplay !== null) {
                  // In token mode without token balance, fill with BTC sats
                  // converted to fiat (capped at maxSats). Avoids dropping a
                  // raw sats integer into a fiat-denominated input.
                  setAmountInput(sendAllBtcInTokenDisplay);
                } else if (sendAllAmount !== null) {
                  setAmountInput(String(sendAllAmount));
                }
                setFeesIncluded(true);
              }}
              disabled={isLoading || !balanceKnown || tokenSendAllBelowThreshold || hasPendingConversion}
              title={hasPendingConversion ? text.updating : text.feesHint}
              aria-pressed={isSendAll}
              className="gys-send-max-action min-h-11 min-w-11 shrink-0 rounded-lg px-2 text-sm font-semibold text-spark-primary underline disabled:opacity-40"
            >
              {hasPendingConversion ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <SpinnerIcon size="xs" />
                  {text.max}
                </span>
              ) : text.max}
            </button>
          )}
      </div>
      {/* Amount input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="lnurl-amount" className="block text-sm font-medium text-spark-text-primary">
            {text.amount}
          </label>

        </div>
        <div className="relative">
          <input
            id="lnurl-amount"
            dir="ltr"
            aria-describedby="lnurl-balance-description lnurl-limits lnurl-fees"
            type={isTokenMode ? 'text' : 'number'}
            inputMode={isTokenMode ? 'decimal' : 'numeric'}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setFeesIncluded(false);
            }}
            placeholder={text.enterAmount}
            className={`${AMOUNT_FIELD_CLASS} pr-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
            disabled={isLoading}
            min={isTokenMode ? undefined : minSats}
            max={isTokenMode ? undefined : maxSats}
          />
          {tokenSymbol ? (
            <CurrencySwitcher
              isTokenMode={isTokenMode}
              tokenSymbol={tokenSymbol}
              onSwitch={handleToggleDenomination}
              disabled={isLoading}
            />
          ) : <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-spark-text-secondary" dir="ltr">sats</span>}
        </div>

        <p id="lnurl-limits" className="mt-2 text-xs text-spark-text-muted">{text.recipientLimits}: <bdi dir="ltr">{formatWithSpaces(minSats)} … {formatWithSpaces(maxSats)} sats</bdi></p>
        <p id="lnurl-fees" className="mt-1 text-xs text-spark-text-muted">{text.feesHint}</p>

      </div>

      {/* Optional comment */}
      {commentAllowed && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-spark-text-primary" htmlFor="lnurl-comment">{text.comment}</label>
            <span className="text-xs text-spark-text-secondary">{comment.length}/{commentMaxLen}</span>
          </div>
          <textarea
            id="lnurl-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={text.message}
            className={`${AMOUNT_FIELD_CLASS} resize-none`}
            rows={3}
            maxLength={commentMaxLen}
            disabled={isLoading}
          />
        </div>
      )}

      <FormError error={inlineBalanceError || (balanceBelowMinimum ? text.recipientBelow : null) || error} />

      <PrimaryButton onClick={onAmountNext} disabled={isLoading || !balanceKnown || hasPendingConversion || !validAmount || balanceBelowMinimum || !!inlineBalanceError} className="w-full">
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <SpinnerIcon />
            {text.processing}
          </span>
        ) : text.continue}
      </PrimaryButton>
    </div>
  );
};

export default LnurlWorkflow;
