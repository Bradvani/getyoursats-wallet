import {notifyPaymentFeedback} from '@/utils/transferHaptics';
import {classifyLookupFailure} from '@/getyoursats/lookupFailure';
import {trustCopy} from '@/getyoursats/trustCopy';
import {paymentOutcome,type PaymentExecutionResult} from '@/getyoursats/paymentOutcome';
import { useState, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import type { Payment, PrepareSendPaymentResponse, FeePolicy, SendPaymentOptions, SdkEvent, ConversionOptions, InputType } from '@breeztech/breez-sdk-spark';
import type { SendInput } from '@/types/domain';
import { useWallet, useWalletInfo } from '../../../contexts/WalletContext';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { getTokenBalance } from '../../../utils/tokenFormatting';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { destinationErrorMessage } from '@/utils/destinationAddress';
import {selectedNetwork} from '@/services/sdkConnect';
import {gysRecipient,isGysPaymentInput,resolveGysRecipient,revalidateGysRecipient,validateGysQuote,DIRECT_UNAVAILABLE,type GysDirectRecipient} from '@/services/gysDirectPayments';
import {canTrackGysPayments,checkGysPaymentIntent,reserveGysPaymentIntent,finishGysPaymentIntent,CHECK_PREVIOUS_PAYMENT} from '@/services/gysPaymentIntent';
import { cancelSendAuthorization, isSendAuthorizationError, requiresSendAuthorization, sendPaymentWithValidation, SendAuthorizationError, subscribeSendAuthorization } from '@/services/sendAuthorization';
import { sendAuthorizationCopy } from '@/locales/sendAuthorization';
import { getAppLanguage } from '@/services/presentationPreferences';

/** The destination string inside a parsed input, or null for the types that
 *  are paid through their own workflow rather than a prepared destination. */
function bareDestination(parsed: InputType): string | null {
  switch (parsed.type) {
    case 'bolt11Invoice':
      return parsed.invoice.bolt11;
    case 'bitcoinAddress':
    case 'sparkAddress':
      return parsed.address;
    default:
      return null;
  }
}

/** The parser's refusals of an LNURL-auth code (LUD-04), as opposed to input
 *  that is not a destination at all. */
const BAD_LOGIN_CODE = /lnurl (missing|contains invalid) k1|lnurl contains unsupported action/;

export type SendStep ='destination' | 'input' | 'amount' | 'workflow' | 'processing' | 'result';
export type ProcessingPhase = 'authorizing' | 'sending' | 'converting';

export interface ProcessInputOptions {
  /** Set by callers that submit an input the user did not type: a scan or a
   *  paste. A destination carrying its own amount skips both the input and
   *  amount steps, which are the only ones that pause for the user. */
  requireReview?: boolean;
}

export interface UseSendPaymentReturn {
  // State
  currentStep: SendStep;
  paymentInput: SendInput | null;
  amount: string;
  error: string | null;
  authorizationError: string | null;
  isLoading: boolean;
  prepareResponse: PrepareSendPaymentResponse | null;
  paymentResult: 'success' | 'failure' | 'unknown' | null;
  /** Completed SDK receipt for presentation only; never inferred from a timer. */
  completedPayment: Payment | null;
  balanceSats: number | undefined;
  tokenBalance: bigint | undefined;
  feesIncluded: boolean;
  processingPhase: ProcessingPhase;
  /** Presentation milestone: preparation versus actual SDK invocation. */
  transferStage: 'preparing' | 'processing';
  /** True when the destination carried its own amount (a BIP21 `amount` or a
   *  bolt11's embedded amount), so the amount step was skipped. Lets the confirm
   *  step send "back" to input instead of the amount step the user never saw. */
  amountFixed: boolean;
  tokenIdentifier: string | null;
  // Actions
  confirmDestination: (input: SendInput) => void;
  clearError: () => void;
  reset: () => void;
  cancelPendingInput: () => void;
  cancelAuthorization: () => void;
  processInput: (input?: string | null, opts?: ProcessInputOptions) => Promise<void>;
  onAmountNext: (amount: bigint, includeFees?: boolean, tokenIdentifier?: string, conversionOptions?: ConversionOptions) => Promise<void>;
  handleSend: (options?: SendPaymentOptions) => Promise<void>;
  handleRun: (runner: () => Promise<PaymentExecutionResult>, hasConversion?: boolean) => Promise<void>;
  setCurrentStep: (step: SendStep) => void;
  backToAmount: () => void;
}

export function useSendPayment(): UseSendPaymentReturn {
  const wallet = useWallet();
  const executionStarted = useRef(false);
  const inputGeneration = useRef(0);
  const preparedIdempotencyKey = useRef<string|undefined>(undefined);
  const executionPhase = useRef<'sending' | 'converting'>('sending');
  const authorizationPending = useRef(false);
  const authorizationCancelled = useRef(false);
  const walletInfo = useWalletInfo();
  const stableBalance = useStableBalance();

  const [currentStep, setCurrentStep] = useState<SendStep>('input');
  const [paymentInput, setPaymentInput] = useState<SendInput | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [authorizationError, setAuthorizationError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [prepareResponse, setPrepareResponse] = useState<PrepareSendPaymentResponse | null>(null);
  const [paymentResult, setPaymentResult] = useState<'success' | 'failure' | 'unknown' | null>(null);
  const [completedPayment,setCompletedPayment] = useState<Payment|null>(null);
  const [feesIncluded, setFeesIncluded] = useState(false);
  const [processingPhase, setProcessingPhase] = useState<ProcessingPhase>('sending');
  const [transferStage,setTransferStage]=useState<'preparing'|'processing'>('preparing');
  const [amountFixed, setAmountFixed] = useState(false);
  const [tokenIdentifier, setTokenIdentifier] = useState<string | null>(null);

  // An unmounted sheet or changed wallet cannot resume previous input work.
  useLayoutEffect(() => {
    const unsubscribe = subscribeSendAuthorization(wallet, authorizing => {
      if (executionStarted.current) {
        authorizationPending.current = authorizing;
        setProcessingPhase(authorizing ? 'authorizing' : executionPhase.current);
      }
    });
    return () => {
      inputGeneration.current += 1;
      authorizationCancelled.current = true;
      unsubscribe();
      cancelSendAuthorization(wallet);
    };
  }, [wallet]);

  const isCurrentInput = useCallback((generation: number) =>
    generation === inputGeneration.current && !executionStarted.current, []);

  // Balance is read live from the wallet info context, which is auto-refreshed
  // by useBreezSdk on `synced`/`paymentSucceeded`/`claimedDeposits` events. We
  // don't snapshot it locally — that was the bug that caused validation to use
  // a stale balance after auto-conversion completed mid-flow.
  const balanceSats = walletInfo?.balanceSats;
  const tokenBalance = useMemo<bigint | undefined>(() => {
    if (!walletInfo?.tokenBalances) return undefined;
    if (!stableBalance.isActive || !stableBalance.tokenIdentifier) return undefined;
    const tb = getTokenBalance(walletInfo.tokenBalances, stableBalance.tokenIdentifier);
    return tb ? tb.balance : 0n;
  }, [walletInfo, stableBalance.isActive, stableBalance.tokenIdentifier]);

  const reviewLightningFallback = useCallback(async (generation:number,recipient:string,amount:bigint,feePolicy?:FeePolicy) => {
    if(!isCurrentInput(generation))return;
    const parsed=await wallet.parse(recipient);
    if(!isCurrentInput(generation))return;
    if(gysRecipient(parsed)?.address!==recipient)throw new Error(DIRECT_UNAVAILABLE);
    const info=await wallet.getInfo({});
    await checkGysPaymentIntent(info.identityPubkey,request=>wallet.getPayment(request));
    if(!isCurrentInput(generation))return;
    preparedIdempotencyKey.current=undefined;
    setPaymentInput({rawInput:paymentInput?.rawInput??recipient,paymentRequest:recipient,parsedInput:parsed});
    setAmount(stableBalance.activeLabel?'':amount.toString());
    setFeesIncluded(!stableBalance.activeLabel&&feePolicy==='feesIncluded');
    setPrepareResponse(null);
    setError(null);
    setCurrentStep('workflow');
  },[wallet,isCurrentInput,paymentInput?.rawInput,stableBalance.activeLabel]);

  const prepareSend = useCallback(async (
    generation: number,
    paymentRequest: string,
    amount: bigint,
    feePolicy?: FeePolicy,
    tokenIdentifier?: string,
    conversionOptions?: ConversionOptions,
    // Step to return to if prepare fails. Defaults to the amount step; the
    // fixed-amount path skips amount entry and passes 'workflow' so the error
    // surfaces on the confirm step (with the send action disabled) instead.
    errorStep: SendStep = 'amount',
    directRecipient?: GysDirectRecipient,
  ) => {
    if (!isCurrentInput(generation)) return;
    if (amount <= 0n) {
      setError('Please enter a valid amount');
      return;
    }
    setIsLoading(true);
    setError(null);
    setAuthorizationError(null);
    try {
      let response:PrepareSendPaymentResponse;
      try{
        if(directRecipient){
          await revalidateGysRecipient(directRecipient,input=>wallet.parse(input));
          if(!isCurrentInput(generation))return;
        }
        response = await wallet.prepareSendPayment({
          paymentRequest: { type: 'input', input: paymentRequest },
          amount,
          feePolicy,
          tokenIdentifier,
          conversionOptions,
        });
      }catch(err){
        if(!directRecipient)throw err;
        await reviewLightningFallback(generation,directRecipient.lightningAddress,amount,feePolicy);
        return;
      }
      if (!isCurrentInput(generation)) return;
      if(directRecipient){
        validateGysQuote(directRecipient,response,true);
        if(response.paymentMethod.type==='sparkAddress'&&response.paymentMethod.fee>0n){
          await reviewLightningFallback(generation,directRecipient.lightningAddress,amount,feePolicy);
          return;
        }
      }
      preparedIdempotencyKey.current=directRecipient?crypto.randomUUID():undefined;
      setPrepareResponse(response);
      setCurrentStep('workflow');
    } catch (err) {
      if (!isCurrentInput(generation)) return;
      logger.error(LogCategory.PAYMENT, 'Failed to prepare payment', { error: formatError(err) });
      setError(directRecipient&&err instanceof Error?err.message:`Failed to prepare payment: ${err instanceof Error ? err.message : 'Unknown error'}`);
      // Clear any stale response so the confirm step renders its prepare-failed
      // fallback (error + disabled send) instead of an old success render.
      setPrepareResponse(null);
      setCurrentStep(errorStep);
    } finally {
      if (isCurrentInput(generation)) setIsLoading(false);
    }
  }, [wallet, isCurrentInput, reviewLightningFallback]);

  const processInput = useCallback(async (input: string | null = null, opts?: ProcessInputOptions) => {
    if (executionStarted.current) return;
    const generation = ++inputGeneration.current;
    const currentInput = (input || paymentInput?.rawInput)?.trim();
    if (!currentInput) {
      setError('Please enter a payment destination');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    // Re-evaluating a destination from scratch: drop the amount, fee choice, and
    // prepare response from any previous attempt so a re-submitted input (e.g. the
    // same URI with its amount removed) doesn't carry the old values forward.
    setAmount('');
    setAuthorizationError(null);
    setFeesIncluded(false);
    setAmountFixed(false);
    setPrepareResponse(null);

    try {
      const parseResult = await wallet.parse(currentInput);
      if (!isCurrentInput(generation)) return;

      // Unwrap a BIP21 URI (bitcoin:<addr>?amount=&label=) to its underlying
      // payment method. The URI amount (sats) is used as the exact send amount.
      let effective = parseResult;
      let prefillAmountSat: number | undefined;
      if (parseResult.type === 'bip21') {
        // Parser order is not a preference (the address always comes first).
        // Lightning wins, and Bolt11Workflow still settles it over Spark when
        // the invoice allows. A bare Spark address ranks last, below on-chain,
        // since Glow does not surface Spark to users.
        const method = (['bolt11Invoice', 'bitcoinAddress', 'sparkAddress'] as const)
          .map((type) => parseResult.paymentMethods.find((m) => m.type === type))
          .find(Boolean);
        if (!method) {
          setError('Invalid payment destination');
          setCurrentStep('input');
          return;
        }
        effective = method;
        prefillAmountSat = parseResult.amountSat;
      }

      // prepareSendPayment gets the bare destination the parser resolved, never
      // the text it came in. The SDK parses what it is handed but then decodes
      // the invoice from that same string, so a wrapper the parser accepts (a
      // BIP21 URI, or the `lightning:` prefix a QR code carries) reaches the
      // decoder and fails there (breez/glow-app#168). `rawInput` keeps the original text so
      // the input field still shows it on back-navigation.
      let paymentRequest = bareDestination(effective) ?? currentInput;
      const candidate=selectedNetwork()==='mainnet'?gysRecipient(effective):null;
      if(selectedNetwork()==='mainnet'&&isGysPaymentInput(effective)&&!candidate){
        setPaymentInput(null);
        setCurrentStep('input');
        throw new Error(DIRECT_UNAVAILABLE);
      }
      if(candidate){
        const info=await wallet.getInfo({});
        await checkGysPaymentIntent(info.identityPubkey,request=>wallet.getPayment(request));
        if(!isCurrentInput(generation))return;
      }
      // Token conversions retain the invoice workflow. The pinned SDK cannot
      // bind an idempotency key to a conversion, so direct transfers use BTC only.
      const directRecipient=candidate&&!stableBalance.activeLabel&&canTrackGysPayments()
        ?await resolveGysRecipient(candidate,value=>wallet.parse(value)):null;
      if(!isCurrentInput(generation))return;
      if(directRecipient){
        effective=await wallet.parse(directRecipient.sparkAddress);
        if(!isCurrentInput(generation))return;
        paymentRequest=directRecipient.sparkAddress;
      }

      const parsed: SendInput = { rawInput: currentInput, paymentRequest, parsedInput: effective,
        ...(directRecipient?{directRecipient}:{}) };
      setPaymentInput(parsed);

      // A fixed amount is always denominated in sats and must be paid exactly: a
      // bolt11 invoice's embedded amount, or a BIP21 `amount` parameter. Prepare
      // directly with that sats amount and skip amount entry (the same flow used for
      // amount-bearing bolt11 invoices). This also avoids the amount step's
      // stable-balance token denomination, where a sats prefill would be read as a
      // fiat value; the SDK applies any active stable-balance conversion to fund the
      // exact sats output.
      const invoiceSats =
        effective.type === 'bolt11Invoice' && effective.amountMsat && effective.amountMsat > 0
          ? Math.ceil(effective.amountMsat / 1000)
          : undefined;
      const fixedSats =
        invoiceSats ?? (prefillAmountSat && prefillAmountSat > 0 ? prefillAmountSat : undefined);
      const isPayableAmountType =
        effective.type === 'bolt11Invoice' ||
        effective.type === 'bitcoinAddress' ||
        effective.type === 'sparkAddress';

      if (isPayableAmountType && fixedSats !== undefined) {
        // Stay on the input step so the scanned or pasted destination is on
        // screen and Continue is a deliberate tap. Continue re-enters here
        // without the flag and prepares as usual.
        if (opts?.requireReview) {
          setCurrentStep('input');
          return;
        }
        setAmountFixed(true);
        setAmount(String(fixedSats));
        await prepareSend(generation, paymentRequest, BigInt(fixedSats), undefined, undefined, undefined, 'workflow');
      } else if (isPayableAmountType) {
        setAmountFixed(false);
        setCurrentStep('amount');
      } else if (effective.type === 'crossChainAddress') {
        setCurrentStep('destination');
      } else if (
        effective.type === 'lnurlPay' ||
        effective.type === 'lightningAddress' ||
        effective.type === 'lnurlAuth' ||
        effective.type === 'lnurlWithdraw'
      ) {
        setCurrentStep('workflow');
      } else {
        setError('Invalid payment destination');
        setCurrentStep('input');
      }
    } catch (err) {
      if (!isCurrentInput(generation)) return;
      logger.warn(LogCategory.PAYMENT, 'Failed to parse payment input', { error: formatError(err) });
      if(err instanceof Error&&[CHECK_PREVIOUS_PAYMENT,DIRECT_UNAVAILABLE].includes(err.message)){
        setError(err.message);
      }else if(/^[^\s@]+@[^\s@]+$/.test(currentInput)){
        const kind=classifyLookupFailure(err),text=trustCopy();
        setError(kind==='syntax'?text.lookupSyntax:kind==='notFound'?text.lookupNotFound:kind==='timeout'?text.lookupTimeout:text.lookupUnavailable);
      }else{
      setError(destinationErrorMessage(err, BAD_LOGIN_CODE.test(formatError(err))
        ? 'This login code is not valid. Refresh the site for a new one.'
        : 'Invalid payment destination'));
      }
    } finally {
      if (isCurrentInput(generation)) setIsLoading(false);
    }
  }, [wallet, paymentInput?.rawInput, prepareSend, isCurrentInput, stableBalance.activeLabel]);

  const parsedInputType = paymentInput?.parsedInput.type;
  const onAmountNext = useCallback(async (
    amount: bigint,
    includeFees?: boolean,
    tokenIdentifier?: string,
    conversionOptions?: ConversionOptions,
  ) => {
    if (executionStarted.current) return;
    const generation = ++inputGeneration.current;
    if (amount <= 0n) {
      setError('Please enter a valid amount');
      setIsLoading(false);
      return;
    }
    setFeesIncluded(!!includeFees);

    // Cross-chain: skip prepareSend, the workflow handles route selection + prepare
    if (parsedInputType === 'crossChainAddress') {
      setAmount(String(amount));
      setTokenIdentifier(tokenIdentifier ?? null);
      setCurrentStep('workflow');
      return;
    }

    await prepareSend(
      generation,
      paymentInput?.paymentRequest || '',
      amount,
      includeFees ? 'feesIncluded' : undefined,
      tokenIdentifier,
      conversionOptions,
      'amount',
      paymentInput?.directRecipient,
    );
  }, [paymentInput?.paymentRequest, paymentInput?.directRecipient, parsedInputType, prepareSend]);

  const handleSend = useCallback(async (options?: SendPaymentOptions) => {
    if (!prepareResponse || executionStarted.current) return;
    executionStarted.current = true;
    authorizationCancelled.current = false;
    authorizationPending.current = requiresSendAuthorization(wallet);
    const generation=inputGeneration.current;
    let directIntent:{identity:string;id:string}|undefined;
    // Recheck the exact destination before invoking any value-moving SDK operation.
    // A revoked or unavailable binding returns to review, never to a paid fallback.
    if(paymentInput?.directRecipient){
      setIsLoading(true);
      try{
        if(selectedNetwork()!=='mainnet')throw new Error('Recipient unavailable. Review the payment again.');
        await revalidateGysRecipient(paymentInput.directRecipient,input=>wallet.parse(input));
        validateGysQuote(paymentInput.directRecipient,prepareResponse);
        if(generation!==inputGeneration.current){executionStarted.current=false;return;}
        const info=await wallet.getInfo({});
        if(generation!==inputGeneration.current){executionStarted.current=false;return;}
        const id=preparedIdempotencyKey.current;
        if(!id)throw new Error('Recipient unavailable. Review the payment again.');
        await reserveGysPaymentIntent(info.identityPubkey,{id,recipient:paymentInput.directRecipient.lightningAddress,
          amount:prepareResponse.amount.toString(),createdAt:Date.now()},request=>wallet.getPayment(request));
        directIntent={identity:info.identityPubkey,id};
        if(generation!==inputGeneration.current){
          await finishGysPaymentIntent(directIntent.identity,id);
          executionStarted.current=false;return;
        }
      }catch(err){
        executionStarted.current=false;
        if(generation===inputGeneration.current){
          setError(err instanceof Error?err.message:'Recipient unavailable. Review the payment again.');
          setPrepareResponse(null);
          setCurrentStep('amount');
        }
        return;
      }finally{setIsLoading(false);}
    }
    setTransferStage('preparing');
    const hasConversion = !!prepareResponse.conversionEstimate;
    logger.info(LogCategory.PAYMENT, 'handleSend called', {
      hasConversion,
    });
    executionPhase.current = hasConversion ? 'converting' : 'sending';
    setProcessingPhase(requiresSendAuthorization(wallet) ? 'authorizing' : executionPhase.current);
    setCurrentStep('processing');
    setIsLoading(true);
    setError(null);
    setAuthorizationError(null);

    let listenerId: string | undefined;
    if (hasConversion) {
      try {
        const initialBalance = (await wallet.getInfo({}))?.balanceSats ?? 0;
        listenerId = await wallet.addEventListener({
          onEvent: async (event: SdkEvent) => {
            if (event.type === 'synced') {
              try {
                const currentBalance = (await wallet.getInfo({}))?.balanceSats ?? 0;
                if (currentBalance > initialBalance) {
                  logger.debug(LogCategory.PAYMENT, 'Conversion complete, balance increased', {
                    initialBalance,
                    currentBalance,
                  });
                  setProcessingPhase(current => current === 'authorizing' ? current : 'sending');
                }
              } catch { /* best-effort balance check */ }
            }
          },
        });
      } catch {
        // If listener setup fails, just stay on 'converting' — non-critical
      }
    }

    let authorizationFailed = false;
    try {
      if (authorizationCancelled.current) throw new SendAuthorizationError('cancelled');
      setTransferStage('processing');
      const request = { prepareResponse, options,
        ...(directIntent?{idempotencyKey:directIntent.id}:{}) };
      const directRecipient = paymentInput?.directRecipient;
      const outcome = directRecipient && requiresSendAuthorization(wallet)
        ? await sendPaymentWithValidation(wallet, request, async () => {
          // The OS prompt can outlive the original lookup. Check again after
          // authorization, immediately before the underlying SDK can send.
          try {
            if (generation !== inputGeneration.current || selectedNetwork() !== 'mainnet') throw new Error();
            await revalidateGysRecipient(directRecipient, input => wallet.parse(input));
            validateGysQuote(directRecipient, prepareResponse);
            if (generation !== inputGeneration.current) throw new Error();
          } catch { throw new SendAuthorizationError('changed'); }
        })
        : await wallet.sendPayment(request);
      if(directIntent){
        if(outcome?.payment?.id!==directIntent.id)throw new Error('Check payment history before sending again.');
        await finishGysPaymentIntent(directIntent.identity,directIntent.id,outcome.payment);
      }
      setPaymentResult(paymentOutcome(outcome));
      if(outcome?.payment?.status==='completed')notifyPaymentFeedback('success',outcome.payment.id);
      else if(outcome?.payment?.status==='failed')notifyPaymentFeedback('error',outcome.payment.id);
      setCompletedPayment(outcome?.payment?.status==='completed'?outcome.payment:null);
    } catch (err) {
      if (isSendAuthorizationError(err)) {
        // This typed refusal guarantees the underlying SDK was never called.
        if (directIntent) await finishGysPaymentIntent(directIntent.identity, directIntent.id);
        authorizationFailed = true;
        executionStarted.current = false;
        const copy = sendAuthorizationCopy(getAppLanguage());
        setAuthorizationError(err.reason === 'unavailable' ? copy.unavailable : err.reason === 'changed' ? copy.changed : copy.notSent);
        setPaymentResult(null);
        setCompletedPayment(null);
        return;
      }
      logger.error(LogCategory.PAYMENT, 'Payment failed', { error: formatError(err) });
      setError(`Payment failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      // An exception is not proof that a payment failed to settle.
      setPaymentResult('unknown');
    } finally {
      if (listenerId) {
        wallet.removeEventListener(listenerId).catch(() => {});
      }
      setProcessingPhase('sending');
      authorizationPending.current = false;
      setIsLoading(false);
      setCurrentStep(authorizationFailed ? 'workflow' : 'result');
    }
  }, [wallet, prepareResponse, paymentInput]);

  const handleRun = useCallback(async (runner: () => Promise<PaymentExecutionResult>, hasConversion?: boolean) => {
    if (executionStarted.current) return;
    executionStarted.current = true;
    authorizationCancelled.current = false;
    authorizationPending.current = requiresSendAuthorization(wallet);
    setTransferStage('preparing');
    executionPhase.current = hasConversion ? 'converting' : 'sending';
    setProcessingPhase(requiresSendAuthorization(wallet) ? 'authorizing' : executionPhase.current);
    setCurrentStep('processing');
    setIsLoading(true);
    setError(null);
    setAuthorizationError(null);

    let listenerId: string | undefined;
    if (hasConversion) {
      try {
        const initialBalance = (await wallet.getInfo({}))?.balanceSats ?? 0;
        listenerId = await wallet.addEventListener({
          onEvent: async (event: SdkEvent) => {
            if (event.type === 'synced') {
              try {
                const currentBalance = (await wallet.getInfo({}))?.balanceSats ?? 0;
                if (currentBalance > initialBalance) {
                  logger.debug(LogCategory.PAYMENT, 'Conversion complete, balance increased', {
                    initialBalance,
                    currentBalance,
                  });
                  setProcessingPhase(current => current === 'authorizing' ? current : 'sending');
                }
              } catch { /* best-effort balance check */ }
            }
          },
        });
      } catch {
        // If listener setup fails, just stay on 'converting' — non-critical
      }
    }

    let authorizationFailed = false;
    try {
      if (authorizationCancelled.current) throw new SendAuthorizationError('cancelled');
      setTransferStage('processing');
      const outcome = await runner();
      setPaymentResult(paymentOutcome(outcome));
      if(outcome?.payment?.status==='completed')notifyPaymentFeedback('success',outcome.payment.id);
      else if(outcome?.payment?.status==='failed')notifyPaymentFeedback('error',outcome.payment.id);
      setCompletedPayment(outcome?.payment?.status==='completed'?outcome.payment:null);
    } catch (err) {
      if (isSendAuthorizationError(err)) {
        authorizationFailed = true;
        executionStarted.current = false;
        const copy = sendAuthorizationCopy(getAppLanguage());
        setAuthorizationError(err.reason === 'unavailable' ? copy.unavailable : err.reason === 'changed' ? copy.changed : copy.notSent);
        setPaymentResult(null);
        setCompletedPayment(null);
        return;
      }
      logger.error(LogCategory.PAYMENT, 'Operation failed during payment flow', { error: formatError(err) });
      setError(`Operation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      // An exception is not proof that a payment failed to settle.
      setPaymentResult('unknown');
    } finally {
      if (listenerId) {
        wallet.removeEventListener(listenerId).catch(() => {});
      }
      setProcessingPhase('sending');
      authorizationPending.current = false;
      setIsLoading(false);
      setCurrentStep(authorizationFailed ? 'workflow' : 'result');
    }
  }, [wallet]);

  const reset = useCallback(() => {
    // Recipient changes can cancel lookups, never an authorized payment.
    if (executionStarted.current) return;
    inputGeneration.current += 1;
    setCurrentStep('input');
    setAmount('');
    setPrepareResponse(null);
    setError(null);
    setAuthorizationError(null);
    setIsLoading(false);
    setFeesIncluded(false);
    setPaymentInput(null);
    setPaymentResult(null);
    setCompletedPayment(null);
    setProcessingPhase('sending');
    setAmountFixed(false);
    setTokenIdentifier(null);
  }, []);

  const cancelPendingInput = useCallback(() => {
    if (executionStarted.current) return;
    inputGeneration.current += 1;
    setIsLoading(false);
  }, []);

  // Return to the amount step from the cross-chain workflow. Clears `amount`
  // first: cross-chain stores it as sats, but the amount step renders in
  // USD/token mode, so a stale sats value would show in the wrong unit
  // (e.g. "406 sats" rendered as "$406"). Start fresh instead.
  const backToAmount = useCallback(() => {
    setAmount('');
    setError(null);
    setAuthorizationError(null);
    setCurrentStep('amount');
  }, []);

  return {
    currentStep,
    paymentInput,
    amount,
    error,
    authorizationError,
    isLoading,
    prepareResponse,
    paymentResult,
    completedPayment,
    balanceSats,
    tokenBalance,
    feesIncluded,
    processingPhase,
    transferStage,
    amountFixed,
    tokenIdentifier,
    confirmDestination: useCallback((input: SendInput) => {
      if (executionStarted.current) return;
      inputGeneration.current += 1;
      setPaymentInput(input);
      setAmount('');
      setPrepareResponse(null);
      setError(null);
      setAuthorizationError(null);
      setIsLoading(false);
      setTokenIdentifier(null);
      setFeesIncluded(false);
      setCurrentStep('amount');
    }, []),
    clearError: useCallback(() => {setError(null); setAuthorizationError(null);}, []),
    reset,
    cancelPendingInput,
    cancelAuthorization: useCallback(() => {
      if (!authorizationPending.current) return;
      authorizationCancelled.current = true;
      cancelSendAuthorization(wallet);
    }, [wallet]),
    processInput,
    onAmountNext,
    handleSend,
    handleRun,
    setCurrentStep,
    backToAmount,
  };
}
