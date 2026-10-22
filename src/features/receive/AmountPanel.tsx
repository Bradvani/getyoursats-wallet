import {useFiatData} from '../../contexts/FiatDataContext';
import DenominationTabs from '../../getyoursats/DenominationTabs';
import {amountToSats,getDenomination,saveDenomination,satsToAmount,type Denomination} from '../../getyoursats/denomination';
import React, { useRef, useEffect, useMemo } from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import {
  FormError,
  PrimaryButton,
  BottomSheetContainer,
  BottomSheetCard,
  DialogHeader,
  AMOUNT_FIELD_CLASS,
} from '../../components/ui';
import { LightningBoltIcon } from '../../components/Icons';
import { fixedQuickAmounts, formatQuickAmount, formatTokenInput } from '../../utils/tokenFormatting';
import CurrencySwitcher from '../../components/ui/CurrencySwitcher';
import { SatAmount } from '../../components/SatAmount';
import { useAmountInput, useFiatOverride } from '../../hooks/useAmountInput';
import { getDisplayFiatCurrency } from '../../services/settings';
import type { Sats } from '../../types/sats';
import { dismissKeyboard } from '../../utils/keyboard';
import { LIGHTNING_INVOICE_MIN_SATS } from '../../constants/receive';

interface AmountPanelProps {
  isOpen: boolean;
  /** Validated amount in sats; null when the input is empty or invalid. */
  amountSats: Sats | null;
  setAmountSats: (sats: Sats | null) => void;
  setAmountDisplay: (display: string | null) => void;
  description: string;
  setDescription: (v: string) => void;
  isLoading: boolean;
  error: string | null;
  onCreateInvoice: () => void;
  onClose: () => void;
  // Monotonically-increasing counter from `useReceivePayment.reset()`.
  // Every bump clears this panel's local `displayAmount` +
  // `isTokenMode` state. Needed because the outer BottomSheet keeps
  // AmountPanel mounted across dialog opens (`unmount={false}`), so
  // without an explicit reset signal the previously-typed amount and
  // fiat-mode toggle would linger when the user reopens the dialog
  // later.
  resetCount: number;
}

