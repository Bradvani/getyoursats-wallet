import {formatMoney} from '@/getyoursats/money';
import {receiveQuoteEvidence} from '@/getyoursats/receiveQuote';
import {trustCopy} from '@/getyoursats/trustCopy';
import {usePresentation} from '@/hooks/usePresentation';
import React, { useCallback, useEffect, useState } from 'react';
import type {
  CrossChainReceiveInfo,
  CrossChainRoutePair,
  ReceivePaymentResponse,
} from '@breeztech/breez-sdk-spark';
import {
  PrimaryButton,
  QRCodeContainer,
  CopyableText,
  FormError,
  AMOUNT_FIELD_CLASS,
} from '../../../components/ui';
import { SpinnerIcon } from '../../../components/Icons';
import { CrossChainAssetStep } from '../../../components/crossChain/CrossChainAssetStep';
import { CrossChainChainStep } from '../../../components/crossChain/CrossChainChainStep';
import { useWallet } from '../../../contexts/WalletContext';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { useToast } from '../../../contexts/ToastContext';
import { useCrossChainRouteGroups } from '../../../hooks/useCrossChainRouteGroups';
import { useSheetBack, useSheetFullSnap, useSheetOwnsScroll } from '../../../components/ui/sheets/BottomSheetCardContext';
import {
  assetDisplayName,
  assetMatchesGroup,
  buildGroupLookup,
  chainGroupKey as chainGroupKeyWith,
  crossChainCardClass,
  crossChainFriendlyError,
  landsInThisWallet,
} from '../../../utils/crossChainRoutes';
import { formatChainName, formatCrossChainAmount, parseCrossChainAmount } from '../../../utils/crossChainFormat';
import { copyToClipboard } from '../../../utils/clipboard';
import { normalizeDecimalInput } from '../../../utils/decimalInput';
import { formatTokenAmount } from '../../../utils/tokenFormatting';
import { getProviderDisplayName } from '../../../utils/paymentDescription';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';

type WorkflowStep = 'amount' | 'loading' | 'asset' | 'chain' | 'provider' | 'generating' | 'result';

const QUICK_USD_AMOUNTS = [10, 50, 200];

interface CrossChainReceiveWorkflowProps {
  /** Whether the USD tab is the one on screen. Kept mounted while it is not,
   *  so a trip to BTC and back does not discard a typed amount or a quote. */
  active: boolean;
  /** True while the flow is still on its amount form, which is where the tabs
   *  still belong. */
  onRestingChange?: (resting: boolean) => void;
}

