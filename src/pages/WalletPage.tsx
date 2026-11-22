import { useWalletNavigation } from '../hooks/useWalletNavigation';
import {trustCopy} from '../getyoursats/trustCopy';
import GetYourSatsWordmark from '../components/GetYourSatsWordmark';
import {SUPPORT_URL} from '../constants/publicPages';
import {usePresentation} from '@/hooks/usePresentation';
import {WALLET_COPY} from '@/services/presentationPreferences';
import {useLightningAddress} from '../features/receive/hooks/useLightningAddress';
import GetYourSatsPos from '../getyoursats/PosPage';
import {featureAvailability} from '../getyoursats/featureAvailability';
import PosErrorBoundary from '../components/PosErrorBoundary';
import PartnerBuyDialog from '../getyoursats/PartnerBuyDialog';
import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useToast } from '../contexts/ToastContext';
import { logger, LogCategory } from '@/services/logger';
import CollapsingWalletHeader from '../components/CollapsingWalletHeader';
import SideMenu from '../components/SideMenu';
import MarketPulse from '../getyoursats/MarketPulse';
import WalletToolbar from '../components/WalletToolbar';
import WalletIdentityCard from '../getyoursats/WalletIdentityCard';
import {isGetYourSatsAddress} from '../getyoursats/walletIdentity';
import {safeAreaBottom} from '../utils/safeAreaInsets';
import {useBackButton} from '../hooks/useBackButton';
import '../getyoursats/walletHome.css';
import WalletActivityPanel from '../getyoursats/WalletActivityPanel';
import WalletSetupCard from '../getyoursats/WalletSetupCard';
import WalletSetupTour from '../getyoursats/WalletSetupTour';
import BitcoinLearningJourney from '../getyoursats/BitcoinLearningJourney';
import type {BitcoinLearningController} from '../getyoursats/bitcoinLearningState';
import type {WalletSetupController} from '../hooks/useWalletSetup';
import type {WalletRecoveryMethod} from '../getyoursats/walletSetupState';
import PullToRefresh from '../components/PullToRefresh';
import { GetInfoResponse, Payment, DepositInfo, Network } from '@breeztech/breez-sdk-spark';
import type { BuyBitcoinProvider } from '../services/settings';
import { ArrowUpIcon, ArrowDownIcon, ChevronRightIcon } from '../components/Icons';
import { mergeDepositsWithTransactions, ExtendedPayment, isUnclaimedDepositPayment } from '@/utils/depositHelpers';
import SendPaymentDialog from '../features/send/SendPaymentDialog';
import ReceivePaymentDialog from '../features/receive/ReceivePaymentDialog';
import QrScannerDialog from '../components/QrScannerDialog';
import PaymentDetailsDialog from '../components/PaymentDetailsDialog';
import { useLatest } from '../hooks/useLatest';
import UnclaimedDepositDetailsPage from './UnclaimedDepositDetailsPage';
import SaveContactDialog from '../features/send/components/SaveContactDialog';
import BuyBitcoinDialog from '../features/buy/BuyBitcoinDialog';
import { getBuyProviderSettings, filterProvidersByNetwork, filterProvidersByPlatform } from '../services/settings';
import { useCashAppInstalled } from '../hooks/useCashAppInstalled';
import { unilateralExitEntries, type UnilateralExitEntry } from '../features/unilateral-exit/listEntries';
import { ArchivedExitDialog } from '../features/unilateral-exit/ArchivedExitDialog';
import { useUnilateralExitEngineState } from '../features/unilateral-exit/hooks/useUnilateralExitEngineLifecycle';
import { useStatusBarColor } from '../hooks/useStatusBarColor';
import { STATUS_BAR_WALLET_GLASS } from '../utils/statusBarManager';
import { onDeepLink } from '../utils/deepLink';

