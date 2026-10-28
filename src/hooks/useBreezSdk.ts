import {readBrowserRecoveryReadiness} from '../security/browserRecoveryReadiness';
import {passkeyUnlockErrorMessage} from '../utils/passkeyUnlockFeedback';
import {notifyPaymentFeedback} from '../utils/transferHaptics';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { initLogging } from '@breeztech/breez-sdk-spark';
import type { BreezSdk, Config, DepositInfo, GetInfoResponse, LightningAddressInfo, LogEntry, Payment, SdkEvent, Seed } from '@breeztech/breez-sdk-spark';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { sdkReady } from '@/services/sdkReady';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { useLatest } from './useLatest';
import { buildConnectConfig, connectSdk } from '../services/sdkConnect';
import { logger, LogCategory, logSdkMessage } from '../services/logger';
import { formatError } from '../utils/formatError';
import { isStandalonePwa, openExternalUrl } from '../utils/externalLink';
import { splitClaimedDeposits } from '../utils/depositClaimQuote';
import { isDepositRejected, clearRejectedDeposits, clearClaimFees } from '../services/depositState';
import { setCachedStableTicker, clearNetworkOverride, clearStableRestorePrompted, ensureSparkPrivateMode, type BuyBitcoinProvider } from '../services/settings';
import { wipeAllLocalData } from '../services/accountDeletion';
import { hideSplash } from '../main';
import {
  prfAvailability,
  isPasskeyMode,
  setPasskeyMode,
  clearPasskeyMode,
  clearKnownCredentials,
  getKnownCredentialIdsBase64,
  hasPasskeyHistory,
  markLabelUsed,
  invalidatePasskey,
  pinActivePasskeyCredentialId,
  signInPinnedToActiveCredential,
  setPendingSwitchFromCredentialId,
  getPasskeyRpId,
  setPasskeyRpId,
  isMigrationInProgress,
  isPasskeyMigrated,
} from '../services/passkeyService';
import { LEGACY_RP_ID, SHARED_RP_ID, rpId as defaultRpId } from '../services/passkeyPrfProvider';
import { secureStorage, deviceOnlyStorage, SecureStorageError, resetSecureStorageInit } from '../services/secureStorage';
import {
  assertNativeWalletSwitchAllowed, chooseNativeSeedTier, prepareNativeSeedConnection, readSelectedNativeSeed, resetNativeSeedSelection,
  setActiveNativeSeedWallet, setNativeSeedTier,
} from '../services/nativeSeedSelection';
import {
  getSavedMnemonic,
  clearMnemonic,
  migrateLegacyMnemonicIfNeeded,
} from '../services/legacyMnemonicMigration';
import { isSendSheetOpen } from '../features/send/sendSheetVisibility';
import { clearPin, isAppLockSupported } from '../services/appLock';
import {hasWebWalletVault,hasLegacyWebMnemonic,clearUnlockedWebMnemonic,getUnlockedWebMnemonic} from '../security/webWalletVault';
import {clearSignerIdentity,assertCurrentSession,getSpendingSessionEpoch,matchesSignerIdentity,lockSpendingSession} from '../security/spendApproval';
import {stopBrowserSdk} from '../security/browserSdkLifetime';
import {getOperationReconciliation} from '../security/operationGateway';
import { hasConversionInFlight } from '../contexts/WalletContext';
import { isConversionPayment } from '../utils/paymentDescription';
import {newlyCompletedReceive,rememberPaymentId} from '../getyoursats/paymentMomentPolicy';
import { unsettledDeposits } from '../utils/depositHelpers';
import {assertNoExitRecordsForRemoval} from '../features/unilateral-exit/removalProtection';
import {featureAvailability} from '../getyoursats/featureAvailability';
import {assertNativeLightningAddress, withNativeLightningSession} from '../services/nativeLightningSession';

// ============================================
// Payment filtering
// ============================================

/** Filter out ongoing payment conversions not yet linked */
function filterOngoingConversionPayments(payments: Payment[]): Payment[] {
  return payments.filter(p => {
    const conversionInfo = p.details &&
      'conversionInfo' in p.details ? p.details.conversionInfo : null;
    if (!conversionInfo || conversionInfo.type !== 'amm') return true;
    return conversionInfo.purpose?.type !== 'ongoingPayment';
  });
}

// ============================================
// SDK logging (initialized once)
// ============================================

let sdkLoggerInitialized = false;
const NATIVE_KEY_RECOVERY_MESSAGE = 'This device can no longer unlock the saved wallet. Your wallet data has been kept. Recover this same wallet with its recovery phrase or passkey before choosing to erase local data.';

async function initSdkLogging() {
  if (sdkLoggerInitialized) return;
  sdkLoggerInitialized = true;
  // initLogging is a WASM call; wait for the module. Runs on mount, so this
  // must not assume the SDK is already initialized now that boot is deferred.
  // The logging bridge is non-critical, so a failed SDK init is swallowed here
  // (the connect path surfaces the real error to the user).
  try {
    await sdkReady();
    // No filter, so the SDK default applies: DEBUG for its own crates.
    // Support cases turn on payment-level lines that only exist at DEBUG,
    // and a released build cannot be asked to raise the level after the
    // fact because `initLogging` binds the filter once per page load.
    // Secret-shaped values are scrubbed on the way into the buffer.
    initLogging({ log: (entry: LogEntry) => logSdkMessage(entry.level, entry.line) });
  } catch {
    /* SDK unavailable; skip the log bridge. */
  }
}

// ============================================
// Types
// ============================================

/**
 * Coarse-grained state machine for startup / lock screen routing:
 * - `'loading'`: mount, auto-reconnect in progress (spinner).
 * - `'no-wallet'`: no credentials persisted (welcome / onboarding).
 * - `'native-unlocking'`: auth ceremony in flight (biometric on native,
 *   WebAuthn on web). Router shows branded UnlockingPage placeholder.
 * - `'native-locked'`: unlock failed or recovery is needed (interactive
 *   UnlockPage with retry and an explicitly confirmed reset).
 * - `'connected'`: SDK is connected to a wallet.
 */
export type StartupState =
  | 'loading'
  | 'no-wallet'
  | 'native-unlocking'
  | 'native-locked'
  | 'web-vault-enroll'
  | 'web-vault-locked'
  | 'connected';

export interface BreezSdkState {
  sdk: BreezSdk | null;
  nativeLightningAddress: LightningAddressInfo | null;
  isConnected: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  walletInfo: GetInfoResponse | null;
  transactions: Payment[];
  hasPendingConversion: boolean;
  unclaimedDeposits: DepositInfo[];
  config: Config | null;
  error: string | null;
  hasRejectedDeposits: boolean;
  celebrationPayment: Payment | null;
  /**
   * True when the connected wallet is on the legacy RP ID while a distinct shared
   * RP ID is configured and migration hasn't been done/skipped. Drives the
   * migration banner. Only ever true when SHARED_RP_ID is configured.
   */
  needsPasskeyMigration: boolean;
  prfAvailable: boolean;
  hasPasskeyBefore: boolean;
  /**
   * True on the first app session after a fresh install (or
   * cross-device Apple-ID restore), set when the startup probe
   * restores `passkeyRegistered` from the iCloud-synced keychain.
   * PasskeyPage consumes this once to allow ONE silent retry of the
   * detecting phase: credential-ID metadata syncs faster than the
   * actual passkey records, so the first assertion can fast-fail with
   * no Face ID prompt; the retry bridges that window.
   */
  isFreshInstallRestore: boolean;
  startupState: StartupState;
}

export type SdkEventHandler = (event: SdkEvent) => void;
export type SdkEventUnsubscribe = () => void;

/**
 * Where the seed handed to `connectWallet` came from. Gates the
 * post-connect persist block: `'onboarding'` writes to secure storage,
 * `'secureStorage'` skips it (the seed was just retrieved from there).
 */
export type ConnectSeedSource = 'onboarding' | 'secureStorage';

