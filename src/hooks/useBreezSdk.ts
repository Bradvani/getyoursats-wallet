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
  saveMnemonic,
  getSavedMnemonic,
  clearMnemonic,
  migrateLegacyMnemonicIfNeeded,
} from '../services/legacyMnemonicMigration';
import { isSendSheetOpen } from '../features/send/sendSheetVisibility';
import { clearPin, isAppLockSupported } from '../services/appLock';
import { hasConversionInFlight } from '../contexts/WalletContext';
import { isConversionPayment } from '../utils/paymentDescription';
import {newlyCompletedReceive,rememberPaymentId} from '../getyoursats/paymentMomentPolicy';
import { unsettledDeposits } from '../utils/depositHelpers';
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
 * - `'native-locked'`: biometric cancelled or locked out (interactive
 *   UnlockPage with retry + re-onboard escape).
 * - `'connected'`: SDK is connected to a wallet.
 */
export type StartupState =
  | 'loading'
  | 'no-wallet'
  | 'native-unlocking'
  | 'native-locked'
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
  claimNativeLightningAddress: (username: string) => Promise<LightningAddressInfo>;
  connectWallet: (
    seed: Seed,
    restore: boolean,
    passkeyLabel?: string,
    source?: ConnectSeedSource,
  ) => Promise<void>;
  /** Resolve false when the SDK read failed; both log internally and keep last-known state. */
  refreshWalletData: (showLoading?: boolean) => Promise<boolean>;
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

  const refreshWalletData = useCallback(async (showLoading = true) => {
    const s = sdkRef.current;
    if (!s) return false;
    try {
      if (showLoading) setIsLoading(true);
      const [info, txns] = await Promise.all([
        s.getInfo({}),
        s.listPayments({ offset: 0, limit: 100 }),
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
      return true;
    } catch (e) {
      logger.error(LogCategory.SDK, 'Error refreshing wallet data', { error: formatError(e) });
      setError('Failed to refresh wallet data.');
      return false;
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [sdkRef]);

  const fetchUnclaimedDeposits = useCallback(async () => {
    const s = sdkRef.current;
    if (!s) return false;
    try {
      const result = await s.listUnclaimedDeposits({});
      const deposits = unsettledDeposits(result.deposits);
      setUnclaimedDeposits(deposits);
      setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
      return true;
    } catch (e) {
      // Keep the last known list: clearing on a transient failure (common
      // on iOS PWA resume) hides a real pending deposit from the UI.
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
      logger.info(LogCategory.PAYMENT, 'Payment failed event received', {
        paymentId: event.payment.id,
        paymentType: event.payment.paymentType,
        method: event.payment.method,
      });
      // Same reasoning as the send celebration above: with the sheet gone
      // there is nothing else to tell the user the payment did not go out.
      if (event.payment.paymentType === 'send' && !isSendSheetOpen()) {
        showToastRef.current('error', 'Payment Failed', 'The payment did not go through. Your funds were not sent.');
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
      const identity = await client.signMessage({message: 'gys-native-lnurl-session-v1', compact: true});
      const address = await withNativeLightningSession({
        seed, apiKey: cfg.apiKey, expectedIdentityPubkey: identity.pubkey,
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

  const connectWallet = useCallback(async (
    seed: Seed,
    restore: boolean,
    passkeyLabel?: string,
    source: ConnectSeedSource = 'onboarding',
  ) => {
    let connectedSdk: BreezSdk | undefined;
    const createStart = performance.now();
    try {
      logger.info(LogCategory.SDK, 'Initiating wallet connection', { restore });
      if (sdk) {
        logger.debug(LogCategory.SDK, 'Wallet already connected; skipping');
        return;
      }
      const connectionEpoch = ++nativeWalletEpochRef.current;

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
      setSdk(connectedSdk);

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
          saveMnemonic(seed.mnemonic);
        }
      }

      // Load balance + history before the first wallet render. Both are
      // local-database reads (connect() already ran the initial sync), so
      // the cost is milliseconds, while rendering without them flashes
      // the "No payments" empty state on every startup (#301). Failure
      // falls through: the wallet is usable and the synced event refills.
      // Matches adoptMigratedSdk / reconnectWithDerivedWallet ordering.
      try {
        const [info, txns] = await logger.time('[onboarding] sdk.getInfoAndPayments', () =>
          Promise.all([
            connectedSdk!.getInfo({}),
            connectedSdk!.listPayments({ offset: 0, limit: 100 }),
          ]));
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
      }

      await recoverNativeAddress(connectedSdk, seed, cfg, connectionEpoch);
      setIsConnected(true);
      setStartupState('connected');
      setIsLoading(false);
      // Total covers connect + persist + the local reads above; deposits
      // load in the background below. Add the earlier passkey.register/
      // signIn time for the full button-tap-to-usable figure.
      logger.info(LogCategory.PERF, '[onboarding] connect.total', {
        ms: Math.round(performance.now() - createStart),
      });

      void (async () => {
        try {
          const result = await connectedSdk!.listUnclaimedDeposits({});
          const deposits = unsettledDeposits(result.deposits);
          setUnclaimedDeposits(deposits);
          setHasRejectedDeposits(deposits.some(d => isDepositRejected(d.txid, d.vout)));
        } catch (e) {
          logger.warn(LogCategory.SDK, 'Failed to fetch unclaimed deposits', { error: formatError(e) });
        }
      })();
    } catch (e) {
      const errorMsg = formatError(e);
      logger.error(LogCategory.SDK, 'Error connecting wallet', { error: errorMsg });
      logger.authFailure(passkeyLabel != null ? 'passkey' : seed.type, errorMsg);

      // If SDK connected but a subsequent step failed, disconnect to avoid leaked instance
      if (connectedSdk) {
        try { await connectedSdk.disconnect(); } catch { /* best-effort cleanup */ }
        nativeSessionSdkRef.current = null;
        setSdk(null);
      }

      setError('Failed to connect wallet. Please try again.');
      setIsSyncing(false);
      setIsLoading(false);
      setConfig(null);
      throw e;
    }
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
      const identity = await activeSdk.signMessage({message: 'gys-native-lnurl-session-v1', compact: true});
      ensureActive();
      let seed: Seed;
      if (deviceOnlyStorage.isSupported() && await deviceOnlyStorage.hasStoredSeed()) {
        seed = await deviceOnlyStorage.retrieveSeed();
      } else if (secureStorage.isSupported() && await secureStorage.hasStoredSeed()) {
        seed = await secureStorage.retrieveSeed();
      } else if (isPasskeyMode()) {
        invalidatePasskey();
        const label = localStorage.getItem('passkeyLabel') ?? undefined;
        const signedIn = await signInPinnedToActiveCredential(label, getPasskeyRpId() ?? LEGACY_RP_ID);
        seed = signedIn.wallet.seed;
      } else {
        const mnemonic = getSavedMnemonic();
        if (!mnemonic) throw new Error('Please reconnect your wallet before choosing a Lightning name.');
        seed = {type: 'mnemonic', mnemonic};
      }
      ensureActive();
      const address = await withNativeLightningSession({
        seed, apiKey: config.apiKey, expectedIdentityPubkey: identity.pubkey,
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

  const handleLogout = useCallback(async () => {
    nativeWalletEpochRef.current++;
    nativeSessionSdkRef.current = null;
    setIsLoading(true);

    // Wipe reconnect signals first so a hung sdk.disconnect() can't
    // strand the user with a wallet that auto-reconnects on refresh.
    clearMnemonic();
    clearPasskeyMode();

    try {
      if (sdk) {
        await sdk.disconnect();
      }
    } catch (e) {
      logger.error(LogCategory.SDK, 'SDK disconnect failed', { error: formatError(e) });
    }
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
    // The wipe took the vault's install markers with it. Without this the
    // once-per-process init memo still reads "initialized", so a re-onboard
    // in this same session persists a seed with no marker beside it, and the
    // next cold start mistakes that for a reinstall and wipes it.
    resetSecureStorageInit();
    logger.clear();

    // Always reset all state, even if disconnect threw.
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
  }, [sdk, showToast]);

  const adoptMigratedSdk = useCallback(async (newSdk: BreezSdk, label: string): Promise<void> => {
    nativeWalletEpochRef.current++;
    nativeSessionSdkRef.current = null;
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
    setConfig(buildConnectConfig());
    setPasskeyMode(label, SHARED_RP_ID ?? defaultRpId);
    markLabelUsed(label);
    shownPaymentIdsRef.current.clear();
    hasCompletedPaymentSnapshotRef.current = false;
    setCelebrationPayment(null);

    try {
      const [info, txns] = await Promise.all([
        newSdk.getInfo({}),
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
    const connectionEpoch = ++nativeWalletEpochRef.current;
    nativeSessionSdkRef.current = null;
    setIsLoading(true);
    setError(null);

    invalidatePasskey();

    let wallet;
    try {
      wallet = await derive();
    } catch (e) {
      if (nativeWalletEpochRef.current === connectionEpoch) nativeSessionSdkRef.current = sdk;
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

    if (secureStorage.isSupported()) {
      try {
        await secureStorage.clearSeed();
      } catch {
        // storeSeed below overwrites anyway.
      }
    }

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
      setSdk(connectedSdk);
      setPasskeyMode(wallet.label, rpId);

      if (deviceOnlyStorage.isSupported()) {
        try {
          await deviceOnlyStorage.storeSeed(wallet.seed);
        } catch {
          // In-memory seed keeps the session alive. The old label's
          // cached seed may survive; next launch reconnects it and the
          // user can switch again.
        }
      }

      const [info, txns] = await Promise.all([
        connectedSdk.getInfo({}),
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
        try { await connectedSdk.disconnect(); } catch { /* best-effort */ }
        nativeSessionSdkRef.current = null;
        setSdk(null);
      }
      setError(`Failed to switch ${what}. Please try again.`);
      throw e;
    } finally {
      setIsSyncing(false);
      setIsLoading(false);
    }
  }, [sdk, recoverNativeAddress]);

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
    nativeWalletEpochRef.current++;
    nativeSessionSdkRef.current = null;
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

    // Wipe the previous identity's seed from secure storage so the
    // startup probe doesn't auto-rehydrate the old wallet on the way
    // back through PasskeyPage.
    if (secureStorage.isSupported()) {
      try {
        await secureStorage.clearSeed();
      } catch {
        // Best effort; the next storeSeed overwrites.
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
        setError('Failed to authenticate with passkey. Please try again.');
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
      // Device-only is the default tier; the bound tier only exists on
      // pre-app-lock installs. With nothing bound there is no biometric
      // to retry, so this is a plain reconnect retry after a failed
      // silent start.
      if (!(await secureStorage.hasStoredSeed())) {
        logger.info(LogCategory.AUTH, 'retryUnlock:deviceOnlyReconnect');
        const seed = await deviceOnlyStorage.retrieveSeed();
        await connectWallet(seed, false, undefined, 'secureStorage');
        return;
      }
      logger.info(LogCategory.AUTH, 'retryUnlock:callingRetrieveSeed');
      const seed = await secureStorage.retrieveSeed();
      await connectWallet(seed, false, undefined, 'secureStorage');
      // connectWallet sets startupState='connected' on success.
      // Legacy migration: pre-app-lock builds kept the seed
      // biometric-bound. Move it to the device-only tier (this prompt
      // was the last mandatory one; PIN/biometric gating is app-level
      // now, see appLock.ts). Write-then-clear so a crash mid-move
      // can only duplicate the seed, never lose it.
      try {
        await deviceOnlyStorage.storeSeed(seed);
        await secureStorage.clearSeed();
        logger.info(LogCategory.AUTH, 'Migrated biometric-bound seed to device-only tier');
      } catch {
        // Best-effort; the next successful unlock retries.
      }
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
            // Voided by a new biometric enrollment. Wipe + re-onboard.
            await secureStorage.clearSeed().catch(() => { /* best-effort */ });
            setError('Your biometric enrollment changed. Please set up your wallet again.');
            setStartupState('no-wallet');
            break;
          case 'BIOMETRIC_NOT_ENROLLED':
            setError('Biometric authentication is not set up on this device.');
            setStartupState('no-wallet');
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
            setStartupState('no-wallet');
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

      // (B0) Stale bound-tier residue. A live seed one tier down (or a
      //     saved mnemonic) means the bound-tier entry is a 0.0.3
      //     orphan or a half-finished migration duplicate, not the
      //     active wallet. Clear it so it can't hijack startup with a
      //     biometric prompt for the wrong seed, or wipe a working
      //     wallet via the KEY_INVALIDATED path below.
      let staleBoundTierCleared = false;
      if (secureStorage.isSupported() && (await secureStorage.hasStoredSeed())) {
        const hasLiveSeedBelow =
          (await deviceOnlyStorage.hasStoredSeed())
          || (!isPasskeyMode() && getSavedMnemonic() != null);
        if (hasLiveSeedBelow) {
          await secureStorage.clearSeed().catch(() => { /* best-effort */ });
          staleBoundTierCleared = true;
          logger.warn(LogCategory.AUTH, 'Cleared stale biometric-bound seed');
        }
      }

      // (B) Legacy biometric-bound seed (pre-app-lock builds). One last
      //     OS-prompted unlock, after which retryUnlock migrates the
      //     seed to the device-only tier and this branch never runs
      //     again. Order matters so the OS prompt lands over a
      //     fully-painted UnlockingPage, not a black splash: flushSync
      //     commits the route change before hideSplash() awaits the
      //     WAAPI fade on the compositor, then retryUnlock fires.
      //     CSS-transition-based fades janked the main thread on
      //     Android WebView; WAAPI sidesteps that.
      let useLegacy = true;
      if (
        !staleBoundTierCleared
        && secureStorage.isSupported()
        && (await secureStorage.hasStoredSeed())
      ) {
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
      } else if (
        deviceOnlyStorage.isSupported()
        && (await deviceOnlyStorage.hasStoredSeed())
      ) {
        // (C) Native default silent reconnect. Plain decrypt, no
        //     biometric prompt. `source: 'secureStorage'` skips the
        //     redundant re-write.
        useLegacy = false;
        setIsLoading(true);
        try {
          const seed = await deviceOnlyStorage.retrieveSeed();
          await connectWallet(seed, false, undefined, 'secureStorage');
        } catch (e) {
          logger.error(
            LogCategory.SDK,
            'Failed to silently reconnect from device-only storage',
            { error: formatError(e) },
          );
          setIsLoading(false);
          // The seed is still in the vault unless the vault itself lost
          // it, so anything else (connect threw, SDK init failed) must
          // route to UnlockPage's retry. Falling through to 'no-wallet'
          // showed the welcome screen after one transient failure and
          // read as "the app forgot my account".
          const vaultEmpty = e instanceof SecureStorageError
            && (e.code === 'NO_STORED_SEED' || e.code === 'KEY_INVALIDATED');
          if (!vaultEmpty) {
            setError('Could not reconnect. Please try again.');
            setStartupState('native-locked');
          }
        }
      }

      // (D) Legacy flow: web, or native with no stored seed.
      if (useLegacy) {
        if (isPasskeyMode()) {
          // Passkey mode always re-derives via PRF on launch.
          clearMnemonic();
        }
        const savedMnemonic = !isPasskeyMode() ? getSavedMnemonic() : null;
        if (savedMnemonic) {
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
            setError('Failed to authenticate with passkey. Please try again.');
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

    checkForExistingWallet();
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

  // Force a sync when the app returns to the foreground: any tab/window
  // visibility return, not just PWA resume. The motivating case is iOS
  // standalone PWAs, which resume a days-old page instead of reloading;
  // a failed background sync is silent (synced never fires), so without
  // this the UI keeps showing cached data.
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
          // clear it). The race releases the guard without cancelling
          // the call; a zombie sync finishing late is harmless.
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

  // Event listener lifecycle
  useEffect(() => {
    if (isConnected && sdk) {
      sdk.addEventListener({ onEvent: handleSdkEvent })
        .then(id => {
          eventListenerIdRef.current = id;
          logger.debug(LogCategory.SDK, 'Registered wallet event listener', { listenerId: id });
        })
        .catch(e => {
          logger.error(LogCategory.SDK, 'Failed to add wallet event listener', { error: formatError(e) });
          setError('Failed to set up event listeners.');
        });

      return () => {
        if (eventListenerIdRef.current) {
          sdk.removeEventListener(eventListenerIdRef.current).catch(e => {
            logger.error(LogCategory.SDK, 'Error removing wallet event listener', { error: formatError(e) });
          });
          eventListenerIdRef.current = null;
        }
      };
    }
  }, [isConnected, sdk, handleSdkEvent]);

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