interface WalletPageProps {
  walletInfo: GetInfoResponse | null;
  transactions: Payment[];
  unclaimedDeposits: DepositInfo[];
  refreshWalletData: (showLoading?: boolean) => Promise<boolean>;
  isSyncing: boolean;
  error: string | null;
  onClearError: () => void;
  onLogout: () => void;
  hasRejectedDeposits: boolean;
  onOpenGetRefund: (source?: 'menu' | 'icon') => void;
  onOpenSettings: () => void;
  onReturnToWallet: () => void;
  settingsActive: boolean;
  onOpenFiatCurrencies?: () => void;
  onOpenDca: () => void;
  onOpenUnilateralExit: () => void;
  onBuyBitcoin: (provider: BuyBitcoinProvider) => Promise<void>;
  network?: Network;
  onDepositChanged?: () => void;
  walletSetup?: WalletSetupController;
  bitcoinLearning?: BitcoinLearningController;
  recoveryMethod?: WalletRecoveryMethod;
  setupTourAllowed?: boolean;
  onReviewRecovery?: () => void;
  onPersonalizeAddress?: () => void;
}

const WalletPage: React.FC<WalletPageProps> = ({
  walletInfo,
  transactions,
  unclaimedDeposits,
  refreshWalletData,
  isSyncing,
  onLogout,
  hasRejectedDeposits,
  onOpenGetRefund,
  onOpenSettings,
  onReturnToWallet,
  settingsActive,
  onOpenFiatCurrencies,
  onOpenDca,
  onOpenUnilateralExit,
  onBuyBitcoin,
  network,
  onDepositChanged,
  walletSetup,
  bitcoinLearning,
  recoveryMethod = 'phrase',
  setupTourAllowed = true,
  onReviewRecovery,
  onPersonalizeAddress,
}) => {
  const wallet = useWallet();
  const {language,copy}=usePresentation();
  const wc=WALLET_COPY[language];
  const { showToast } = useToast();

  // Tint the native system bars to the wallet page glass effective
  // color so the CollapsingWalletHeader glassmorphism reads as a
  // continuous surface with the status bar. Other pages (drawer,
  // slide-ins, landing) push spark-surface on top of this via the
  // same manager, and their pop restores #13131d when they close.
  useStatusBarColor(STATUS_BAR_WALLET_GLASS);

  const { historyOpen, setHistoryOpen, gysPosOpen, setGysPosOpen, navigate } = useWalletNavigation(onReturnToWallet, onOpenSettings);
  const [partnerBuyOpen,setPartnerBuyOpen] = useState(false);
  const primaryLightningAddress = useLightningAddress();
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [scannerOpenedFromSend, setScannerOpenedFromSend] = useState(false);
  const [tappedPayment, setTappedPayment] = useState<Payment | null>(null);
  // Resolved against the live list so a payment that changes while its sheet
  // is open (a cross-chain receive picking up its conversion info after it
  // lands) is shown as it is now. The tap keeps the sheet up if a refresh
  // pages the row out.
  const selectedPayment = tappedPayment
    ? transactions.find(p => p.id === tappedPayment.id) ?? tappedPayment
    : null;
  const [selectedExitId, setSelectedExitId] = useState<string | null>(null);
  // The outpoint, not the record: held as a copy the deposit's maturity, fee
  // error and claim status all freeze at tap time, and the sheet spends its
  // life offering routes for a state the deposit has already left.
  const [selectedOutpoint, setSelectedOutpoint] = useState<string | null>(null);
  const selectedDeposit = selectedOutpoint
    ? unclaimedDeposits.find(d => `${d.txid}:${d.vout}` === selectedOutpoint) ?? null
    : null;
  const [paymentInput, setPaymentInput] = useState<{raw: string; id: number} | null>(null);
  const paymentInputSequence = useRef(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isBuyBitcoinOpen, setIsBuyBitcoinOpen] = useState(false);
  const [isBuyLoading, setIsBuyLoading] = useState(false);
  const cashAppInstalled = useCashAppInstalled();
  // Computed per render (cheap in-memory read) so the Buy button's
  // visibility is fresh after any return from Settings; a memo keyed
  // on menu state went stale when providers changed under an overlay.
  // Do not surface uncontracted third-party ramps as an India UPI feature.
  // This legacy Glow handoff is disabled unless explicitly reviewed/enabled.
  const enabledBuyProviders = import.meta.env.VITE_GETYOURSATS_ENABLE_LEGACY_BUY === 'true'
    ? filterProvidersByPlatform(filterProvidersByNetwork(getBuyProviderSettings(), network), cashAppInstalled)
    : [];
  const [saveContactAddress, setSaveContactAddress] = useState<string | null>(null);
  // Bump these on each open so each dialog remounts and lazy-inits its
  // state, instead of relying on a reset-in-effect inside the dialog.
  const [saveContactSession, setSaveContactSession] = useState(0);
  const [sendDialogSession, setSendDialogSession] = useState(0);
  const [receiveDialogSession, setReceiveDialogSession] = useState(0);
  const [buyBitcoinSession, setBuyBitcoinSession] = useState(0);
  const learningOpen = Boolean(bitcoinLearning?.scope &&
    (bitcoinLearning.progress.status === 'offered' || bitcoinLearning.progress.status === 'active'));
  const tourRequested = Boolean(walletSetup?.scope && walletSetup.progress.tourStatus === 'active' && !learningOpen);
  const showHistory = historyOpen;
  const setupPaused = !setupTourAllowed || settingsActive || isSendDialogOpen || isReceiveDialogOpen || isQrScannerOpen ||
    isMenuOpen || isBuyBitcoinOpen || partnerBuyOpen || gysPosOpen || Boolean(selectedPayment) ||
    Boolean(selectedDeposit) || Boolean(selectedExitId) || Boolean(saveContactAddress);
  const startTour = () => { navigate('wallet'); walletSetup?.beginTour(); };
  const nextTourStep = () => { walletSetup?.next(); };
  const previousTourStep = () => { walletSetup?.previous(); };
  const skipTour = () => { walletSetup?.skip(); };
  const showGuide = Boolean(!showHistory && tourRequested && onReviewRecovery && onPersonalizeAddress);
  useBackButton(() => {
    if (showGuide) {
      if (walletSetup?.progress.step === 'language') skipTour();
      else previousTourStep();
    } else if (showHistory) setHistoryOpen(false);
  }, (showGuide || showHistory) && !setupPaused);

  const openSendDialog = useCallback(() => {
    setSendDialogSession(s => s + 1);
    setIsSendDialogOpen(true);
  }, []);
  const openReceiveDialog = useCallback(() => {
    setReceiveDialogSession(s => s + 1);
    setIsReceiveDialogOpen(true);
  }, []);
  const openBuyBitcoinDialog = useCallback(() => {
    setBuyBitcoinSession(s => s + 1);
    setIsBuyBitcoinOpen(true);
  }, []);

  const transactionsContainerRef = useRef<HTMLDivElement>(null);
  const previousView = useRef('');
  useLayoutEffect(() => {
    // New views and guide chapters always start at their heading. Prevent focus
    // from scrolling the small-screen container back to a previous chapter.
    const scroller = transactionsContainerRef.current;
    if (!scroller) return;
    const view = showHistory ? 'history' : showGuide ? `guide:${walletSetup?.progress.step}` : 'home';
    if (previousView.current !== view) scroller.scrollTop = 0;
    previousView.current = view;
    if (showGuide && !setupPaused) {
      scroller.querySelector<HTMLElement>('[data-guide-heading]')?.focus({preventScroll: true});
    }
  }, [showHistory, showGuide, walletSetup?.progress.step, setupPaused]);

  // A forced sync rather than the 60s timer's, so a deposit sent from another
  // device shows at once. The synced event it fires refreshes the list.
  const syncNow = useCallback(async () => {
    try {
      await wallet.syncWallet({});
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Pull to refresh failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }, [wallet]);

  const exitState = useUnilateralExitEngineState();
  const exitEntries = useMemo(() => unilateralExitEntries(exitState), [exitState]);
  const selectedExit = exitState.archive.find(exit => exit.id === selectedExitId) ?? null;
  const handleExitSelected = useCallback((entry: UnilateralExitEntry) => {
    if (entry.isActive) onOpenUnilateralExit();
    else setSelectedExitId(entry.id);
  }, [onOpenUnilateralExit]);

  // Refs for dialog states to use in stable callbacks (advanced-event-handler-refs optimization)
  const dialogStateRef = useLatest({ isSendDialogOpen, isReceiveDialogOpen, selectedPayment, selectedDeposit });
  const handlePaymentSelected = useCallback((payment: Payment | ExtendedPayment) => {
    // Use ref to check dialog states without adding to dependencies
    const { isSendDialogOpen, isReceiveDialogOpen, selectedPayment, selectedDeposit } = dialogStateRef.current;

    // If any dialog is open, just close it without opening payment details
    if (isSendDialogOpen || isReceiveDialogOpen || selectedPayment || selectedDeposit) {
      setIsSendDialogOpen(false);
      setIsReceiveDialogOpen(false);
      setTappedPayment(null);
      setSelectedOutpoint(null);
      return;
    }

    // Check if this is an unclaimed deposit
    if (isUnclaimedDepositPayment(payment) && payment.depositInfo) {
      // Open deposit details dialog
      setSelectedOutpoint(`${payment.depositInfo.txid}:${payment.depositInfo.vout}`);
    } else {
      // Open regular payment details
      setTappedPayment(payment);
    }
  }, [dialogStateRef]);

  const handlePaymentDetailsClose = useCallback(() => {
    setTappedPayment(null);
  }, []);

  const handleDepositDetailsClose = useCallback(() => {
    setSelectedOutpoint(null);
  }, []);

  const handleDepositChanged = useCallback(async () => {
    setSelectedOutpoint(null);
    onDepositChanged?.();
    await refreshWalletData(false);
  }, [onDepositChanged, refreshWalletData]);

  // The same refresh without standing the sheet down, for a deposit whose
  // record moved while the user is still looking at it.
  const handleDepositRefreshed = useCallback(async () => {
    onDepositChanged?.();
    await refreshWalletData(false);
  }, [onDepositChanged, refreshWalletData]);

  const handleSuccessfulSend = useCallback((lightningAddress?: string) => {
    if (lightningAddress) {
      setTimeout(() => {
        showToast('info', 'Save as contact?', lightningAddress, {
          label: 'Save',
          onClick: () => {
            setSaveContactSession(s => s + 1);
            setSaveContactAddress(lightningAddress);
          },
        });
      }, 500);
    }
  }, [showToast]);

  const handleSendDialogClose = useCallback(() => {
    setIsSendDialogOpen(false);
    setPaymentInput(null);
    refreshWalletData(false);
  }, [refreshWalletData]);

  const handleReceiveDialogClose = useCallback(() => {
    setIsReceiveDialogOpen(false);
    refreshWalletData(false);
  }, [refreshWalletData]);

  const handleQrScannerClose = useCallback(() => {
    setIsQrScannerOpen(false);
    setScannerOpenedFromSend(false);
    if (!scannerOpenedFromSend) {
      setIsSendDialogOpen(false);
      setPaymentInput(null);
    }
  }, [scannerOpenedFromSend]);

  const handleScanFromSendDialog = useCallback(() => {
    setScannerOpenedFromSend(true);
    setIsQrScannerOpen(true);
  }, []);

  const handleScanFromWallet = useCallback(() => {
    setPaymentInput(null);
    setScannerOpenedFromSend(false);
    openSendDialog();
    setIsQrScannerOpen(true);
  }, [openSendDialog]);

  // Links and scans share Send's parser and review gates. The request ID lets
  // another intentional scan of the same QR start a fresh resolution.
  useEffect(() => onDeepLink((input) => {
    setPaymentInput({raw: input, id: ++paymentInputSequence.current});
    openSendDialog();
  }), [openSendDialog]);

  const handleQrScan = useCallback((data: string) => {
    setPaymentInput({raw: data, id: ++paymentInputSequence.current});
    setScannerOpenedFromSend(false);
    setIsQrScannerOpen(false);
  }, []);

  return (
    <div className={`gys-wallet ${showHistory ? "gys-wallet--history-open" : ""} flex flex-col h-[calc(100dvh)] relative overflow-hidden`}>
      {learningOpen && bitcoinLearning && onReviewRecovery && (
        <BitcoinLearningJourney learning={bitcoinLearning} paused={setupPaused}
          onOpenWallet={() => walletSetup?.skip()} onReviewRecovery={onReviewRecovery}/>
      )}
      <aside className="gys-desktop-nav" aria-label="Wallet navigation">
        <GetYourSatsWordmark compact/>
        <nav>
          <button type="button" aria-current={!settingsActive&&!showHistory&&!gysPosOpen?'page':undefined} onClick={()=>navigate('wallet')}>{trustCopy(language).wallet}</button>
          <button type="button" aria-current={!settingsActive&&showHistory&&!gysPosOpen?'page':undefined} onClick={()=>navigate('history')}>{trustCopy(language).history}</button>
          <button type="button" aria-current={!settingsActive&&gysPosOpen?'page':undefined} onClick={()=>navigate('merchant')}>{trustCopy(language).merchant}</button>
          <button type="button" aria-current={settingsActive?'page':undefined} onClick={()=>navigate('settings')}>{copy.settings}</button>
          <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">{trustCopy(language).help}</a>
        </nav>
        <p>Bitcoin first. Every sat counts.</p>
      </aside>
      {/* Atmospheric background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-radial from-spark-primary/15 via-spark-primary/5 to-transparent blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-[300px] h-[300px] bg-gradient-radial from-spark-primary/10 to-transparent blur-3xl" />
      </div>

      <WalletToolbar
        onOpenMenu={() => setIsMenuOpen(true)} onScan={handleScanFromWallet}
        onOpenBuyBitcoin={!featureAvailability.buyBitcoin || enabledBuyProviders.length === 0 ? undefined : () => {
          if (enabledBuyProviders.length === 1 && enabledBuyProviders[0] === 'moonpay') {
            setIsBuyLoading(true);
            onBuyBitcoin(enabledBuyProviders[0]).finally(() => setIsBuyLoading(false));
          } else openBuyBitcoinDialog();
        }}
        isBuyLoading={isBuyLoading} hasRejectedDeposits={hasRejectedDeposits}
        onOpenGetRefund={() => onOpenGetRefund('icon')}
      />
      <div ref={transactionsContainerRef} id="gys-wallet-history"
        className={`gys-wallet__activity ${showGuide ? 'gys-wallet__activity--guide' : ''}`}
        data-testid="wallet-scroll">
        <PullToRefresh scrollerRef={transactionsContainerRef} onRefresh={syncNow}/>
        {showGuide && walletSetup && onReviewRecovery && onPersonalizeAddress ? (
          <WalletSetupTour
            step={walletSetup.progress.step}
            recoveryMethod={recoveryMethod} recoveryStatus={walletSetup.progress.recoveryStatus}
            hasNativeAddress={isGetYourSatsAddress(primaryLightningAddress.address?.lightningAddress)}
            paused={setupPaused} onNext={nextTourStep} onPrevious={previousTourStep} onSkip={skipTour}
            onReviewRecovery={onReviewRecovery} onPersonalize={onPersonalizeAddress}
            onOpenReceive={openReceiveDialog} onOpenPos={() => setGysPosOpen(true)}
          />
        ) : <>
          {!showHistory && <div className="gys-home-content">
            <div className="gys-home-balance" data-wallet-tour="balance">
              <CollapsingWalletHeader walletInfo={walletInfo} scrollProgress={0} showToolbar={false}
                onOpenMenu={() => setIsMenuOpen(true)} isSyncing={isSyncing}/>
            </div>
            <WalletIdentityCard identity={primaryLightningAddress} onPersonalize={onPersonalizeAddress}/>
            {walletSetup?.scope && onReviewRecovery && <WalletSetupCard setup={walletSetup}
              paused={setupPaused} onReviewRecovery={onReviewRecovery} onStartTour={startTour} compact/>}
            <button type="button" className="gys-home-pos" data-testid="home-pos" onClick={()=>setGysPosOpen(true)}>
              <ArrowDownIcon/><span>{copy.pointOfSale}</span><ChevronRightIcon size="sm" className="rtl:rotate-180"/>
            </button>
            {!settingsActive && <MarketPulse compact/>}
          </div>}
          <WalletActivityPanel
            view={showHistory ? 'history' : 'activity'} onViewChange={view => setHistoryOpen(view === 'history')}
            transactions={mergeDepositsWithTransactions(transactions, unclaimedDeposits)}
            onPaymentSelected={handlePaymentSelected} isSyncing={isSyncing}
            exitEntries={exitEntries} onExitSelected={handleExitSelected}
            onRefresh={() => { void syncNow(); }}
          />
        </>}
      </div>

      {/* Send Payment Dialog - always mounted for instant response */}
      <SendPaymentDialog
        key={`send-${sendDialogSession}`}
        isOpen={isSendDialogOpen}
        onClose={handleSendDialogClose}
        initialRawInput={paymentInput?.raw}
        initialInputId={paymentInput?.id}
        coveredByScanner={isQrScannerOpen}
        onScanQr={handleScanFromSendDialog}
        onSuccessfulSend={handleSuccessfulSend}
      />

      {/* Receive Payment Dialog - always mounted for instant response */}
      <ReceivePaymentDialog
        key={`receive-${receiveDialogSession}`}
        isOpen={isReceiveDialogOpen}
        onClose={handleReceiveDialogClose}
      />

      {/* Buy Bitcoin Dialog */}
      <BuyBitcoinDialog
        key={`buy-${buyBitcoinSession}`}
        isOpen={isBuyBitcoinOpen}
        onClose={() => setIsBuyBitcoinOpen(false)}
        onBuyBitcoin={onBuyBitcoin}
        network={network}
      />

      {/* QR Scanner Dialog */}
      <QrScannerDialog
        isOpen={isQrScannerOpen}
        onClose={handleQrScannerClose}
        onScan={handleQrScan}
        zIndex={60}
      />

      {/* Payment Details Dialog */}
      {selectedPayment && (
        <PaymentDetailsDialog
          optionalPayment={selectedPayment}
          onClose={handlePaymentDetailsClose}
        />
      )}

      {selectedExit && (
        <ArchivedExitDialog exit={selectedExit} onClose={() => setSelectedExitId(null)} />
      )}

      {/* Keyed on deposit identity so the page remounts on a new
          selection and lazy-inits its claim/fee state. */}
      {selectedDeposit && (
        <UnclaimedDepositDetailsPage
          key={`${selectedDeposit.txid}:${selectedDeposit.vout}`}
          deposit={selectedDeposit}
          onBack={handleDepositDetailsClose}
          onChanged={handleDepositChanged}
          onRefresh={handleDepositRefreshed}
        />
      )}

      <nav className="gys-action-dock" aria-label="Wallet actions" style={{paddingBottom: `max(10px, ${safeAreaBottom})`}}>
        <button type="button" onClick={openReceiveDialog} data-testid="receive-button" aria-label="Receive Bitcoin" data-wallet-tour="receive"
          className="gys-action-dock__receive"><ArrowDownIcon/><span>{wc.receive}</span></button>
        <button type="button" onClick={openSendDialog} data-testid="send-button" aria-label="Send Bitcoin"
          className="gys-action-dock__send"><ArrowUpIcon/><span>{wc.send}</span></button>
      </nav>

      {/* Save Contact Dialog */}
      <SaveContactDialog
        key={`save-contact-${saveContactSession}`}
        isOpen={!!saveContactAddress}
        lightningAddress={saveContactAddress || ''}
        onClose={() => setSaveContactAddress(null)}
      />

      {/* Side Menu */}
      {gysPosOpen&&<PosErrorBoundary onClose={()=>setGysPosOpen(false)}><GetYourSatsPos onClose={()=>setGysPosOpen(false)}/></PosErrorBoundary>}
      {partnerBuyOpen&&<PartnerBuyDialog network={network} onClose={()=>setPartnerBuyOpen(false)}/>}
      <SideMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onLogout={onLogout}
        onOpenHistory={()=>{setHistoryOpen(true);setIsMenuOpen(false);}}
        onOpenSettings={onOpenSettings}
        onOpenFiatCurrencies={onOpenFiatCurrencies}
        onOpenDca={onOpenDca}
        onOpenScan={handleScanFromWallet}
        onOpenMerchantPos={()=>setGysPosOpen(true)}
        onOpenPartnerBuy={()=>setPartnerBuyOpen(true)}
        onOpenRefund={() => onOpenGetRefund('menu')}
        hasRejectedDeposits={hasRejectedDeposits}
      />
    </div>
  );
};

export default WalletPage;