export interface BreezSdkActions {
  /** Reconnect a locked browser SDK with freshly authenticated, identical seed material. */
  resumeBrowserWallet:(seed:Seed)=>Promise<number>;
  claimNativeLightningAddress: (username: string) => Promise<LightningAddressInfo>;
  connectWallet: (
    seed: Seed,
    restore: boolean,
    passkeyLabel?: string,
    source?: ConnectSeedSource,
  ) => Promise<BreezSdk | null>;
  /** Resolve false when the SDK read failed; both log internally and keep last-known state. */
  /** Observe provider state without submitting operations when observeLive is true. */
  refreshWalletData: (showLoading?: boolean, observeLive?: boolean) => Promise<boolean>;
  fetchUnclaimedDeposits: () => Promise<boolean>;
  /**
   * Logs out and erases all on-device data: SDK databases, Preferences,
   * localStorage, the device credential-id registry, and the in-memory
   * log buffer. Signing back in is a fresh passkey discovery.
   */
  handleLogout: () => Promise<void>;
  /**
   * Adopt the (already connected + synced) new SDK produced by the passkey-RP
   * migration as the active wallet, keeping mnemonic / stable-ticker / network
   * state since it is the same wallet from the user's view.
   */
  adoptMigratedSdk: (newSdk: BreezSdk, label: string) => Promise<void>;
  handleBuyBitcoin: (provider: BuyBitcoinProvider) => Promise<void>;
  clearError: () => void;
  dismissCelebration: () => void;
  subscribeToSdkEvents: (handler: SdkEventHandler) => SdkEventUnsubscribe;
  /**
   * Read `isFreshInstallRestore` and atomically flip it to false so
   * the silent retry only fires on the first sign-in attempt of a
   * post-fresh-install session.
   */
  consumeFreshInstallSignal: () => boolean;
  /**
   * Called from `UnlockPage` to retry the biometric unlock after an earlier
   * cancel or lockout. Re-runs `secureStorage.retrieveSeed` then
   * `connectWallet` and updates `startupState` based on the outcome.
   */
  retryUnlock: () => Promise<void>;
  /**
   * Disconnect, derive the new wallet via passkey, reconnect with it.
   * Throws on PRF cancel / network failure / SDK error.
   */
  switchPasskeyLabel: (newLabel: string) => Promise<void>;
  /** Dev tool: re-derive the current label under `newRpId` and reconnect immediately. */
  switchPasskeyRp: (newRpId: string) => Promise<void>;
  /**
   * Pin a different passkey credential for the next sign-in and clear
   * the active SDK session + label so the caller can route through
   * PasskeyPage (which runs label discovery against the new cred's
   * Nostr identity). Does not run any biometric ceremony itself.
   *
   * The optional `onPinned` callback fires synchronously after the
   * localStorage pin but BEFORE the SDK is nulled, so callers can
   * navigate away from layers that depend on `useWallet()` (e.g.
   * SettingsPage under PasskeyManagementPage) before the SDK
   * disappears, avoiding a transient render with `sdk = null` while
   * those layers are still mounted.
   */
  prepareSwitchPasskeyCredential: (newCredId: string, onPinned?: () => void) => Promise<void>;
}

// ============================================
// Hook
// ============================================