const CrossChainReceiveWorkflow: React.FC<CrossChainReceiveWorkflowProps> = ({ active, onRestingChange }) => {
  const wallet = useWallet();
  const stableBalance = useStableBalance();
  const { showToast } = useToast();
  const isSheetFull = useSheetFullSnap();

  const [step, setStep] = useState<WorkflowStep>('amount');
  const [usdInput, setUsdInput] = useState('');
  const [routes, setRoutes] = useState<CrossChainRoutePair[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<CrossChainRoutePair | null>(null);
  const [receiveResult, setReceiveResult] = useState<ReceivePaymentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pending selections (user highlights, then clicks Continue)
  const [pendingAsset, setPendingAsset] = useState<string | null>(null);
  const [pendingChain, setPendingChain] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const {language}=usePresentation(); const text=trustCopy(language);
  const [acknowledged,setAcknowledged]=useState(false);
  const [revealed,setRevealed]=useState(false);
  const [now,setNow]=useState(Date.now);
  const [destinationMetadata,setDestinationMetadata]=useState<{identifier:string;ticker:string;decimals:number}|null>(null);
  useEffect(()=>{if(step!=='result')return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[step]);
  const destinationToken=receiveResult?.crossChainInfo?.tokenIdentifier;
  useEffect(()=>{let active=true;if(!destinationToken)return;
   void wallet.getTokensMetadata({tokenIdentifiers:[destinationToken]}).then(result=>{const item=result.tokensMetadata.find(x=>x.identifier===destinationToken);if(active&&item)setDestinationMetadata(item);}).catch(()=>{});
   return()=>{active=false;};
  },[wallet,destinationToken]);

  // The provider and result steps cap and scroll themselves, same as the
  // asset / chain steps do from inside their own components.
  useSheetOwnsScroll(active && (step === 'provider' || step === 'result'));

  useEffect(() => { onRestingChange?.(step === 'amount'); }, [step, onRestingChange]);

  const { uniqueAssets, chainGroupKey, getChainsForAsset } = useCrossChainRouteGroups(routes);
  const chainsForAsset = selectedAsset ? getChainsForAsset(selectedAsset) : [];
  const routesForSelection = selectedAsset && selectedChain
    ? routes.filter(r => assetMatchesGroup(r.asset, selectedAsset) && chainGroupKey(r) === selectedChain)
    : [];

  // The sender deposits in the source asset's base units. Source assets here
  // are USD stablecoins, so the typed dollar value maps directly.
  const usdValue = parseFloat(usdInput);
  const canContinue = Number.isFinite(usdValue) && usdValue > 0;

  // Comma-locale keypads offer only "," as the separator, so normalize before
  // the two-decimal guard or the key the keypad shows is the one we drop.
  const handleAmountChange = (value: string) => {
    const normalized = normalizeDecimalInput(value);
    if (/^\d*\.?\d{0,2}$/.test(normalized)) setUsdInput(normalized);
  };

  // Single-step receive: create the order and surface the deposit address.
  // `usdInput` is the deposit the sender sends (exact-in), not the amount the
  // merchant receives. The SDK's crossChain receive has no exact-out / fees-
  // included mode yet (route.exactOutEligible is a flag with no parameter to
  // drive it), so the received amount comes back lower. Flip to merchant-enters-
  // received-amount once the SDK supports it.
  const generateOrder = useCallback(async (route: CrossChainRoutePair) => {
    setSelectedRoute(route);
    setStep('generating');
    setError(null);
    // `amount` is denominated in the route's source asset (`route.decimals`),
    // matching prepare_payment_link. Source assets are USD stablecoins, so the
    // typed dollar value carries over at parity across differing precisions.
    const amount = parseCrossChainAmount(usdInput, route.decimals);
    try {
      const res = await wallet.receivePayment({
        paymentMethod: { type: 'crossChain', route, amount },
      });
      setReceiveResult(res);
      setStep('result');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to create cross-chain receive order', { error: formatError(err) });
      setError(crossChainFriendlyError(err, 'Failed to create request.'));
      setStep('amount');
    }
  }, [wallet, usdInput]);

  // Advance from chain selection. Only >1 provider opens a provider step;
  // otherwise create the order directly (today routes are Orchestra-only).
  const selectChain = useCallback((asset: string, chainKey: string, allRoutes: CrossChainRoutePair[]) => {
    setSelectedChain(chainKey);
    const lookup = buildGroupLookup(allRoutes);
    const matching = allRoutes.filter(r => assetMatchesGroup(r.asset, asset) && chainGroupKeyWith(r, lookup) === chainKey);
    if (matching.length === 1) {
      generateOrder(matching[0]);
    } else {
      setStep('provider');
    }
  }, [generateOrder]);

  const selectAsset = useCallback((asset: string, allRoutes: CrossChainRoutePair[]) => {
    setSelectedAsset(asset);
    const lookup = buildGroupLookup(allRoutes);
    const matching = allRoutes.filter(r => assetMatchesGroup(r.asset, asset));
    const chainKeys = [...new Set(matching.map(r => chainGroupKeyWith(r, lookup)))];
    if (chainKeys.length === 1) {
      selectChain(asset, chainKeys[0], allRoutes);
    } else {
      setStep('chain');
    }
  }, [selectChain]);

  const stableTokenIdentifier = stableBalance.isActive ? stableBalance.tokenIdentifier : null;

  const fetchRoutes = useCallback(async () => {
    setStep('loading');
    setError(null);
    try {
      const listed = await wallet.getCrossChainRoutes({ type: 'receive' });
      // In sats mode a route that only lands a token fails on every receive,
      // and its funds would be ones Glow can't show or spend anyway.
      const fetched = listed?.filter(route => landsInThisWallet(route, stableTokenIdentifier));
      if (!fetched || fetched.length === 0) {
        setError('No cross-chain routes available right now');
        setStep('amount');
        return;
      }
      setRoutes(fetched);
      const assets = [...new Set(fetched.map(r => assetDisplayName(r.asset)))].sort();
      if (assets.length === 1) {
        selectAsset(assets[0], fetched);
      } else {
        setStep('asset');
      }
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to fetch cross-chain receive routes', { error: formatError(err) });
      setError(`Failed to fetch routes: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setStep('amount');
    }
  }, [wallet, selectAsset, stableTokenIdentifier]);

  // Back navigation — respect skipped steps
  const goBackToAmount = () => {
    setSelectedAsset(null);
    setSelectedChain(null);
    setSelectedRoute(null);
    setPendingAsset(null);
    setPendingChain(null);
    setPendingProvider(null);
    setError(null);
    setStep('amount');
  };

  const goBackFromChain = () => {
    setSelectedChain(null);
    setPendingChain(null);
    setError(null);
    if (uniqueAssets.length > 1) {
      setSelectedAsset(null);
      setPendingAsset(null);
      setStep('asset');
    } else {
      goBackToAmount();
    }
  };

  const goBackFromProvider = () => {
    setPendingProvider(null);
    setError(null);
    if (chainsForAsset.length > 1) {
      setSelectedChain(null);
      setPendingChain(null);
      setStep('chain');
    } else {
      goBackFromChain();
    }
  };

  // Back from the deposit address to the choice that produced it. The order
  // already made just expires unpaid.
  const goBackFromResult = () => {
    setReceiveResult(null);
    setSelectedRoute(null);
    setAcknowledged(false); setRevealed(false);
    if (routesForSelection.length > 1) {
      setStep('provider');
    } else {
      goBackFromProvider();
    }
  };

  // The asset and chain steps lend their own.
  useSheetBack(step === 'provider' ? goBackFromProvider : step === 'result' ? goBackFromResult : undefined);

  // Received amount lands as a stable token (USDB) or as BTC sats, depending on
  // the SDK's auto-pick. `route.decimals` is the *source* asset, so it can't be
  // reused here — branch on `tokenIdentifier` and format the destination asset.
  const formatReceived = (info: CrossChainReceiveInfo): string => {
    const amount = BigInt(info.expectedReceivedAmount);
    if (info.tokenIdentifier) {
      if (stableBalance.tokenIdentifier === info.tokenIdentifier && stableBalance.displayConfig) {
        return formatTokenAmount(amount, stableBalance.displayConfig);
      }
      if(destinationMetadata?.identifier===info.tokenIdentifier)return formatMoney({kind:'token',amount,decimals:destinationMetadata.decimals,ticker:destinationMetadata.ticker});
      return `${amount.toString()} base units (${info.destinationAsset}; precision unavailable)`;
    }
    return /^(btc|bitcoin|sats)$/i.test(info.destinationAsset)?formatMoney({kind:'sats',amount}):`${amount.toString()} base units (${info.destinationAsset}; precision unavailable)`;
  };

  const resultInfo = receiveResult?.crossChainInfo;
  const resultAssetName = selectedRoute ? assetDisplayName(selectedRoute.asset) : '';
  const resultChainName = selectedRoute ? formatChainName(selectedRoute.chain) : '';
  // The amount the sender transfers is shown at the source asset's exact precision.
  // Never substitute a bank-dollar symbol for a token amount. Original rounded
  // display; `resultDepositAmount` (bare, full precision) is what the copy button
  // and the QR/EIP-681 carry for the sender to pay — e.g. shows "$1.06" but the
  // real deposit (and copy) is "1.0558" when the SDK doesn't floor to the cent.
  const resultDepositAmount = selectedRoute && resultInfo
    ? formatCrossChainAmount(BigInt(resultInfo.depositAmount), selectedRoute.decimals)
    : usdInput;
  // Plain deposit address for copy/paste (MetaMask etc.). The QR keeps the
  // EIP-681 URI so scanners auto-fill the amount; falls back to the URI if the
  // SDK omitted the structured info.
  const resultDepositAddress = resultInfo?.depositAddress ?? receiveResult?.paymentRequest ?? '';
  const resultShareMessage = `Send ${resultDepositAmount} ${resultAssetName} on ${resultChainName} to ${resultDepositAddress}`;
  const requestedAtomic=selectedRoute?parseCrossChainAmount(usdInput,selectedRoute.decimals):null;
  const quote=resultInfo&&requestedAtomic!==null?receiveQuoteEvidence(resultInfo,requestedAtomic):null;
  const quoteUsable=!!quote?.expiresAtMs && now<quote.expiresAtMs;
  const fee=quote?.fee;
  const copyDepositAmount=async()=>{if(!revealed||!quoteUsable)return;try{await copyToClipboard(resultDepositAmount);showToast('success',text.copySuccess);}catch{showToast('error',text.copyFailure);}};

  // Steps are content-sized: the sheet re-measures and re-snaps per step, so a
  // short step is not padded out to the tallest one. `pt-6` is the step padding
  // the other receive tabs use. The selection lists cap themselves against the
  // viewport (see CrossChainAssetStep) rather than against this container.
  if (!active) return null;

  return (
    <div className="pt-6">
      {/* Step 1: Amount */}
      {step === 'amount' && (
        <div>
          <div>
            <p className="text-sm text-spark-text-secondary mb-3">{text.stablecoins} · {text.depositModel}</p><label className="block text-sm font-medium text-spark-text-primary mb-2">{text.requestedAmount}</label>
            <input
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              value={usdInput}
              onChange={(e) => handleAmountChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canContinue) fetchRoutes();
                }
              }}
              placeholder="USDT / USDC"
              className={AMOUNT_FIELD_CLASS}
              data-testid="cross-chain-receive-amount-input"
            />

            {/* Quick amount buttons */}
            <div className="flex gap-2 mt-3">
              {QUICK_USD_AMOUNTS.map((quickAmount) => {
                const isSelected = parseFloat(usdInput) === quickAmount;
                return (
                  <button
                    key={quickAmount}
                    onClick={() => setUsdInput(String(quickAmount))}
                    className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all ${
                      isSelected
                        ? 'bg-spark-primary text-white'
                        : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                    }`}
                  >
                    ${quickAmount}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 pt-6">
            <FormError error={error} />
            <PrimaryButton onClick={() => fetchRoutes()} className="w-full" disabled={!canContinue} data-testid="cross-chain-receive-continue">
              Continue
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Loading routes / creating order */}
      {(step === 'loading' || step === 'generating') && (
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <SpinnerIcon size="lg" className="text-spark-primary animate-spin" />
          <p className="text-sm text-spark-text-secondary">
            {step === 'loading' ? 'Fetching routes...' : 'Creating request...'}
          </p>
        </div>
      )}

      {/* Step 2: Asset selection */}
      {step === 'asset' && (
        <CrossChainAssetStep
          assets={uniqueAssets}
          pending={pendingAsset}
          onPendingChange={setPendingAsset}
          onBack={goBackToAmount}
          onContinue={() => { if (pendingAsset) selectAsset(pendingAsset, routes); }}
          error={error}
        />
      )}

      {/* Step 3: Chain selection */}
      {step === 'chain' && (
        <CrossChainChainStep
          chains={chainsForAsset}
          chainGroupKey={chainGroupKey}
          selectedAsset={selectedAsset}
          pending={pendingChain}
          onPendingChange={setPendingChain}
          onBack={goBackFromChain}
          onContinue={() => { if (pendingChain && selectedAsset) selectChain(selectedAsset, pendingChain, routes); }}
          error={error}
        />
      )}

      {/* Step 4: Provider selection (only when >1 provider) */}
      {step === 'provider' && (
        <div className="flex flex-col" style={{ maxHeight: isSheetFull ? '85dvh' : '60dvh' }}>
          <div className="mb-4 min-h-0 flex flex-col">
            <label className="block text-sm font-medium text-spark-text-primary mb-2 shrink-0">
              Select Provider for {selectedAsset} ({formatChainName(routesForSelection[0]?.chain ?? '')})
            </label>
            <div className="space-y-2 overflow-y-auto overscroll-y-none touch-pan-y min-h-0 pr-1">
              {routesForSelection.map(r => (
                <button
                  key={r.provider}
                  onClick={() => setPendingProvider(r.provider)}
                  className={crossChainCardClass(pendingProvider === r.provider)}
                >
                  <span className="font-display font-medium text-spark-text-primary">
                    {getProviderDisplayName(r.provider)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="shrink-0 pt-2">
            <PrimaryButton
              onClick={() => {
                const r = routesForSelection.find(x => x.provider === pendingProvider);
                if (r) generateOrder(r);
              }}
              className="w-full"
              disabled={!pendingProvider}
            >
              Continue
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Step 5: Result. Capped like the selection lists: content past 90% of
          the viewport stops the sheet fitting it, which left a short screen's
          deposit address below the fold. */}
      {step === 'result' && receiveResult && selectedRoute && (
        <div
          className="pb-2 flex flex-col items-center gap-4 overflow-y-auto overscroll-y-none touch-pan-y min-h-0"
          style={{ maxHeight: isSheetFull ? '85dvh' : '60dvh' }}
        >
          {/* The source asset/network and exact provider quote lead. Optional
              economics are available without presenting SDK diagnostics as a
              scary waiver. No differences are called fees without SDK evidence. */}
          <section className="w-full max-w-xl mx-auto space-y-4 rounded-2xl border border-spark-border bg-spark-dark p-4 sm:p-6 text-sm" aria-label={text.quoteReview}>
            <div>
              <h3 className="text-lg font-semibold text-spark-text-primary">{text.quoteReview}</h3>
              <p className="mt-1 text-spark-text-secondary">{resultAssetName} · {resultChainName} · {getProviderDisplayName(selectedRoute.provider)}</p>
            </div>
            <div className="rounded-xl border border-spark-border bg-spark-surface px-4 py-4">
              <p className="text-xs font-medium text-spark-text-muted">{text.requiredDeposit}</p>
              <p className="mt-1 break-words font-mono text-2xl sm:text-3xl font-semibold text-spark-text-primary" data-testid="cross-chain-deposit-amount">
                {resultDepositAmount} <span className="text-lg">{resultAssetName}</span>
              </p>
              <p className="mt-2 text-xs text-spark-text-secondary">{text.requestedAmount}: {usdInput} {resultAssetName}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-b border-spark-border pb-4">
              <div className="min-w-0">
                <dt className="text-xs text-spark-text-muted">{text.expectedOutput}</dt>
                <dd className="mt-1 break-words font-medium text-spark-text-primary">{resultInfo?formatReceived(resultInfo):text.checking}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-spark-text-muted">{text.expires}</dt>
                <dd className="mt-1 text-spark-text-primary">{quote?.expiresAtMs?new Date(quote.expiresAtMs).toLocaleString(language):text.expiryUnavailable}</dd>
              </div>
            </dl>
            <details className="group text-spark-text-secondary">
              <summary className="cursor-pointer py-2 font-semibold text-spark-text-primary focus-visible:outline-spark-primary">{text.quoteDetails}</summary>
              <dl className="space-y-3 pt-2">
                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                  <dt>{text.providerFee}</dt>
                  <dd className="font-mono text-spark-text-primary">{fee?formatMoney({kind:'token',amount:fee.amount,decimals:fee.decimals,ticker:fee.asset}):text.feeUnavailable}</dd>
                </div>
                {quote&&quote.difference!==0n&&<div className="border-t border-spark-border pt-3">
                  <dt>{text.difference}</dt>
                  <dd className="mt-1 font-mono text-spark-text-primary">{formatMoney({kind:'token',amount:quote.difference,decimals:selectedRoute.decimals,ticker:resultAssetName})}</dd>
                  <p className="mt-1 text-xs text-spark-text-muted">{text.unexplained}</p>
                </div>}
                <div className="border-t border-spark-border pt-3 text-xs text-spark-text-muted">
                  {text.underpayment}
                </div>
              </dl>
            </details>
          </section>
          {!quoteUsable?<div role="alert" className="w-full max-w-xl mx-auto space-y-3"><p>{quote?.expiresAtMs?text.expired:text.expiryUnavailable}</p><PrimaryButton onClick={()=>generateOrder(selectedRoute)}>{text.retry}</PrimaryButton></div>:!revealed?<div className="w-full max-w-xl mx-auto space-y-3">
            <label className="flex gap-3 text-sm text-spark-text-secondary"><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/>{text.depositAck}</label>
            <PrimaryButton disabled={!acknowledged} onClick={()=>setRevealed(true)} className="w-full">{text.showDeposit}</PrimaryButton>
          </div>:<>
            <button type="button" onClick={()=>void copyDepositAmount()} className="min-h-11 text-spark-primary">{text.requiredDeposit}: {resultDepositAmount} {resultAssetName}</button>
            <QRCodeContainer value={receiveResult.paymentRequest}/>
            <CopyableText text={resultDepositAddress} textToShare={resultShareMessage} truncate showShare label={text.depositAddress} onCopied={()=>showToast('success',text.copySuccess)} onShareError={()=>showToast('error',text.copyFailure)} data-testid="cross-chain-deposit-address"/>
          </>}

        </div>
      )}
    </div>
  );
};

export default CrossChainReceiveWorkflow;