const AmountPanel: React.FC<AmountPanelProps> = ({
  isOpen,
  amountSats,
  setAmountSats,
  setAmountDisplay,
  description,
  setDescription,
  isLoading,
  error,
  onCreateInvoice,
  onClose,
  resetCount,
}) => {
  // Fiat entry without a stable-balance token: the typed amount is converted to
  // sats client-side (#356). Denominated in whatever currency the balance
  // header is showing, including one the user cycled to by tapping it.
  const input = useAmountInput({ fiatOverride: useFiatOverride(getDisplayFiatCurrency()) });
  const {fiatRates,fetchedAt}=useFiatData();
  const [denomination,setDenomination]=React.useState<Denomination>(getDenomination);
  const [unitRaw,setUnitRaw]=React.useState('');
  const currentRate=!!fetchedAt&&Date.now()-fetchedAt<120_000?fiatRates.find(r=>r.coin==='INR')?.value:undefined;
  const {
    amountInput: displayAmount,
    setAmount,
    setAmountInput,
    resetAmount,
    isTokenMode,
    setIsTokenMode,
    toggleDenomination,
    tokenSymbol,
    config,
    btcFiatRate,
    quickAmountScale,
    amountSats: parsedSats,
  } = input;

  const customUnit=denomination!=='sats'&&!isTokenMode;
  const unitUnavailable=denomination==='INR'&&!currentRate;
  const shownAmount=customUnit?unitRaw:displayAmount;
  const chooseUnit=(next:Denomination)=>{
    if(next==='INR'&&!currentRate)return;
    const satNumber=parsedSats===null?0:Number(parsedSats);
    setIsTokenMode(false);
    setDenomination(next);
    saveDenomination(next);
    setUnitRaw(satNumber>0?satsToAmount(satNumber,next,currentRate):'');
    if(next==='sats')setAmountInput(satNumber>0?String(satNumber):'');
  };
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Push the hook's parsed sats up to the parent. Centralizes the contract:
  // parent always sees a validated Sats (or null), never a raw string.
  useEffect(() => {
    setAmountSats(parsedSats);
  }, [parsedSats, setAmountSats]);

  // The unit the amount was typed in is the one the invoice will state it in,
  // so the figure goes up alongside the sats. Null in sats mode: there the
  // sats are the figure.
  useEffect(() => {
    setAmountDisplay(customUnit&&unitRaw?unitRaw+' '+denomination:
      isTokenMode && config ? formatTokenInput(displayAmount,config):null);
  }, [isTokenMode, config, displayAmount, setAmountDisplay,customUnit,unitRaw,denomination]);

  // Clear local state whenever the parent dialog calls
  // `useReceivePayment.reset()` or `closeAmountPanel()`, which bumps
  // `resetCount`. Without this, `displayAmount` + `isTokenMode` persist
  // across dialog open/close cycles because the outer BottomSheet keeps
  // this subtree mounted (`unmount={false}`). Skipping the initial
  // render (resetCount === 0) so the token-mode default picked from
  // `useAmountInput` on first mount stays untouched.
  useEffect(() => {
    if (resetCount === 0) return;
    resetAmount();
    setUnitRaw('');
  }, [resetCount, resetAmount]);

  // Also clear when the dialog closes via the `isOpen` prop, so the
  // input doesn't persist a stale value on the next open even if the
  // parent hasn't bumped `resetCount`.
  useEffect(() => {
    if (!isOpen) {resetAmount(); setUnitRaw('')}
  }, [isOpen, resetAmount]);

  const handleToggleDenomination = () => {
    toggleDenomination();
  };

  const handleAmountChange = (value: string) => {
    if(customUnit){
      setUnitRaw(value);
      const converted=amountToSats(value,denomination,currentRate);
      setAmount(converted?String(converted):'');
    }else setAmount(value);
  };

  const handleQuickAmount = (quickAmount: number) => {
    setAmountInput(String(quickAmount));
    if(customUnit)setUnitRaw(satsToAmount(quickAmount,denomination,currentRate));
  };

  // Receive has no balance to scale against, so both denominations offer the
  // same fixed points of value, held to that value by the rate.
  const quickAmounts = fixedQuickAmounts(quickAmountScale, [10, 50, 200]);

  // Mirrors the guard in `useReceivePayment.generateBolt11Invoice` so
  // the UI disables the Generate button + Enter-to-submit path for
  // amounts below the minimum. Works in both sats and token mode
  // because the parsed sats are produced by `useAmountInput`
  // regardless of denomination.
  const validAmount = amountSats !== null
    && amountSats >= BigInt(LIGHTNING_INVOICE_MIN_SATS);

  // "Invalid amount" surfaces when the input is non-empty and positive but
  // can't safely be converted to sats: covers both unsafe-integer overflow
  // (fiat or sats) and unsafe results from fiat→sats conversion.
  const amountTooLarge = useMemo(() => {
    if (displayAmount === '' || parsedSats !== null) return false;
    const numeric = Number(shownAmount);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;
    const projectedSats = isTokenMode && btcFiatRate > 0
      ? (numeric / btcFiatRate) * 100_000_000
      : numeric;
    return projectedSats > Number.MAX_SAFE_INTEGER;
  }, [displayAmount, shownAmount, parsedSats, isTokenMode, btcFiatRate]);

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={onClose} showBackdrop>
      <BottomSheetCard>
        <DialogHeader
          title="Create Invoice"
          onClose={onClose}
          icon={<LightningBoltIcon />}
        />

        {/* Amount Input */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-spark-text-primary mb-2">
              Amount
            </label>
            <div className="relative">
              <textarea
                inputMode={customUnit?'decimal':isTokenMode?'decimal':'numeric'}
                enterKeyHint="next"
                value={shownAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                onKeyDown={(e) => {
                  // Enter on the amount field advances to the
                  // description field (the soft keyboard's Next
                  // action). Never inserts a newline.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    descriptionInputRef.current?.focus();
                  }
                }}
                placeholder={customUnit?(denomination==='INR'?'₹ 20.00':'0.0001'):isTokenMode?'0.00':'0'}
                disabled={isLoading}
                rows={1}
                className={`${AMOUNT_FIELD_CLASS} resize-none pr-16 font-mono`}
                data-testid="invoice-amount-input"
              />
              {tokenSymbol && denomination==='sats' && (
                <CurrencySwitcher
                  isTokenMode={isTokenMode}
                  tokenSymbol={tokenSymbol}
                  onSwitch={handleToggleDenomination}
                  disabled={isLoading}
                />
              )}
            </div>
            <DenominationTabs value={denomination} onChange={chooseUnit} disabled={isLoading} inrAvailable={!!currentRate}/>
            {unitUnavailable&&<p role="status" className="text-xs text-spark-warning">Live INR/BTC price unavailable. Choose sats or BTC.</p>}
            {customUnit&&parsedSats!==null&&<p className="text-xs text-spark-text-muted">≈ {String(parsedSats)} sats · Invoice settles in Bitcoin</p>}
          </div>

          {/* Quick amount buttons. Hidden while the native keyboard is
              up: this is the tallest sheet form, and with the row kept
              the amount/description fields get pushed into inner
              scrolling, which makes focus switches jump. */}
          <div className="flex gap-2 hide-on-keyboard">
            {quickAmounts.map((quickAmount) => (
              <button
                key={quickAmount}
                type="button"
                onClick={() => handleQuickAmount(quickAmount)}
                disabled={isLoading}
                className={`
                  flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all
                  ${shownAmount === (customUnit?satsToAmount(quickAmount,denomination,currentRate):String(quickAmount))
                    ? 'bg-spark-primary text-black'
                    : 'bg-spark-elevated border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                  }
                `}
              >
                {isTokenMode && config ? formatQuickAmount(quickAmount, config) : <SatAmount sats={quickAmount} />}
              </button>
            ))}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-spark-text-primary mb-2">Description (optional)</label>
            <textarea
              ref={descriptionInputRef}
              enterKeyHint="done"
              value={description}
              onChange={(e) => setDescription(e.target.value.replace(/\n/g, ''))}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // Always retract the keyboard on Enter. Commit
                  // only if the amount is valid and we're not
                  // already generating.
                  await dismissKeyboard();
                  if (validAmount && !isLoading) {
                    onCreateInvoice();
                  }
                }
              }}
              placeholder="What's this for?"
              disabled={isLoading}
              rows={1}
              className={`${AMOUNT_FIELD_CLASS} resize-none`}
            />
          </div>

          <FormError error={amountTooLarge ? 'Invalid amount' : error} data-testid="invoice-error-message" />

          {/* Generate Button */}
          <PrimaryButton
            onClick={async () => {
              // Dismiss the keyboard before kicking off the network
              // roundtrip so the user sees the loading state and the
              // resulting invoice QR unobstructed.
              await dismissKeyboard();
              onCreateInvoice();
            }}
            type="submit"
            disabled={isLoading || !validAmount || unitUnavailable}
            className="w-full"
            data-testid="generate-invoice-button"
          >
            {isLoading ? <LoadingSpinner size="small" /> : 'Generate Invoice'}
          </PrimaryButton>
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default AmountPanel;
