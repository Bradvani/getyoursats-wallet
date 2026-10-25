import PaymentReconciliationBanner from '../security/PaymentReconciliationBanner';
import {isRestrictedBrowserWallet} from '../security/browserReleasePolicy';
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
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useToast } from '../contexts/ToastContext';
import { logger, LogCategory } from '@/services/logger';
import CollapsingWalletHeader from '../components/CollapsingWalletHeader';
import SideMenu from '../components/SideMenu';
import MarketPulse from '../getyoursats/MarketPulse';
import WalletActivityPanel from '../getyoursats/WalletActivityPanel';
import PullToRefresh from '../components/PullToRefresh';
import { GetInfoResponse, Payment, DepositInfo, Network } from '@breeztech/breez-sdk-spark';
import type { BuyBitcoinProvider } from '../services/settings';
import { ArrowUpIcon, QrCodeIcon, ArrowDownIcon, ClockIcon } from '../components/Icons';
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
  onOpenFiatCurrencies?: () => void;
  onOpenDca: () => void;
  onOpenUnilateralExit: () => void;
  onBuyBitcoin: (provider: BuyBitcoinProvider) => Promise<void>;
  network?: Network;
  onDepositChanged?: () => void;
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
  onOpenFiatCurrencies,
  onOpenDca,
  onOpenUnilateralExit,
  onBuyBitcoin,
  network,
  onDepositChanged,
}) => {
  const wallet = useWallet();
  const restrictedBrowser = isRestrictedBrowserWallet(wallet);
  const {language,copy}=usePresentation();
  const wc=WALLET_COPY[language];
  const { showToast } = useToast();

  // Tint the native system bars to the wallet page glass effective
  // color so the CollapsingWalletHeader glassmorphism reads as a
  // continuous surface with the status bar. Other pages (drawer,
  // slide-ins, landing) push spark-surface on top of this via the
  // same manager, and their pop restores #13131d when they close.
  useStatusBarColor(STATUS_BAR_WALLET_GLASS);

  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [gysPosOpen,setGysPosOpen] = useState(false);
  const [partnerBuyOpen,setPartnerBuyOpen] = useState(false);
  const [historyOpen,setHistoryOpen] = useState(false);
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
  const [paymentInput, setPaymentInput] = useState<string | null>(null);
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

  // A forced sync rather than the 60s timer's, so a deposit sent from another
  // device shows at once. The synced event it fires refreshes the list.
  const syncNow = useCallback(async () => {
    if (restrictedBrowser) {
      await refreshWalletData(false);
      showToast('info', 'This security preview shows cached wallet data. Live synchronization is unavailable until payment recovery is verified.');
      return;
    }
    try {
      await wallet.syncWallet({});
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Pull to refresh failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }, [wallet, restrictedBrowser, refreshWalletData, showToast]);

  const exitState = useUnilateralExitEngineState();
  const exitEntries = useMemo(() => unilateralExitEntries(exitState), [exitState]);
  const selectedExit = exitState.archive.find(exit => exit.id === selectedExitId) ?? null;
  const handleExitSelected = useCallback((entry: UnilateralExitEntry) => {
    if (entry.isActive) onOpenUnilateralExit();
    else setSelectedExitId(entry.id);
  }, [onOpenUnilateralExit]);

  // Refs for dialog states to use in stable callbacks (advanced-event-handler-refs optimization)
  const dialogStateRef = useLatest({ isSendDialogOpen, isReceiveDialogOpen, selectedPayment, selectedDeposit });
  const collapseThreshold = 100;

  const handleScroll = useCallback(() => {
    if (transactionsContainerRef.current) {
      const scrollTop = transactionsContainerRef.current.scrollTop;
      const progress = Math.min(1, scrollTop / collapseThreshold);
      setScrollProgress(progress);
    }
  }, [collapseThreshold]);

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
    // If scanner was opened from Send dialog, reopen it
    if (scannerOpenedFromSend) {
      setScannerOpenedFromSend(false);
      openSendDialog();
    }
  }, [scannerOpenedFromSend, openSendDialog]);

  const handleScanFromSendDialog = useCallback(() => {
    setIsSendDialogOpen(false);
    setPaymentInput(null);
    setScannerOpenedFromSend(true);
    setIsQrScannerOpen(true);
  }, []);

  // A tapped lightning: / bitcoin: / lnurlp: / lnurlw: / keyauth: / glow: link
  // opens the send sheet on it. Unlike the QR path there is no pre-parse: the OS just
  // switched the user into Glow, so an unreadable link has to say so on screen
  // rather than land on the home page having apparently done nothing. The
  // sheet parses `initialRawInput` itself and surfaces its own error.
  useEffect(() => onDeepLink((input) => {
    setPaymentInput(input);
    openSendDialog();
  }), [openSendDialog]);

  const handleQrScan = async (data: string | null) => {
    if (!data) return;

    try {
      const parseResult = await wallet.parse(data);
      logger.debug(LogCategory.UI, 'Parsed QR result', {
        resultType: parseResult.type,
      });
      setIsQrScannerOpen(false);
      setScannerOpenedFromSend(false);
      setPaymentInput(data);
      openSendDialog();
    } catch (error) {
      logger.error(LogCategory.UI, 'Failed to parse QR code', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className={`gys-wallet ${historyOpen ? "gys-wallet--history-open" : ""} flex flex-col h-[calc(100dvh)] relative overflow-hidden`}>
      <aside className="gys-desktop-nav" aria-label="Wallet navigation">
        <GetYourSatsWordmark compact/>
        <nav>
          <button type="button" aria-current={!historyOpen?'page':undefined} onClick={()=>setHistoryOpen(false)}>{trustCopy(language).wallet}</button>
          <button type="button" aria-current={historyOpen?'page':undefined} onClick={()=>setHistoryOpen(true)}>{trustCopy(language).history}</button>
          <button type="button" onClick={()=>setGysPosOpen(true)}>{trustCopy(language).merchant}</button>
          <button type="button" onClick={onOpenSettings}>{copy.settings}</button>
          <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">{trustCopy(language).help}</a>
        </nav>
        <p>Bitcoin first. Every sat counts.</p>
      </aside>
      {/* Atmospheric background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-radial from-spark-primary/15 via-spark-primary/5 to-transparent blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-[300px] h-[300px] bg-gradient-radial from-spark-primary/10 to-transparent blur-3xl" />
      </div>

      {/* Fixed header */}
      <div className="gys-wallet__header sticky top-0 z-10">
        <CollapsingWalletHeader
          walletInfo={walletInfo}
          scrollProgress={scrollProgress}
          onOpenMenu={() => setIsMenuOpen(true)}
          // Hidden when nothing is left to offer: no provider enabled in
          // Settings, or (on iOS) Cash App not installed.
          onOpenBuyBitcoin={!featureAvailability.buyBitcoin || enabledBuyProviders.length === 0 ? undefined : () => {
            if (enabledBuyProviders.length === 1 && enabledBuyProviders[0] === 'moonpay') {
              // MoonPay can redirect directly; Cash App needs amount entry via the dialog.
              setIsBuyLoading(true);
              onBuyBitcoin(enabledBuyProviders[0]).finally(() => setIsBuyLoading(false));
            } else {
              openBuyBitcoinDialog();
            }
          }}
          isBuyLoading={isBuyLoading}
          isSyncing={isSyncing}
          refreshWalletData={() => refreshWalletData(false)}
          hasRejectedDeposits={hasRejectedDeposits}
          onOpenGetRefund={() => onOpenGetRefund('icon')}
        />
      </div>

      {restrictedBrowser && <aside role="status" className="mx-4 my-3 rounded-xl border border-spark-warning p-3 text-sm text-spark-text-primary">
        <strong>Security preview — live synchronization unavailable.</strong>{' '}
        Balance and history may be out of date. Use disposable test wallets only.
      </aside>}

      {/* Lightning address: ready on first wallet screen, not a hidden signup step. */}
      <div className="gys-address-banner gys-wallet__address" role="status" aria-live="polite">
        <span className="gys-address-banner__label">⚡ {wc.lightning}</span>
        {primaryLightningAddress.address ? (
          <button type="button" className="gys-address-banner__value"
            onClick={()=>void navigator.clipboard.writeText(primaryLightningAddress.address!.lightningAddress).then(()=>showToast('success',trustCopy(language).copySuccess)).catch(()=>showToast('error',trustCopy(language).copyFailure))}
            aria-label="Copy your Lightning address"
            title="Copy Lightning address">
            {primaryLightningAddress.address.lightningAddress}
          </button>
        ):<span className="gys-address-banner__pending">
          {primaryLightningAddress.isLoading?'Setting up your address…':
           primaryLightningAddress.error?'Address temporarily unavailable':
           primaryLightningAddress.isSupported?'Tap Receive to set up':'Not available on this network'}
        </span>}
      </div>
      {/* Recovery words stay inside Settings; they must not be one tap
          away from the everyday wallet without an authenticated web app lock. */}
      <nav className="gys-home-quick-actions" aria-label="Merchant and planning actions">
        <button type="button" className="gys-home-quick-actions__button"
          onClick={()=>setGysPosOpen(true)} aria-label="Open Point of Sale">
          <span className="gys-home-quick-actions__icon" aria-hidden="true"><QrCodeIcon size="lg"/></span>
          <span className="gys-home-quick-actions__text"><strong>{copy.pointOfSale}</strong><small>{wc.accept}</small></span>
        </button>
        <button type="button" className="gys-home-quick-actions__button"
          onClick={featureAvailability.recurringBuy ? onOpenDca : undefined}
          disabled={!featureAvailability.recurringBuy}
          aria-label={featureAvailability.recurringBuy ? 'Open Recurring Buys' : 'Recurring Buys coming soon'}>
          <span className="gys-home-quick-actions__icon" aria-hidden="true"><ClockIcon size="lg"/></span>
          <span className="gys-home-quick-actions__text"><strong>{copy.recurring}</strong><small>{wc.soon}</small></span>
        </button>
      </nav>
      {/* Live SDK market quotes and wallet-verified activity. */}
      <div
        ref={transactionsContainerRef}
        id="gys-wallet-history" className={`gys-wallet__activity grow overflow-y-auto relative z-0 scrollbar-hidden ${historyOpen ? "gys-wallet__activity--open" : ""}`}
        onScroll={handleScroll}
      >
        <PullToRefresh scrollerRef={transactionsContainerRef} onRefresh={syncNow} />

        <PaymentReconciliationBanner/>
        <WalletActivityPanel
          view={historyOpen?'history':'activity'} onViewChange={view=>setHistoryOpen(view==='history')}
          transactions={mergeDepositsWithTransactions(transactions, unclaimedDeposits)}
          onPaymentSelected={handlePaymentSelected}
          isSyncing={isSyncing}
          exitEntries={exitEntries}
          onExitSelected={handleExitSelected}
          onRefresh={() => { void syncNow(); }}
        />
        {!historyOpen&&<details className="gys-market-secondary"><summary>Bitcoin market</summary><MarketPulse/></details>}
      </div>

      {/* Send Payment Dialog - always mounted for instant response */}
      <SendPaymentDialog
        key={`send-${sendDialogSession}`}
        isOpen={isSendDialogOpen}
        onClose={handleSendDialogClose}
        initialRawInput={paymentInput}
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
      {isQrScannerOpen && (
        <QrScannerDialog
          isOpen={isQrScannerOpen}
          onClose={handleQrScannerClose}
          onScan={handleQrScan}
        />
      )}

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

      {/* Receive and Send stay dominant; scanning and POS stay available in the menu. */}
      <nav className="gys-action-dock" aria-label="Wallet actions">
        <button type="button" onClick={openReceiveDialog} data-testid="receive-button" aria-label="Receive Bitcoin"
          className="gys-action-dock__receive"><ArrowDownIcon/><span>{wc.receive}</span></button>
        <button type="button" onClick={openSendDialog} data-testid="send-button" aria-label="Send Bitcoin"
          className="gys-action-dock__send"><ArrowUpIcon/><span>{wc.send}</span></button>
        <button type="button" onClick={()=>setIsQrScannerOpen(true)} data-testid="scan-button" aria-label={wc.scanPayment}
          className="gys-action-dock__utility"><QrCodeIcon/><span>{wc.scan}</span></button>
        <button type="button" onClick={()=>setGysPosOpen(true)} data-testid="pos-button" aria-label={wc.posPayment}
          className="gys-action-dock__accept gys-action-dock__utility"><span className="gys-action-dock__bitcoin" aria-hidden="true">₿</span><span>{wc.acceptShort}</span></button>
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
        onOpenScan={()=>setIsQrScannerOpen(true)}
        onOpenMerchantPos={()=>setGysPosOpen(true)}
        onOpenPartnerBuy={()=>setPartnerBuyOpen(true)}
        onOpenRefund={() => onOpenGetRefund('menu')}
        hasRejectedDeposits={hasRejectedDeposits}
      />
    </div>
  );
};

export default WalletPage;
