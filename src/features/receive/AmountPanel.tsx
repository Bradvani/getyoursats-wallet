import {useFiatData} from '../../contexts/FiatDataContext';
import DenominationTabs from '../../getyoursats/DenominationTabs';
import {amountToSats,getDenomination,isFiatDenomination,saveDenomination,satsToAmount,type Denomination} from '../../getyoursats/denomination';
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
import { formatTokenInput } from '../../utils/tokenFormatting';
import {receiveAmountPresets} from './receiveAmountPresets';
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
  const currentCurrency=isFiatDenomination(denomination)?denomination:getDisplayFiatCurrency();
  const currentRate=fetchedAt?fiatRates.find(r=>r.coin===currentCurrency)?.value:undefined;
  const rateFor=(unit:Denomination)=>fiatRates.find(r=>r.coin===unit)?.value;
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
    amountSats: parsedSats,
  } = input;

  const customUnit=denomination!=='sats'&&!isTokenMode;
  const unitUnavailable=isFiatDenomination(denomination)&&!currentRate;
  const shownAmount=customUnit?unitRaw:displayAmount;
  const chooseUnit=(next:Denomination)=>{
    const nextRate=isFiatDenomination(next)?rateFor(next):undefined;
    if(isFiatDenomination(next)&&(!nextRate||!fetchedAt))return;
    const satNumber=parsedSats===null?0:Number(parsedSats);
    setIsTokenMode(false);
    setDenomination(next);
    saveDenomination(next);
    setUnitRaw(satNumber>0?satsToAmount(satNumber,next,nextRate):'');
    if(next==='sats')setAmountInput(satNumber>0?String(satNumber):'');
  };
  const [rateError,setRateError]=React.useState('');
  const requestInvoice=()=>{
    if(isFiatDenomination(denomination) && (!fetchedAt || Date.now()-fetchedAt>120_000)){
      setRateError(denomination+'/BTC quote has expired. Refresh the wallet and try again.');
      return;
    }
    setRateError('');
    onCreateInvoice();
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

  const handleQuickAmount = (value:string) => {
    handleAmountChange(value);
  };

  // Presets are shown in the unit the person actually selected.
  // Stable-balance token mode retains its USD-denominated quick values.
  const quickAmounts = receiveAmountPresets(denomination,isTokenMode);
  const amountUnitLabel=isTokenMode&&config?(tokenSymbol||'USD'):
    denomination==='sats'?'sats':denomination==='BTC'?'BTC':denomination;
  const amountEquivalent=parsedSats!==null && customUnit && unitRaw
    ? satsToAmount(Number(parsedSats),'sats') : '';

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

        {/* Currency first: choose how to express the requested Bitcoin amount,
            then enter it in a single-line numeric field. */}
        <div className="space-y-4">
          <section className="rounded-2xl border border-spark-border bg-spark-elevated/30 p-4 space-y-3" aria-label="Requested amount">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="receive-request-amount" className="block text-sm font-medium text-spark-text-primary">
                Request amount
              </label>
              <span className="text-xs text-spark-text-muted">Settles in Bitcoin</span>
            </div>
            <div aria-label="Choose amount currency">
              <DenominationTabs value={denomination} onChange={chooseUnit} disabled={isLoading} fiatAvailable={!!currentRate}/>
            </div>
            <div className="rounded-xl border border-spark-border bg-spark-dark px-4 py-3 flex items-center gap-3 focus-within:border-spark-primary">
              <input
                id="receive-request-amount"
                type="text"
                autoComplete="off"
                pattern="[0-9]*[.,]?[0-9]*"
                inputMode={customUnit?'decimal':isTokenMode?'decimal':'numeric'}
                enterKeyHint="next"
                value={shownAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    descriptionInputRef.current?.focus();
                  }
                }}
                placeholder={customUnit?(isFiatDenomination(denomination)?'0.00':'0.0001'):isTokenMode?'0.00':'0'}
                disabled={isLoading}
                className="min-w-0 w-full flex-1 bg-transparent text-spark-text-primary text-3xl font-semibold font-mono tracking-tight outline-none placeholder:text-spark-text-muted"
                data-testid="invoice-amount-input"
                aria-describedby="receive-amount-equivalent"
              />
              <span aria-label="Selected denomination" className="shrink-0 rounded-lg bg-spark-elevated px-2 py-1 text-sm text-spark-text-secondary font-semibold">{amountUnitLabel}</span>
            </div>
            {tokenSymbol && denomination==='sats' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-spark-text-secondary">Stable balance</span>
                <CurrencySwitcher
                  isTokenMode={isTokenMode}
                  tokenSymbol={tokenSymbol}
                  onSwitch={handleToggleDenomination}
                  disabled={isLoading}
                />
              </div>
            )}
            <div id="receive-amount-equivalent" className="min-h-5 text-xs text-spark-text-muted" aria-live="polite">
              {unitUnavailable ? `Live ${denomination}/BTC price unavailable. Select sats or BTC.`
                : customUnit && amountEquivalent ? `≈ ${Number(amountEquivalent).toLocaleString('en-US')} sats · indicative conversion`
                : denomination==='sats'&&!isTokenMode ? 'Enter an exact amount in satoshis'
                : 'The exact satoshi amount will appear after conversion'}
            </div>
          </section>

          <section className="space-y-2 hide-on-keyboard" aria-label="Suggested amounts">
            <p className="text-xs text-spark-text-muted">Quick amounts · {amountUnitLabel}</p>
            <div className="grid grid-cols-3 gap-2">
              {quickAmounts.map(value=>(
                <button key={value} type="button" onClick={()=>handleQuickAmount(value)}
                  disabled={isLoading || unitUnavailable}
                  aria-pressed={shownAmount===value}
                  className={`min-h-11 rounded-xl border px-2 text-sm font-semibold font-mono transition-colors
                    ${shownAmount===value
                      ? 'bg-spark-primary text-black border-spark-primary'
                      : 'bg-spark-elevated border-spark-border text-spark-text-primary hover:border-spark-border-light'}`}>
                  {value}
                </button>
              ))}
            </div>
          </section>

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
                    requestInvoice();
                  }
                }
              }}
              placeholder="What's this for?"
              disabled={isLoading}
              rows={1}
              className={`${AMOUNT_FIELD_CLASS} resize-none`}
            />
          </div>

          <FormError error={rateError || (amountTooLarge ? 'Invalid amount' : error)} data-testid="invoice-error-message" />

          {/* Generate Button */}
          <PrimaryButton
            onClick={async () => {
              // Dismiss the keyboard before kicking off the network
              // roundtrip so the user sees the loading state and the
              // resulting invoice QR unobstructed.
              await dismissKeyboard();
              requestInvoice();
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