export function useBreezSdk(
  showToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void,
): BreezSdkState & BreezSdkActions {
  // Core state
  const [sdk, setSdk] = useState<BreezSdk | null>(null);
  const [nativeAddressState, setNativeAddressState] = useState<{
    sdk: BreezSdk; address: LightningAddressInfo | null; lookupFailed: boolean;
  } | null>(null);
  const nativeLightningAddress = nativeAddressState?.sdk === sdk ? nativeAddressState.address : null;
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [walletInfo, setWalletInfo] = useState<GetInfoResponse | null>(null);
  const [transactions, setTransactions] = useState<Payment[]>([]);
  // Any payment in the latest snapshot that's still mid-conversion (e.g.
  // auto-conversion in flight after a receive). While true, balances are in
  // motion and Send All flows shouldn't trust the snapshot. Recomputed per
  // snapshot, so the age bound clears on the next refresh rather than on a timer.
  const hasPendingConversion = useMemo(
    () => hasConversionInFlight(transactions),
    [transactions],
  );
  const [unclaimedDeposits, setUnclaimedDeposits] = useState<DepositInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [hasRejectedDeposits, setHasRejectedDeposits] = useState(false);
  const [celebrationPayment, setCelebrationPayment] = useState<Payment | null>(null);
  const [needsPasskeyMigration, setNeedsPasskeyMigration] = useState(false);
  const [prfAvailable, setPrfAvailable] = useState(false);
  const [startupState, setStartupState] = useState<StartupState>('loading');

  // Refs
  const isInitialLoadRef = useRef(true);
  const eventListenerIdRef = useRef<string | null>(null);
  const shownPaymentIdsRef = useRef<Set<string>>(new Set());
  const hasCompletedPaymentSnapshotRef = useRef(false);
  const sdkRef = useLatest(sdk);
  // Guards the retryUnlock flow against concurrent invocation. The
  // app-resume listener and checkForExistingWallet both try to fire
  // retryUnlock on their own schedules, and BiometricPrompt crashes
  // if authenticate() is called while another prompt is already live.
  const retryUnlockInFlightRef = useRef(false);
  const nativeClaimInFlightRef = useRef<number | null>(null);
  const nativeWalletEpochRef = useRef(0);
  // A response for an old wallet, unlock or read must never overwrite the active UI.
  const walletReadRevisionRef = useRef(0);
  const depositsReadRevisionRef = useRef(0);
  const nativeReadRevisionRef = useRef(0);
  const nativeSessionSdkRef = useRef<BreezSdk | null>(null);

  // In-app event bus: feature hooks subscribe here instead of creating their
  // own SDK-level listeners, so we only ever register one listener per SDK.
  const eventSubscribersRef = useRef<Set<SdkEventHandler>>(new Set());
  const subscribeToSdkEvents = useCallback<BreezSdkActions['subscribeToSdkEvents']>(
    (handler) => {
      eventSubscribersRef.current.add(handler);
      return () => {
        eventSubscribersRef.current.delete(handler);
      };
    },
    []
  );

  // Stable refs for callbacks used in event handler
  const showToastRef = useLatest(showToast);
  const isSyncingRef = useLatest(isSyncing);

  // ----------------------------------------
  // Data fetching (uses sdkRef for latest SDK)
  // ----------------------------------------

  const refreshWalletData = useCallback(async (showLoading = true, observeLive = false) => {
    const s = sdkRef.current;
    if (!s) return false;
    const walletEpoch=nativeWalletEpochRef.current;
    const sessionEpoch=getSpendingSessionEpoch();
    const revision=++walletReadRevisionRef.current;
    const current=()=>sdkRef.current===s&&nativeWalletEpochRef.current===walletEpoch&&
      getSpendingSessionEpoch()===sessionEpoch&&walletReadRevisionRef.current===revision;
    try {
      if (showLoading) setIsLoading(true);
      if (observeLive && !Capacitor.isNativePlatform()) {
        // Explicit observation can refresh provider balances and history without
        // active SDK sync, claims, sends or unilateral exit construction.
        const reconciliation=getOperationReconciliation(s);
        if(!reconciliation)throw new Error('Read-only wallet observation is unavailable');
        await reconciliation.observe();
        if(!current())return false;
      }
      const [info, txns] = await Promise.all([
        s.getInfo({ensureSynced:false}),
        s.listPayments({ offset: 0, limit: 100 }),
      ]);
      if(!current())return false;
      // Commit both values only for the same live wallet and latest read.
      setWalletInfo(info);
      const newReceipt = newlyCompletedReceive(
        txns.payments, shownPaymentIdsRef.current, hasCompletedPaymentSnapshotRef.current
      );
      hasCompletedPaymentSnapshotRef.current = true;
      setTransactions(filterOngoingConversionPayments(txns.payments));
      if (newReceipt && !isMigrationInProgress()) setCelebrationPayment(newReceipt);
      return true;
    } catch (e) {
      if(!current())return false;
      logger.error(LogCategory.SDK, 'Error refreshing wallet data', { error: formatError(e) });
      setError('Could not refresh wallet data. Your previous wallet records are preserved.');
      return false;
    } finally {
      if (showLoading&&current()) setIsLoading(false);
    }
  }, [sdkRef]);

  const fetchUnclaimedDeposits = useCallback(async () => {
    const s = sdkRef.current;
    if (!s) return false;
    const walletEpoch=nativeWalletEpochRef.current;
    const sessionEpoch=getSpendingSessionEpoch();
    const revision=++depositsReadRevisionRef.current;
    const current=()=>sdkRef.current===s&&nativeWalletEpochRef.current===walletEpoch&&
      getSpendingSessionEpoch()===sessionEpoch&&depositsReadRevisionRef.current===revision;
    try {
      const result = await s.listUnclaimedDeposits({});
      if(!current())return false;
      const deposits = unsettledDeposits(result.deposits);
      setUnclaimedDeposits(deposits);
      setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
      return true;
    } catch (e) {
      if(!current())return false;
      // Keep pending deposit records visible when a read fails.
      logger.warn(LogCategory.SDK, 'Failed to fetch unclaimed deposits', { error: formatError(e) });
      return false;
    }
  }, [sdkRef]);

  // ----------------------------------------
  // SDK event handler
  // ----------------------------------------

  const handleSdkEvent = useCallback((event: SdkEvent) => {
    logger.debug(LogCategory.SDK, 'SDK event received', { eventType: event.type });

    if (event.type === 'synced') {
      if (isSyncingRef.current) {
        logger.info(LogCategory.SESSION, 'Restoration sync complete; hiding overlay');
        setIsSyncing(false);
      }
      document.body.setAttribute('data-wallet-synced', 'true');
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    } else if (event.type === 'paymentSucceeded') {
      const paymentId = event.payment.id;
      const alreadyShown = shownPaymentIdsRef.current.has(paymentId);
      // Identifiers only: the full payment carries the preimage and the
      // bolt11, and these logs end up in user-shared archives.
      logger.debug(LogCategory.PAYMENT, 'Payment succeeded event received', {
        alreadyShown,
        paymentId,
        paymentType: event.payment.paymentType,
        method: event.payment.method,
      });
      if (!alreadyShown) {
        if(event.payment.status==='completed'&&!isConversionPayment(event.payment)&&!isMigrationInProgress())notifyPaymentFeedback('success',paymentId);
        // Keep payment IDs for this active wallet session. A 30-second
        // expiration let a subsequent SDK sync replay the same success.
        rememberPaymentId(shownPaymentIdsRef.current, paymentId);

        const isReceived = event.payment.paymentType === 'receive';
        const isConversion = isConversionPayment(event.payment);

        if (!isConversion && isReceived && !isMigrationInProgress()) {
          setCelebrationPayment(event.payment);
        }
        // A send normally reports itself through the sheet's ResultStep, so
        // nothing fires here. But the sheet is dismissible mid-payment and
        // the SDK call outlives it, and an unreported SUCCESS is the
        // dangerous direction: the user assumes it failed and sends again.
        // Reuse the same celebration when the sheet is no longer on screen.
        if (!isConversion && !isReceived && !isSendSheetOpen() && !isMigrationInProgress()) {
          setCelebrationPayment(event.payment);
        }
      }
      refreshWalletData(false);
    } else if (event.type === 'newDeposits') {
      // The earliest the app hears about a deposit, well before a sync reports
      // it, so this is what puts one on screen while it is still unconfirmed.
      logger.info(LogCategory.PAYMENT, 'New deposits event: refreshing deposits', {
        count: event.newDeposits.length,
      });
      fetchUnclaimedDeposits();
    } else if (event.type === 'paymentPending') {
      logger.info(LogCategory.PAYMENT, 'Payment pending event received', {
        paymentId: event.payment.id,
        paymentType: event.payment.paymentType,
        method: event.payment.method,
      });
    } else if (event.type === 'paymentFailed') {
      const protectedBrowser=!!sdkRef.current&&!Capacitor.isNativePlatform()&&
        getOperationReconciliation(sdkRef.current)!=null;
      // A generic SDK failure is not proof that funds were returned.
      if(!protectedBrowser&&event.payment.status==='failed'&&!isConversionPayment(event.payment)&&!isMigrationInProgress())
        notifyPaymentFeedback('error',event.payment.id);
      logger.info(LogCategory.PAYMENT, 'Payment failed event received', {
        paymentId: event.payment.id,
        paymentType: event.payment.paymentType,
        method: event.payment.method,
      });
      // Same reasoning as the send celebration above: with the sheet gone
      // there is nothing else to tell the user the payment did not go out.
      if (event.payment.paymentType === 'send' && !isSendSheetOpen()) {
        if(protectedBrowser){
          showToastRef.current('info', 'Check payment status',
            'The outcome is not yet verified. Do not repeat this payment until its status is reconciled.');
        }else{
          showToastRef.current('error', 'Payment Failed', 'Please verify the payment status before sending again.');
        }
      }
    } else if (event.type === 'paymentMetadataUpdated') {
      // A cross-chain receive lands as a plain Spark transfer and is marked as
      // cross-chain once the provider confirms the order, so the row needs
      // reading again to pick up what it is.
      logger.debug(LogCategory.PAYMENT, 'Payment metadata updated', { paymentId: event.payment.id });
      refreshWalletData(false);
    } else if (event.type === 'claimedDeposits') {
      // An instant (0-conf) claim fires this event on submission, before the
      // funds are credited, so the log counts the two apart.
      const { submitted, settled } = splitClaimedDeposits(event.claimedDeposits);
      logger.info(LogCategory.PAYMENT, 'Deposits claimed', {
        settled,
        submitted: submitted.length,
      });
      refreshWalletData(false);
      fetchUnclaimedDeposits();
    } else if (event.type === 'unclaimedDeposits') {
      logger.warn(LogCategory.PAYMENT, 'Claim deposits failed', { remaining: event.unclaimedDeposits.length });
      showToastRef.current('error', 'Failed to Claim Deposits', `${event.unclaimedDeposits.length} deposits could not be claimed`);
      fetchUnclaimedDeposits();
    }

    // Fan out to feature subscribers. Each handler is isolated so one throwing
    // does not prevent the others from running.
    eventSubscribersRef.current.forEach((handler) => {
      try {
        handler(event);
      } catch (e) {
        logger.error(LogCategory.SDK, 'SDK event subscriber threw', { error: formatError(e) });
      }
    });
  }, [refreshWalletData, fetchUnclaimedDeposits, isSyncingRef, showToastRef]);

  // ----------------------------------------
  // Connection lifecycle
  // ----------------------------------------

  const recoverNativeAddress = useCallback(async (client: BreezSdk, seed: Seed, cfg: Config, epoch: number) => {
    if (!featureAvailability.nativeLightningAddress || cfg.network !== 'mainnet' || !cfg.apiKey) return;
    if (epoch !== nativeWalletEpochRef.current || nativeSessionSdkRef.current !== client) return;
    const revision = ++nativeReadRevisionRef.current;
    try {
      const identity = await client.getInfo({ensureSynced: false});
      const address = await withNativeLightningSession({
        seed, apiKey: cfg.apiKey, expectedIdentityPubkey: identity.identityPubkey,
        ensureActive: () => {
          if (epoch !== nativeWalletEpochRef.current || nativeSessionSdkRef.current !== client) throw new Error('Wallet session changed');
        },
        use: async session => session.address,
      });
      if (epoch === nativeWalletEpochRef.current && revision === nativeReadRevisionRef.current && nativeSessionSdkRef.current === client) {
        setNativeAddressState({sdk: client, address, lookupFailed: false});
        if (address) setNeedsPasskeyMigration(false);
      }
    } catch {
      // A failed native lookup cannot allocate a native replacement. The
      // separate anonymous Breez address remains available as usual.
      if (epoch === nativeWalletEpochRef.current && revision === nativeReadRevisionRef.current && nativeSessionSdkRef.current === client) {
        setNativeAddressState({sdk: client, address: null, lookupFailed: true});
        setNeedsPasskeyMigration(false);
      }
      logger.warn(LogCategory.SDK, 'Could not recover the branded Lightning address');
    }
  }, []);

  const connectInFlightRef=useRef(false);
  const connectWallet = useCallback(async (
    seed: Seed,
    restore: boolean,
    passkeyLabel?: string,
    source: ConnectSeedSource = 'onboarding',
  ) => {
    if(connectInFlightRef.current)throw new Error('Wallet connection is already in progress.');
    connectInFlightRef.current=true;
    let connectedSdk: BreezSdk | undefined;
    const createStart = performance.now();
    try {
      logger.info(LogCategory.SDK, 'Initiating wallet connection', { restore });
      if (sdk) {
        logger.debug(LogCategory.SDK, 'Wallet already connected; skipping');
        return null;
      }
      if (Capacitor.isNativePlatform()) {
        if (source === 'secureStorage') seed = await prepareNativeSeedConnection(seed);
        else await assertNativeWalletSwitchAllowed();
      }
      const connectionEpoch = ++nativeWalletEpochRef.current;

      // Browser manual wallets must have a verified encrypted vault before
      // SDK connection. Never silently fall back to plaintext persistence.
      if (!Capacitor.isNativePlatform() && passkeyLabel == null
        && seed.type === 'mnemonic' && !hasWebWalletVault())
        throw new Error('Protect the wallet with a password before connecting.');
      setIsLoading(true);
      setIsSyncing(restore);
      setError(null);

      void initSdkLogging();
      logger.info(LogCategory.PERF, '[onboarding] connect.begin', { restore, source });

      // WASM is initialized lazily now (services/sdkReady). connectWallet is the
      // first guaranteed SDK use (buildConnectConfig -> defaultConfig, then
      // connect), so wait for the module here. Usually already resolved.
      await sdkReady();
      let cfg: Config;
      try {
        cfg = buildConnectConfig();
      } catch (e) {
        // Only a missing key gets this message. Any other config error takes
        // the connect failure path, so onboarding does not carry on unconnected.
        // Do not silently return: a wallet page must never open without a
        // connected SDK. The outer catch handles cleanup and error state.
        showToast('error', 'Wallet service unavailable', 'Please try again once wallet connectivity is configured.');
        throw e;
      }
      setConfig(cfg);

      // connectSdk() = Spark auth + initial wallet sync (no Nostr; the label
      // publish was already kicked off, fire-and-forget, inside register()).
      connectedSdk = await logger.time('[onboarding] sdk.connect', () =>
        connectSdk({ config: cfg, seed, storageDir: 'spark-wallet-example' }));
      nativeSessionSdkRef.current = connectedSdk;
      if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(connectedSdk, cfg.network);
      if(Capacitor.isNativePlatform())setSdk(connectedSdk);
      const browserEpoch=getSpendingSessionEpoch();
      const assertConnectionCurrent=()=>{
        if(nativeWalletEpochRef.current!==connectionEpoch||nativeSessionSdkRef.current!==connectedSdk)throw new Error('Wallet connection changed while loading recovery data');
        if(!Capacitor.isNativePlatform())assertCurrentSession(browserEpoch);
      };

      logger.sdkInitialized();
      logger.authSuccess(passkeyLabel != null ? 'passkey' : seed.type);
      logger.info(LogCategory.SDK, 'Wallet connected successfully');

      // Non-sensitive marker so the legacy path can still detect
      // passkey mode if secure storage is unavailable later
      // (KEY_INVALIDATED on biometric change).
      if (passkeyLabel != null) {
        // Persist the RP ID this wallet was derived under so the next
        // sign-in/resume targets the same one. Resume backfills the stored
        // value before calling connectWallet; a fresh connect (no stored RP
        // ID yet) records the default (shared when configured, else legacy).
        setPasskeyMode(passkeyLabel, getPasskeyRpId() ?? defaultRpId);
        markLabelUsed(passkeyLabel);
        // Offer migration when this wallet is still on the legacy RP ID and a
        // distinct shared RP ID is configured and not yet migrated/skipped.
        const onLegacyRp = (getPasskeyRpId() ?? LEGACY_RP_ID) === LEGACY_RP_ID;
        // Migration is a web-only flow (the modal uses the browser passkey
        // client); native keeps its fixed RP ID and never migrates.
        setNeedsPasskeyMigration(
          !Capacitor.isNativePlatform() && !!SHARED_RP_ID && SHARED_RP_ID !== LEGACY_RP_ID && !isPasskeyMigrated() && onLegacyRp,
        );
      }

      // Persist the seed. Skip entirely when it was just retrieved from
      // the native vault. Native => device-only tier, always (silent
      // launch; PIN/biometric gating is app-level, see appLock.ts).
      // Web passkey => no cache, web non-passkey => plaintext fallback.
      // Failures are non-fatal: the wallet is already connected, and
      // the storage layer emits its own typed breadcrumb.
      if (source !== 'secureStorage') {
        if (deviceOnlyStorage.isSupported()) {
          try {
            await deviceOnlyStorage.storeSeed(seed);
            setNativeSeedTier('device');
          } catch (e) {
            // Safety: never mark an unrecoverable, unpersisted native wallet
            // as connected. The catch below disconnects the SDK.
            showToast('error', 'Secure wallet storage failed',
              'This device cannot safely preserve your wallet. No funds should be deposited.');
            throw e;
          }
        } else if (passkeyLabel != null) {
          // Web passkey mode: never cache the PRF-derived seed.
          clearMnemonic();
        } else if (seed.type === 'mnemonic') {
          if (!hasWebWalletVault()) throw new Error('Wallet password protection is required');
          // Browser vault is already encrypted and verified by onboarding.
          // Do not persist the plaintext mnemonic.
        }
      }

      // Load local balance, history, deposits and recovery records before
      // publishing a browser connection. These are local-read readiness checks,
      // not proof of authoritative provider settlement or complete history.
      // Rendering without them flashes
      // the "No payments" empty state on every startup (#301). Only the native
      // path retains its previous non-fatal read behavior.
      // Matches adoptMigratedSdk / reconnectWithDerivedWallet ordering.
      try {
        const browserState=Capacitor.isNativePlatform()?null:
          await readBrowserRecoveryReadiness(connectedSdk!,cfg.network,assertConnectionCurrent);
        const [info, txns] = browserState?[browserState.info,{payments:browserState.payments}]:
          await logger.time('[onboarding] sdk.getInfoAndPayments', () => Promise.all([
            connectedSdk!.getInfo({ensureSynced:false}),connectedSdk!.listPayments({offset:0,limit:100}),
          ]));
        assertConnectionCurrent();
        if(browserState){
          const deposits=unsettledDeposits(browserState.deposits);
          setUnclaimedDeposits(deposits);
          setHasRejectedDeposits(deposits.some(d=>isDepositRejected(d.txid,d.vout)));
        }
        setWalletInfo(info);
        const newReceipt = newlyCompletedReceive(
        txns.payments, shownPaymentIdsRef.current, hasCompletedPaymentSnapshotRef.current
      );
      hasCompletedPaymentSnapshotRef.current = true;
      setTransactions(filterOngoingConversionPayments(txns.payments));
      // Newly settled receives sometimes arrive via sync after a PWA resumes,
      // without a foreground paymentSucceeded event. Initial history is silent.
      if (newReceipt && !isMigrationInProgress()) setCelebrationPayment(newReceipt);
        logger.info(LogCategory.SDK, 'Connected wallet identity', {
          identityPubkey: info.identityPubkey,
          label: passkeyLabel ?? null,
        });
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Initial wallet data load failed', { error: formatError(e) });
        if(!Capacitor.isNativePlatform())throw e;
      }

      await recoverNativeAddress(connectedSdk, seed, cfg, connectionEpoch);
      assertConnectionCurrent();
      if(!Capacitor.isNativePlatform())setSdk(connectedSdk);
      setIsConnected(true);
      setStartupState('connected');
      setIsLoading(false);
      // Total covers connect + persist + the local reads above; deposits
      // load in the background below. Add the earlier passkey.register/
      // signIn time for the full button-tap-to-usable figure.
      logger.info(LogCategory.PERF, '[onboarding] connect.total', {
        ms: Math.round(performance.now() - createStart),
      });

      if(Capacitor.isNativePlatform())void (async () => {
        try {
          const result = await connectedSdk!.listUnclaimedDeposits({});
          const deposits = unsettledDeposits(result.deposits);
          setUnclaimedDeposits(deposits);
          setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
        } catch (e) {
          logger.warn(LogCategory.SDK, 'Failed to fetch unclaimed deposits', { error: formatError(e) });
        }
      })();
      return connectedSdk;
    } catch (e) {
      const errorMsg = formatError(e);
      logger.error(LogCategory.SDK, 'Error connecting wallet', { error: errorMsg });
      logger.authFailure(passkeyLabel != null ? 'passkey' : seed.type, errorMsg);

      // If SDK connected but a subsequent step failed, disconnect to avoid leaked instance
      if (connectedSdk) {
        nativeSessionSdkRef.current = null;
        if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(null);
        try { await connectedSdk.disconnect(); } catch { /* best-effort cleanup */ }
        setSdk(null);
      }

      if(!Capacitor.isNativePlatform()){
        setIsConnected(false);
        setStartupState(hasWebWalletVault()?'web-vault-locked':isPasskeyMode()?'native-locked':'no-wallet');
        clearUnlockedWebMnemonic();lockSpendingSession('Browser recovery connection did not complete');
      }
      setError('Failed to connect wallet. Please try again.');
      setIsSyncing(false);
      setIsLoading(false);
      setConfig(null);
      throw e;
    }finally{connectInFlightRef.current=false;}
  }, [sdk, showToast, recoverNativeAddress]);

  const claimNativeLightningAddress = useCallback(async (input: string): Promise<LightningAddressInfo> => {
    const activeSdk = sdkRef.current;
    if (!featureAvailability.nativeLightningAddress || config?.network !== 'mainnet' || !config.apiKey
      || !activeSdk || !isConnected || nativeSessionSdkRef.current !== activeSdk) {
      throw new Error('GetYourSats names are not available yet. Please try again later.');
    }
    const username = input.trim().toLowerCase();
    if (!/^[a-z][a-z0-9]{2,23}$/.test(username)) {
      throw new Error('Use 3 to 24 lowercase letters or numbers, starting with a letter.');
    }
    const epoch = nativeWalletEpochRef.current;
    if (nativeClaimInFlightRef.current === epoch) throw new Error('A Lightning name request is already in progress.');
    nativeClaimInFlightRef.current = epoch;
    nativeReadRevisionRef.current++;
    const ensureActive = () => {
      if (nativeWalletEpochRef.current !== epoch || sdkRef.current !== activeSdk || nativeSessionSdkRef.current !== activeSdk) {
        throw new Error('Your active wallet changed. Please reopen Email Verification.');
      }
    };
    try {
      const identity = await activeSdk.getInfo({ensureSynced: false});
      ensureActive();
      let seed: Seed;
      const storedSeed = await readSelectedNativeSeed();
      if (storedSeed) {
        seed = storedSeed;
      } else if (isPasskeyMode()) {
        invalidatePasskey();
        const label = localStorage.getItem('passkeyLabel') ?? undefined;
        const signedIn = await signInPinnedToActiveCredential(label, getPasskeyRpId() ?? LEGACY_RP_ID);
        seed = signedIn.wallet.seed;
      } else {
        const mnemonic = getUnlockedWebMnemonic() ?? (Capacitor.isNativePlatform() ? getSavedMnemonic() : null);
        if (!mnemonic) throw new Error('Please reconnect your wallet before choosing a Lightning name.');
        seed = {type: 'mnemonic', mnemonic};
      }
      ensureActive();
      const address = await withNativeLightningSession({
        seed, apiKey: config.apiKey, expectedIdentityPubkey: identity.identityPubkey,
        ensureActive,
        use: async session => {
          ensureActive();
          // A name recovered on another device takes precedence over a new
          // request. This flow never silently renames an existing address.
          if (session.address) return session.address;
          const available = await session.sdk.checkLightningAddressAvailable({username});
          ensureActive();
          if (!available) throw new Error('This Lightning name is taken. Please choose another.');
          const registered = await session.sdk.registerLightningAddress({username});
          assertNativeLightningAddress(registered);
          if (registered.username !== username) throw new Error('Could not confirm the requested Lightning name.');
          return registered;
        },
      });
      ensureActive();
      setNativeAddressState({sdk: activeSdk, address, lookupFailed: false});
      setNeedsPasskeyMigration(false);
      return address;
    } finally {
      if (nativeClaimInFlightRef.current === epoch) nativeClaimInFlightRef.current = null;
    }
  }, [sdkRef, config, isConnected]);

  const browserResumeInFlightRef=useRef(false);
  const resumeBrowserWallet=useCallback(async(seed:Seed):Promise<number>=>{
    if(Capacitor.isNativePlatform())throw new Error('Browser resume is unavailable on native');
    if(browserResumeInFlightRef.current)throw new Error('Wallet reconnection is already in progress');
    browserResumeInFlightRef.current=true;
    let next:BreezSdk|undefined;
    try {
      const previous=sdkRef.current;
      if(!previous)throw new Error('No browser wallet session to resume');
      const epoch=getSpendingSessionEpoch();
      if(!await matchesSignerIdentity(seed))throw new Error('Unlock credential does not match this wallet');
      assertCurrentSession(epoch);
      // Keep SDK storage and cached UI state. Never use logout to implement locking.
      await stopBrowserSdk(previous);
      assertCurrentSession(epoch);
      const cfg=buildConnectConfig();
      next=await connectSdk({config:cfg,seed,storageDir:'spark-wallet-example'});
      const resumedEpoch=getSpendingSessionEpoch();
      const recovered=await readBrowserRecoveryReadiness(next,cfg.network,()=>assertCurrentSession(resumedEpoch));
      const info=recovered.info,history={payments:recovered.payments};
      assertCurrentSession(resumedEpoch);
      // Verify the public identity too, before adopting the reconnected SDK.
      if(walletInfo&&info.identityPubkey!==walletInfo.identityPubkey)
        throw new Error('Reconnected wallet identity does not match the locked wallet');
      sdkRef.current=next;
      nativeSessionSdkRef.current=next;
      const connectionEpoch=++nativeWalletEpochRef.current;
      setSdk(next);
      setWalletInfo(info);
      setTransactions(filterOngoingConversionPayments(history.payments));
      setConfig(cfg);
      const deposits=unsettledDeposits(recovered.deposits);
      setUnclaimedDeposits(deposits);
      setHasRejectedDeposits(deposits.some(d=>isDepositRejected(d.txid,d.vout)));
      await recoverNativeAddress(next, seed, cfg, connectionEpoch);
      assertCurrentSession(resumedEpoch);
      setError(null);
      return resumedEpoch;
    }catch(error){
      if(next)await next.disconnect().catch(()=>{});
      lockSpendingSession('Browser reconnection did not complete');
      throw error;
    }finally{browserResumeInFlightRef.current=false;}
  },[sdkRef,walletInfo,recoverNativeAddress]);

  const handleLogout = useCallback(async () => {
    const remove=async()=>{
    // Runs inside the browser spend/removal lock before any destructive action.
    // The device wipe includes other wallets, so their exit records count too.
    assertNoExitRecordsForRemoval();
    nativeWalletEpochRef.current++;
    nativeSessionSdkRef.current = null;
    if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(null);
    setIsLoading(true);

    clearSignerIdentity();
    clearUnlockedWebMnemonic();
    try {
      if (sdk) {
        await sdk.disconnect();
      }
    } catch (e) {
      logger.error(LogCategory.SDK, 'SDK disconnect failed', { error: formatError(e) });
      if(!Capacitor.isNativePlatform()){setIsLoading(false);throw e;}
    }
    clearMnemonic();
    clearPasskeyMode();
    try {
      await logger.endSession();
    } catch (e) {
      logger.warn(LogCategory.SESSION, 'Failed to end log session', { error: formatError(e) });
    }

    // Wipe both tiers. Non-fatal: the user is logged out either way,
    // and each tier emits its own typed error breadcrumb.
    if (secureStorage.isSupported()) {
      try { await secureStorage.clearSeed(); } catch { /* non-fatal */ }
    }
    if (deviceOnlyStorage.isSupported()) {
      try { await deviceOnlyStorage.clearSeed(); } catch { /* non-fatal */ }
    }
    // Drop the app lock with the wallet it protected, so onboarding
    // for the next wallet doesn't start behind the old wallet's PIN.
    if (isAppLockSupported()) {
      try { await clearPin(); } catch { /* non-fatal */ }
    }

    // Logout erases everything on the device (the app's account-deletion
    // model): the credential-id registry (native: passkey plugin's
    // Keychain / Block Store, unreachable by a web storage wipe), all
    // localStorage / Preferences / IndexedDB, and the in-memory log
    // buffer. Runs after disconnect so the SDK's DB handles are closed.
    // The registry clear is signal-free, so the passkey stays valid;
    // signing back in is a fresh discovery (no pinned credential).
    try { await clearKnownCredentials(); } catch { /* non-fatal */ }
    await wipeAllLocalData();
    // Re-run non-destructive bookkeeping after an explicitly confirmed wipe.
    // Missing markers never authorize deletion of a saved wallet.
    resetSecureStorageInit();
    resetNativeSeedSelection();
    logger.clear();

    // Browser shutdown must succeed before local data and state are removed.
    setSdk(null);
    setNativeAddressState(null);
    setCachedStableTicker(null);
    clearStableRestorePrompted();
    clearRejectedDeposits();
    clearClaimFees();
    shownPaymentIdsRef.current.clear();
    hasCompletedPaymentSnapshotRef.current = false;
    setIsConnected(false);
    setIsSyncing(false);
    setWalletInfo(null);
    setTransactions([]);
    setUnclaimedDeposits([]);
    setConfig(null);
    setError(null);
    setHasRejectedDeposits(false);
    setCelebrationPayment(null);
    setNeedsPasskeyMigration(false);
    setIsLoading(false);
    setStartupState('no-wallet');
    clearNetworkOverride();
    showToast('success', 'Successfully logged out');
    };
    if(!Capacitor.isNativePlatform()){
      if(!sdk)throw new Error('Unlock and reconnect this wallet before removing it. Wallet data was preserved.');
      const reconciliation=getOperationReconciliation(sdk);
      if(!reconciliation)throw new Error('Cannot verify payment recovery records. Wallet data was preserved.');
      return reconciliation.withWalletRemovalLock(remove);
    }
    return remove();
  }, [sdk, showToast]);

  const adoptMigratedSdk = useCallback(async (newSdk: BreezSdk, label: string): Promise<void> => {
    nativeWalletEpochRef.current++;
    nativeSessionSdkRef.current = null;
    if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(null);
    logger.info(LogCategory.AUTH, 'Adopting migrated SDK', { label });

    // Disconnect the legacy SDK we were running. Unlike handleLogout this keeps
    // mnemonic / stable-ticker / network state: from the user's view it is the
    // same wallet, now under the shared RP ID.
    const oldSdk = sdk;
    if (oldSdk) {
      try {
        await oldSdk.disconnect();
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Old SDK disconnect failed during migration adoption', { error: formatError(e) });
      }
    }

    // Take ownership of the already connected + synced new SDK. Here we set mode
    // + RP ID so resume targets the new wallet; the migration flow pins the shared
    // credential as active right after this hand-off returns.
    nativeSessionSdkRef.current = newSdk;
    setSdk(newSdk);
    // Login-entry migration never ran connectWallet on this hook, so `config`
    // is still null; set it (as connectWallet does) or `config.network` stays
    // undefined and the Buy list drops Cash App until reload.
    const nextConfig = buildConnectConfig();
    setConfig(nextConfig);
    if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(newSdk, nextConfig.network);
    setPasskeyMode(label, SHARED_RP_ID ?? defaultRpId);
    markLabelUsed(label);
    shownPaymentIdsRef.current.clear();
    hasCompletedPaymentSnapshotRef.current = false;
    setCelebrationPayment(null);

    try {
      const [info, txns] = await Promise.all([
        newSdk.getInfo({ensureSynced:false}),
        newSdk.listPayments({ offset: 0, limit: 100 }),
      ]);
      setWalletInfo(info);
      const newReceipt = newlyCompletedReceive(
        txns.payments, shownPaymentIdsRef.current, hasCompletedPaymentSnapshotRef.current
      );
      hasCompletedPaymentSnapshotRef.current = true;
      setTransactions(filterOngoingConversionPayments(txns.payments));
      // Newly settled receives sometimes arrive via sync after a PWA resumes,
      // without a foreground paymentSucceeded event. Initial history is silent.
      if (newReceipt && !isMigrationInProgress()) setCelebrationPayment(newReceipt);
      logger.info(LogCategory.SDK, 'Connected wallet identity', {
        identityPubkey: info.identityPubkey,
        label,
      });
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to load migrated wallet data', { error: formatError(e) });
    }
    setIsConnected(true);
    setIsSyncing(false);
    setNeedsPasskeyMigration(false);
    // Match connectWallet's terminal state so any startup/loading gate clears.
    setStartupState('connected');
    setIsLoading(false);

    try {
      const deposits = unsettledDeposits((await newSdk.listUnclaimedDeposits({})).deposits);
      setUnclaimedDeposits(deposits);
      setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to load deposits for migrated wallet', { error: formatError(e) });
    }
  }, [sdk]);

  // Swap the connected wallet: invalidate the cached passkey, derive a new
  // wallet via PRF (a cancel here leaves the current wallet untouched), then
  // disconnect, clear per-wallet state, reconnect and rehydrate. `rpId` is
  // passed only for an RP switch (persisted before connect so a resume derives
  // under it); a label switch leaves the RP unchanged. `what` names the switch
  // in error/log copy.
  const reconnectWithDerivedWallet = useCallback(async (
    derive: () => Promise<{ seed: Seed; label: string }>,
    what: string,
    rpId?: string,
  ): Promise<void> => {
    // A different identity cannot replace the native plugin's single saved
    // slot. Check before changing the active session or starting a ceremony.
    if (Capacitor.isNativePlatform()) await assertNativeWalletSwitchAllowed();
    const connectionEpoch = ++nativeWalletEpochRef.current;
    nativeSessionSdkRef.current = null;
    if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(null);
    setIsLoading(true);
    setError(null);

    invalidatePasskey();

    let wallet;
    try {
      wallet = await derive();
    } catch (e) {
      if (nativeWalletEpochRef.current === connectionEpoch) {
        nativeSessionSdkRef.current = sdk;
        if (Capacitor.isNativePlatform() && sdk && config) setActiveNativeSeedWallet(sdk, config.network);
      }
      setIsLoading(false);
      throw e;
    }

    if (sdk) {
      try {
        await sdk.disconnect();
      } catch (e) {
        logger.warn(LogCategory.SDK, `SDK disconnect failed during ${what} switch`, {
          error: formatError(e),
        });
      }
    }
    setSdk(null);
    setIsConnected(false);
    setIsSyncing(true);
    setWalletInfo(null);
    setTransactions([]);
    setUnclaimedDeposits([]);
    setHasRejectedDeposits(false);
    setCelebrationPayment(null);
    setCachedStableTicker(null);
    clearStableRestorePrompted();
    shownPaymentIdsRef.current.clear();
    hasCompletedPaymentSnapshotRef.current = false;

    // Persist the target RP before connect so a resume/relaunch derives under it.
    if (rpId) setPasskeyRpId(rpId);

    let connectedSdk: BreezSdk | undefined;
    try {
      await sdkReady();
      const cfg = buildConnectConfig();
      setConfig(cfg);

      connectedSdk = await connectSdk({
        config: cfg,
        seed: wallet.seed,
        storageDir: 'spark-wallet-example',
      });
      nativeSessionSdkRef.current = connectedSdk;
      if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(connectedSdk, cfg.network);
      setSdk(connectedSdk);
      setPasskeyMode(wallet.label, rpId);

      if (deviceOnlyStorage.isSupported()) {
        try {
          await deviceOnlyStorage.storeSeed(wallet.seed);
          setNativeSeedTier('device');
        } catch {
          // In-memory seed keeps the session alive. The old label's
          // cached seed may survive; next launch reconnects it and the
          // user can switch again.
        }
      }

      const [info, txns] = await Promise.all([
        connectedSdk.getInfo({ensureSynced:false}),
        connectedSdk.listPayments({ offset: 0, limit: 100 }),
      ]);
      setWalletInfo(info);
      const newReceipt = newlyCompletedReceive(
        txns.payments, shownPaymentIdsRef.current, hasCompletedPaymentSnapshotRef.current
      );
      hasCompletedPaymentSnapshotRef.current = true;
      setTransactions(filterOngoingConversionPayments(txns.payments));
      // Newly settled receives sometimes arrive via sync after a PWA resumes,
      // without a foreground paymentSucceeded event. Initial history is silent.
      if (newReceipt && !isMigrationInProgress()) setCelebrationPayment(newReceipt);
      await recoverNativeAddress(connectedSdk, wallet.seed, cfg, connectionEpoch);
      setIsConnected(true);
      markLabelUsed(wallet.label);

      try {
        const deposits = unsettledDeposits((await connectedSdk.listUnclaimedDeposits({})).deposits);
        setUnclaimedDeposits(deposits);
        setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
      } catch (e) {
        logger.warn(LogCategory.SDK, `Deposit fetch failed after ${what} switch`, {
          error: formatError(e),
        });
      }
    } catch (e) {
      const errorMsg = formatError(e);
      logger.error(LogCategory.SDK, `Failed to connect after ${what} switch`, { error: errorMsg });
      if (connectedSdk) {
        nativeSessionSdkRef.current = null;
        if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(null);
        try { await connectedSdk.disconnect(); } catch { /* best-effort */ }
        setSdk(null);
      }
      setError(`Failed to switch ${what}. Please try again.`);
      throw e;
    } finally {
      setIsSyncing(false);
      setIsLoading(false);
    }
  }, [sdk, config, recoverNativeAddress]);

  const switchPasskeyLabel = useCallback((newLabel: string): Promise<void> => {
    // Same passkey, same RP the active session uses (legacy for a not-yet-migrated
    // user, shared after migration). Pin to the active credential so the OS doesn't
    // derive the new label under a different identity.
    return reconnectWithDerivedWallet(
      () => signInPinnedToActiveCredential(newLabel, getPasskeyRpId() ?? LEGACY_RP_ID).then(r => r.wallet),
      'label',
    );
  }, [reconnectWithDerivedWallet]);

  // Dev tool: switch the active passkey between the legacy and shared RP and
  // reconnect immediately, instead of only writing the RP id and waiting for the
  // next sign-in. Keeps the current label and re-derives it under the target RP.
  const switchPasskeyRp = useCallback((newRpId: string): Promise<void> => {
    if ((getPasskeyRpId() ?? LEGACY_RP_ID) === newRpId) return Promise.resolve();
    // The #264 per-RP pin won't match a different RP, so the derive falls back to
    // the OS picker, surfacing the credential that lives under the target RP.
    const currentLabel = localStorage.getItem('passkeyLabel') ?? undefined;
    return reconnectWithDerivedWallet(
      () => signInPinnedToActiveCredential(currentLabel, newRpId).then(r => r.wallet),
      'passkey RP',
      newRpId,
    );
  }, [reconnectWithDerivedWallet]);

  const prepareSwitchPasskeyCredential = useCallback(async (
    newCredId: string,
    onPinned?: () => void,
  ): Promise<void> => {
    if (Capacitor.isNativePlatform()) await assertNativeWalletSwitchAllowed();
    nativeWalletEpochRef.current++;
    nativeSessionSdkRef.current = null;
    if (Capacitor.isNativePlatform()) setActiveNativeSeedWallet(null);
    // Remember the prior cred so PasskeyPage's detect-failure branch
    // can roll back if the new one turns out to be deleted.
    const fromCredId = localStorage.getItem('passkeyActiveCredentialId');
    if (fromCredId && fromCredId !== newCredId) {
      setPendingSwitchFromCredentialId(fromCredId);
    }

    // Pin BEFORE invalidating so the next derive (in PasskeyPage's
    // detect) picks up the new cred via `allowCredentials`. Also
    // clears the active label since each cred has its own Nostr id.
    pinActivePasskeyCredentialId(newCredId);

    // Fire onPinned synchronously so callers can unmount any layers
    // that depend on `useWallet()` BEFORE we null the SDK below.
    // Otherwise SettingsPage's useWallet() throws on the transient
    // sdk=null render and blanks the screen until reload.
    onPinned?.();

    setIsLoading(true);
    setError(null);

    if (sdk) {
      try {
        await sdk.disconnect();
      } catch (e) {
        logger.warn(LogCategory.SDK, 'SDK disconnect failed during credential switch', {
          error: formatError(e),
        });
      }
    }

    setSdk(null);
    setIsConnected(false);
    setIsSyncing(false);
    setWalletInfo(null);
    setTransactions([]);
    setUnclaimedDeposits([]);
    setHasRejectedDeposits(false);
    setCelebrationPayment(null);
    setCachedStableTicker(null);
    clearStableRestorePrompted();
    shownPaymentIdsRef.current.clear();
    hasCompletedPaymentSnapshotRef.current = false;
    setIsLoading(false);
  }, [sdk]);

  // Re-run the biometric unlock flow after the user cancelled or was locked
  // out on the previous attempt. Called by UnlockPage's "Unlock" button,
  // and also auto-fired by checkForExistingWallet on mount and by the
  // app-resume listener when the user tabs back into a stuck
  // UnlockingPage.
  const retryUnlock = useCallback(async () => {
    logger.info(LogCategory.AUTH, 'retryUnlock:enter');
    // Prevent concurrent biometric prompts: BiometricPrompt throws if
    // authenticate() is called while another prompt is already live,
    // and the two call-sites (mount timeout + resume listener) can
    // race. The ref is set synchronously before the first await so
    // the second caller bails out cleanly.
    if (retryUnlockInFlightRef.current) {
      logger.warn(LogCategory.AUTH, 'retryUnlock:skipped (in-flight)');
      return;
    }
    retryUnlockInFlightRef.current = true;
    if (!secureStorage.isSupported()) {
      if (!isPasskeyMode()) {
        setStartupState('no-wallet');
        retryUnlockInFlightRef.current = false;
        return;
      }
      setError(null);
      flushSync(() => {
        setStartupState('native-unlocking');
        setIsLoading(true);
      });
      try {
        const effectiveLabel = localStorage.getItem('passkeyLabel') ?? undefined;
        // Existing users derive under their stored RP ID, defaulting to
        // legacy so enabling the shared RP can't orphan a pre-migration wallet.
        const effectiveRpId = getPasskeyRpId() ?? LEGACY_RP_ID;
        const response = await signInPinnedToActiveCredential(effectiveLabel, effectiveRpId);
        if (!getPasskeyRpId()) setPasskeyRpId(effectiveRpId);
        await connectWallet(response.wallet.seed, false, response.wallet.label);
      } catch (e) {
        logger.error(LogCategory.AUTH, 'Web passkey retry failed', { error: formatError(e) });
        setError(passkeyUnlockErrorMessage(e));
        setStartupState('native-locked');
        setIsLoading(false);
      } finally {
        retryUnlockInFlightRef.current = false;
      }
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      // Reuse startup's selected record, even if another tier is also present
      // or the selected record disappears. Failure never chooses a new wallet.
      const seed = await readSelectedNativeSeed({ verifyIdentity: false });
      if (!seed) throw new SecureStorageError('NO_STORED_SEED', 'The selected wallet is unavailable.');
      await connectWallet(seed, false, undefined, 'secureStorage');
    } catch (e) {
      setIsLoading(false);
      if (e instanceof SecureStorageError) {
        switch (e.code) {
          case 'USER_CANCELLED':
            // Silent: stay on UnlockPage and let the user tap again.
            setStartupState('native-locked');
            break;
          case 'BIOMETRIC_LOCKOUT':
            setError(
              'Biometric unlock is locked. Unlock your device with your passcode and try again.',
            );
            setStartupState('native-locked');
            break;
          case 'KEY_INVALIDATED':
            setError(NATIVE_KEY_RECOVERY_MESSAGE);
            setStartupState('native-locked');
            break;
          case 'BIOMETRIC_NOT_ENROLLED':
            setError('Biometric authentication is not set up on this device.');
            setStartupState('native-locked');
            break;
          case 'BIOMETRIC_UNAVAILABLE':
            // Common iOS cause: user denied NSFaceIDUsageDescription.
            // Keep the user on UnlockPage with actionable copy instead
            // of routing back to welcome (which would look like the
            // wallet was lost).
            setError(
              'Biometric authentication is unavailable. Please enable Face ID / Touch ID / fingerprint for GetYourSats in your device settings and try again.',
            );
            setStartupState('native-locked');
            break;
          case 'NO_STORED_SEED':
            setError('The selected wallet is unavailable. Recover this same wallet before resetting local data.');
            setStartupState('native-locked');
            break;
          case 'NOT_SUPPORTED':
          case 'UNKNOWN':
          default:
            setError('Unable to unlock wallet. Please try again.');
            setStartupState('native-locked');
            break;
        }
      } else {
        logger.error(LogCategory.SDK, 'Unexpected error retrying unlock', {
          error: formatError(e),
        });
        setError('Unable to unlock wallet. Please try again.');
        setStartupState('native-locked');
      }
    } finally {
      retryUnlockInFlightRef.current = false;
    }
  }, [connectWallet]);

  const handleBuyBitcoin = useCallback(async (provider: BuyBitcoinProvider) => {
    if (!sdk) return;
    // CashApp requires an amount and is driven by the BuyBitcoinDialog amount step
    // (see useBuyBitcoin.generate), so this top-level handler only covers
    // redirect-only providers like MoonPay.
    if (provider === 'cashApp') return;

    // On web, pre-open a blank tab synchronously during the user gesture
    // so the popup blocker doesn't swallow it after the await. On native
    // hosts we defer the URL open until after the SDK responds and hand
    // it straight to @capacitor/browser (Chrome Custom Tabs on Android,
    // SFSafariViewController on iOS), which opens the provider page
    // completely outside the app's WebView (avoiding the earlier bug
    // where setting window.location.href navigated the glow-web WebView
    // to the provider URL and got stuck in a redirect loop when the
    // user returned to the app).
    const isNative = Capacitor.isNativePlatform();
    const newTab = isNative ? null : window.open('', '_blank');

    try {
      const response = await sdk.buyBitcoin({ type: 'moonpay' });
      if (isNative) {
        await Browser.open({ url: response.url });
      } else if (newTab) {
        newTab.location.href = response.url;
      } else if (isStandalonePwa()) {
        // window.open returns null in an installed PWA, so this is the normal
        // path there, not a blocked-popup edge: navigating the standalone
        // window itself would leave no way back.
        await openExternalUrl(response.url);
      } else {
        window.location.href = response.url;
      }
    } catch (e) {
      // Close the blank tab if the SDK call failed
      newTab?.close();
      logger.error(LogCategory.SDK, 'Failed to open Buy Bitcoin', { error: formatError(e) });
      showToast('error', 'Buy Bitcoin', 'Failed to open purchase page. Please try again.');
    }
  }, [sdk, showToast]);

  // ----------------------------------------
  // Effects
  // ----------------------------------------

  // Covers every connect path (onboarding, resume, label switch, migration
  // adopt), which all land here once the SDK instance is set.
  useEffect(() => {
    if (!sdk) return;
    void ensureSparkPrivateMode(sdk).catch((e) => {
      logger.warn(LogCategory.SDK, 'Failed to enable Spark private mode', { error: formatError(e) });
    });
  }, [sdk]);

  // LNURL domain body attribute
  useEffect(() => {
    const lnurlEnabled = config?.lnurlDomain ? 'true' : 'false';
    document.body.setAttribute('data-lnurl-enabled', lnurlEnabled);
    return () => { document.body.setAttribute('data-lnurl-enabled', 'false'); };
  }, [config?.lnurlDomain]);

  // Route SDK-internal logs to the ring buffer from app start (not just
  // from connectWallet), so the passkey register / label-publish phase is
  // captured in Share Logs. Idempotent, so connectWallet's call no-ops.
  // Without this the ~30s register() is a black box in exported logs, and
  // we can't split the WebAuthn ceremony from the Nostr label publish.
  useEffect(() => { void initSdkLogging(); }, []);

  // Check PRF availability on mount. Shared promise: the splash waits on this
  // same check before revealing, so the welcome screen is never shown with the
  // wrong onboarding flow (prfAvailable defaults to false until it settles).
  useEffect(() => {
    prfAvailability().then(setPrfAvailable).catch(() => setPrfAvailable(false));
  }, []);

  // Set on the first launch after a fresh install (or cross-device
  // Apple-ID restore) when the startup probe sees credentials in the
  // iCloud-synced keychain but no local `passkeyRegistered` flag.
  // PasskeyPage consumes this once to allow a silent retry while the
  // synced credential records finish propagating (see BreezSdkState).
  const [freshInstallRestore, setFreshInstallRestore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const ids = await getKnownCredentialIdsBase64();
        if (cancelled) return;
        if (ids.length > 0 && localStorage.getItem('passkeyRegistered') !== '1') {
          logger.info(LogCategory.AUTH, 'Restoring passkeyRegistered flag from synced keychain', { count: ids.length });
          localStorage.setItem('passkeyRegistered', '1');
          setFreshInstallRestore(true);
        }
      } catch (e) {
        // Web build returns []; native plugin failures shouldn't block start.
        logger.debug(LogCategory.AUTH, 'getKnownCredentialIds failed during startup probe', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };
    run();
    return () => { cancelled = true; };
  }, []);

  // Auto-reconnect on mount
  useEffect(() => {
    logger.initSession().catch((e) => {
      logger.warn(LogCategory.SESSION, 'Failed to initialize log session', { error: formatError(e) });
    });

    const checkForExistingWallet = async () => {
      // (A) Legacy plaintext-mnemonic migration (native only).
      await migrateLegacyMnemonicIfNeeded();

      // Choose a record without deleting another tier to express precedence.
      // Retry, backup, and funding keep this selection for the session.
      const nativeTier = await chooseNativeSeedTier();

      // (B) Legacy biometric-bound seed (pre-app-lock builds). Keep the
      //     original record in its tier. Order matters so the OS prompt lands over a
      //     fully-painted UnlockingPage, not a black splash: flushSync
      //     commits the route change before hideSplash() awaits the
      //     WAAPI fade on the compositor, then retryUnlock fires.
      //     CSS-transition-based fades janked the main thread on
      //     Android WebView; WAAPI sidesteps that.
      let useLegacy = true;
      if (nativeTier === 'biometric') {
        logger.info(LogCategory.AUTH, 'unlock:start');
        flushSync(() => {
          setStartupState('native-unlocking');
        });
        useLegacy = false;

        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
          await hideSplash();
        }

        // Fire-and-forget: retryUnlock owns its error handling and
        // transitions startupState (success => 'connected',
        // cancel/lockout => 'native-locked').
        void retryUnlock();
      } else if (nativeTier === 'device') {
        // (C) Native default silent reconnect. Plain decrypt, no
        //     biometric prompt. `source: 'secureStorage'` skips the
        //     redundant re-write.
        useLegacy = false;
        setIsLoading(true);
        try {
          const seed = await readSelectedNativeSeed({ verifyIdentity: false });
          if (!seed) throw new SecureStorageError('NO_STORED_SEED', 'The selected wallet is unavailable.');
          await connectWallet(seed, false, undefined, 'secureStorage');
        } catch (e) {
          logger.error(
            LogCategory.SDK,
            'Failed to silently reconnect from device-only storage',
            { error: formatError(e) },
          );
          setIsLoading(false);
          // Neither key invalidation nor disappearance of a selected record
          // authorizes deleting wallet data or selecting a different identity.
          setError(e instanceof SecureStorageError && e.code === 'KEY_INVALIDATED'
            ? NATIVE_KEY_RECOVERY_MESSAGE : 'Could not reconnect the selected wallet. Please try again.');
          setStartupState('native-locked');
        }
      }

      // (D) Legacy flow: web, or native with no stored seed.
      if (useLegacy) {
        if (isPasskeyMode()) {
          // Passkey mode always re-derives via PRF on launch.
          clearMnemonic();
        }
        const savedMnemonic = !isPasskeyMode() ? getSavedMnemonic() : null;
        if (!Capacitor.isNativePlatform() && !isPasskeyMode()
          && (hasWebWalletVault() || hasLegacyWebMnemonic())) {
          setStartupState(hasWebWalletVault() ? 'web-vault-locked' : 'web-vault-enroll');
          setIsLoading(false);
        } else if (savedMnemonic) {
          try {
            setIsLoading(true);
            await connectWallet({ type: 'mnemonic', mnemonic: savedMnemonic }, false);
          } catch (e) {
            logger.error(LogCategory.SDK, 'Failed to connect with saved mnemonic', { error: formatError(e) });
            setError('Failed to connect with saved mnemonic. Please try again.');
            // Deliberately keep the mnemonic: a failed connect is a
            // network/SDK outcome, not proof the seed is bad, and
            // clearing it here lost the only copy on the device.
            setIsLoading(false);
          }
        } else if (isPasskeyMode()) {
          // Passkey mode without stored seed: re-derive via PRF.
          // flushSync commits UnlockingPage before the WebAuthn prompt
          // fires, then hideSplash drops the index.html splash so it
          // doesn't sit on top.
          flushSync(() => {
            setStartupState('native-unlocking');
            setIsLoading(true);
          });
          if (isInitialLoadRef.current) {
            isInitialLoadRef.current = false;
            await hideSplash();
          }
          let wallet;
          try {
            // Falls back to the stored `passkeyLabel`; SDK accepts
            // `undefined` for "use whatever signIn negotiates".
            const effectiveLabel = localStorage.getItem('passkeyLabel') ?? undefined;
            // Existing users derive under their stored RP ID, defaulting to
            // legacy so enabling the shared RP can't orphan a pre-migration wallet.
            const effectiveRpId = getPasskeyRpId() ?? LEGACY_RP_ID;
            const result = await signInPinnedToActiveCredential(effectiveLabel, effectiveRpId);
            if (!getPasskeyRpId()) setPasskeyRpId(effectiveRpId);
            wallet = result.wallet;
          } catch (e) {
            logger.error(LogCategory.AUTH, 'Passkey authentication failed', { error: formatError(e) });
            setError(passkeyUnlockErrorMessage(e));
            setStartupState('native-locked');
            setIsLoading(false);
          }
          if (wallet) {
            try {
              await connectWallet(wallet.seed, false, wallet.label);
            } catch (e) {
              logger.error(LogCategory.SDK, 'Failed to connect after passkey auth', { error: formatError(e) });
              setError('Failed to connect wallet. Please try again.');
              setStartupState('native-locked');
              setIsLoading(false);
            }
          }
        } else {
          setIsLoading(false);
        }
      }

      // Default any leftover 'loading' state to 'no-wallet' so the router
      // can show the welcome page. If a success path already transitioned
      // to 'connected' or a locked path set 'native-locked', this functional
      // update leaves it untouched.
      setStartupState((current) => (current === 'loading' ? 'no-wallet' : current));

      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        // Fire-and-forget on the non-passkey tail: we're not racing
        // the biometric prompt here, so there's no reason to await
        // the fade. hideSplash resolves on its own timeline.
        void hideSplash();
      }
    };

    void checkForExistingWallet().catch((e) => {
      setIsLoading(false);
      setError(e instanceof SecureStorageError && e.code === 'KEY_INVALIDATED'
        ? NATIVE_KEY_RECOVERY_MESSAGE : 'Could not check the saved wallet. Please try again.');
      setStartupState('native-locked');
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        void hideSplash();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initialization
  }, []);

  // Re-fire retryUnlock on foreground return while stuck on
  // UnlockingPage. Guards the race where the user backgrounds the app
  // during the splash fade: BiometricPrompt would land on a
  // non-STARTED activity, FragmentManager would refuse the
  // transaction, and the auth callback would never fire (JS Promise
  // hangs, UnlockingPage visible with no prompt). Native side guards
  // this too; this listener is a belt-and-braces fallback.
  // `retryUnlockInFlightRef` makes the call idempotent.
  const startupStateRef = useLatest(startupState);
  const retryUnlockRef = useLatest(retryUnlock);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      if (startupStateRef.current === 'native-unlocking') {
        void retryUnlockRef.current();
      }
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [startupStateRef, retryUnlockRef]);

  // Browser facade syncWallet is observation-only; it never maps to the raw
  // SDK sync that can claim deposits or resume sends. Locked sessions reject it.
  const resyncInFlightRef = useRef(false);
  const foregroundResync = useCallback(async () => {
    if (resyncInFlightRef.current) return;
    resyncInFlightRef.current = true;
    try {
      // Two passes = one retry; the delay doubles as retry backoff.
      for (let attempt = 0; attempt < 2; attempt++) {
        // 1.5s delay: on iOS 18+ WebKit, network requests started directly
        // on visibilitychange fail with "TypeError: Load failed".
        await new Promise(r => setTimeout(r, 1500));
        if (document.visibilityState !== 'visible') return;
        const s = sdkRef.current;
        if (!s) return;
        try {
          // 30s cap so a hung SDK call cannot wedge resyncInFlightRef
          // forever (the PWA page never reloads, so nothing else would
          // clear it). This timer does not cancel an already-started SDK call.
          // Restricted browser previews never start effectful synchronization.
          await Promise.race([
            (async () => {
              await s.syncWallet({});
              // The fetchers absorb their SDK errors and report them as
              // `false`, so a failed read retries the same way a
              // syncWallet throw does.
              const refreshed = await Promise.all([refreshWalletData(false), fetchUnclaimedDeposits()]);
              if (!refreshed.every(Boolean)) throw new Error('refresh incomplete');
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('foreground resync timeout')), 30000)),
          ]);
          return;
        } catch (e) {
          logger.warn(LogCategory.SDK, 'Foreground resync failed', { attempt, error: formatError(e) });
        }
      }
    } finally {
      resyncInFlightRef.current = false;
    }
  }, [sdkRef, refreshWalletData, fetchUnclaimedDeposits]);

  useEffect(() => {
    if (!isConnected) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void foregroundResync();
    };
    // pageshow catches bfcache restores, which skip visibilitychange.
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [isConnected, foregroundResync]);

  // Late SDK events and asynchronous registration must not publish data after
  // a wallet switch, lock or component teardown.
  useEffect(() => {
    if (isConnected && sdk) {
      const observedSdk=sdk;
      const walletEpoch=nativeWalletEpochRef.current;
      const sessionEpoch=getSpendingSessionEpoch();
      let disposed=false;
      let registeredId:string|null=null;
      sdk.addEventListener({ onEvent:event=>{
        if(disposed||sdkRef.current!==observedSdk||nativeWalletEpochRef.current!==walletEpoch||
          (!Capacitor.isNativePlatform()&&(isSpendingSessionLocked()||getSpendingSessionEpoch()!==sessionEpoch)))
          return;
        handleSdkEvent(event);
      }})
        .then(id => {
          if(disposed){
            void observedSdk.removeEventListener(id).catch(()=>{});
            return;
          }
          registeredId=id;
          eventListenerIdRef.current=id;
          logger.debug(LogCategory.SDK, 'Registered wallet event listener', { listenerId: id });
        })
        .catch(e => {
          if(disposed)return;
          logger.error(LogCategory.SDK, 'Failed to add wallet event listener', { error: formatError(e) });
          setError('Failed to set up event listeners.');
        });
      return () => {
        disposed=true;
        if (registeredId) {
          observedSdk.removeEventListener(registeredId).catch(e => {
            logger.error(LogCategory.SDK, 'Error removing wallet event listener', { error: formatError(e) });
          });
          if(eventListenerIdRef.current===registeredId)eventListenerIdRef.current=null;
        }
      };
    }
  }, [isConnected, sdk, handleSdkEvent, sdkRef]);

  return {
    // State
    sdk,
    nativeLightningAddress,
    isConnected,
    isLoading,
    isSyncing,
    walletInfo,
    transactions,
    hasPendingConversion,
    unclaimedDeposits,
    config,
    error,
    hasRejectedDeposits,
    celebrationPayment,
    needsPasskeyMigration,
    prfAvailable,
    hasPasskeyBefore: hasPasskeyHistory(),
    isFreshInstallRestore: freshInstallRestore,
    startupState,
    // Actions
    connectWallet,
    resumeBrowserWallet,
    claimNativeLightningAddress,
    refreshWalletData,
    fetchUnclaimedDeposits,
    handleLogout,
    adoptMigratedSdk,
    handleBuyBitcoin,
    clearError: () => setError(null),
    dismissCelebration: () => setCelebrationPayment(null),
    subscribeToSdkEvents,
    consumeFreshInstallSignal: () => {
      const v = freshInstallRestore;
      if (v) setFreshInstallRestore(false);
      return v;
    },
    retryUnlock,
    switchPasskeyLabel,
    switchPasskeyRp,
    prepareSwitchPasskeyCredential,
  };
}
