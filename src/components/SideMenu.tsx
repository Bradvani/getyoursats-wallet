import {useRef,useEffect} from 'react';
import {useLatest} from '@/hooks/useLatest';
import {useWalletConnection,useHasPendingConversion} from '@/contexts/WalletContext';
import {trustCopy} from '@/getyoursats/trustCopy';
import {runVerifiedRemoval} from '@/getyoursats/removalPolicy';
import { usePresentation } from '@/hooks/usePresentation';
import React, { useState, useSyncExternalStore } from 'react';
import { useAppVersion } from '@/hooks/useAppVersion';
import { PRIVACY_POLICY_URL, SUPPORT_URL } from '@/constants/publicPages';
import { createPortal } from 'react-dom';
import { Transition, TransitionChild } from '@headlessui/react';
import { isPasskeyMode } from '@/services/passkeyService';
import { RefundIcon, SettingsIcon, LogoutIcon, CloseIcon, AlertTriangleIcon, ExternalLinkIcon, QrCodeIcon, CurrencyIcon, ArrowDownIcon, ClockIcon } from './Icons';
import { ACCOUNT_DELETION_GUIDE_URL } from '@/services/accountDeletion';
import { openExternalUrl } from '@/utils/externalLink';
import { safeAreaTop, safeAreaBottom } from '../utils/safeAreaInsets';
import { useStatusBarColor } from '../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE, STATUS_BAR_DIALOG_SCRIM } from '../utils/statusBarManager';
import { useBackButton } from '../hooks/useBackButton';
import { SimpleAlert } from './AlertCard';
import { useUnilateralExitEngineState } from '../features/unilateral-exit/hooks/useUnilateralExitEngineLifecycle';
import GetYourSatsWordmark from './GetYourSatsWordmark';
import {featureAvailability} from '../getyoursats/featureAvailability';

// Public policy and support links are reachable without wallet authentication.

// External-store measurement of the content-root's left offset, used
// to anchor the drawer panel to the centered max-w-4xl column.
// Module-level so identities are stable for useSyncExternalStore.
//
// Only window resize changes the offset; scroll does not. A previous
// version of this listener also subscribed to capture-phase scroll,
// which on mobile fired dozens of forced synchronous layouts per
// inertial scroll burst (every getBoundingClientRect call) and stalled
// the main thread enough to drop frames on the drawer's slide-in.
const subscribeContentRoot = (notify: () => void) => {
  let rafId: number | null = null;
  const initialNotify = () => {
    rafId = null;
    notify();
  };
  // Re-notify after subscribe so the first render (null result before
  // content-root is in the DOM) gets re-evaluated next frame.
  rafId = requestAnimationFrame(initialNotify);
  window.addEventListener('resize', notify);
  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', notify);
  };
};

const getContentRootLeft = (): number | null => {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('content-root');
  return el ? el.getBoundingClientRect().left : null;
};

// SSR contract for useSyncExternalStore. SideMenu is client-only.
const getServerSnapshot = (): number | null => null;

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void | Promise<void>;
  onOpenSettings: () => void;
  onOpenHistory?:()=>void;
  onOpenFiatCurrencies?: () => void;
  onOpenDca: () => void;
  onOpenScan?: () => void;
  onOpenMerchantPos?: () => void;
  onOpenPartnerBuy?: () => void;
  onOpenRefund?: () => void;
  hasRejectedDeposits?: boolean;
}

const SideMenu: React.FC<SideMenuProps> = ({ isOpen, onClose, onLogout, onOpenSettings, onOpenHistory, onOpenDca, onOpenScan, onOpenMerchantPos, onOpenPartnerBuy, onOpenRefund, hasRejectedDeposits = false }) => {
  // While the drawer is open, push the solid spark-surface tone over
  // the wallet page's glass tint so the status bar matches the drawer
  // panel's solid bg. Tied to isOpen so popping happens on close.
  useStatusBarColor(STATUS_BAR_SURFACE, isOpen);

  const leftOffset = useSyncExternalStore(
    subscribeContentRoot,
    getContentRootLeft,
    getServerSnapshot
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [recoveryAcknowledged,setRecoveryAcknowledged]=useState(false);
  const [removalBusy,setRemovalBusy]=useState(false);
  const [removalError,setRemovalError]=useState('');
  const removalLatch=useRef(false);
  const removalEpoch=useRef(0);
  useEffect(()=>()=>{removalEpoch.current++;},[]);
  const cancelRemoval=()=>{removalEpoch.current++;setShowLogoutConfirm(false);};
  const closeMenu=()=>{removalEpoch.current++;onClose();};
  const {sdk}=useWalletConnection();
  const hasPendingConversion=useHasPendingConversion();
  const appVersion = useAppVersion();
  const {language, copy} = usePresentation();

  // When the logout confirmation dialog opens, dim the system bars to
  // the same scrim tone the React backdrop applies to the content
  // behind the dialog. Tied to showLogoutConfirm so closing the
  // dialog restores the drawer's surface tone (which in turn restores
  // the wallet page glass on drawer close).
  useStatusBarColor(STATUS_BAR_DIALOG_SCRIM, showLogoutConfirm);

  // Hardware back button: close the logout confirm dialog if it's
  // up; otherwise close the drawer. Two registrations so they stack
  // in LIFO order — the logout confirm is registered last, so it's
  // on top of the drawer's own handler when both are showing.
  useBackButton(() => {
    closeMenu();
  }, isOpen);
  useBackButton(() => {
    cancelRemoval();
  }, showLogoutConfirm);

  const isPasskey = isPasskeyMode();
  const isExitInProgress = useUnilateralExitEngineState().plan !== null;
  const removalContext=useLatest({sdk,isOpen,showLogoutConfirm,isExitInProgress,hasPendingConversion});

  // Close the drawer first, then fire the navigation callback once the
  // drawer's leave animation completes. Kept sequential (not
  // concurrent) so the drawer's left-edge motion doesn't compete with
  // SlideInPage's left-edge enter — even though z-60 on SlideInPage
  // makes the drawer invisible for most of the overlap, running them
  // back-to-back feels cleaner and gives the user a moment to see the
  // drawer close before the new page arrives. 100ms matches the
  // drawer panel `duration-100` leave transition below — if that
  // changes, bump this too.
  const DRAWER_LEAVE_MS = 100;
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (navigationTimer.current !== null) clearTimeout(navigationTimer.current);
  }, []);
  const closeDrawerThen = (fn: () => void) => {
    onClose();
    if (navigationTimer.current !== null) clearTimeout(navigationTimer.current);
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : DRAWER_LEAVE_MS;
    navigationTimer.current = setTimeout(() => { navigationTimer.current = null; fn(); }, delay);
  };

  // Only actions that work today belong in the primary drawer.
  // Unavailable products remain behind the existing feature gates, not
  // disabled, wrapping rows that compete with core wallet navigation.
  const menuItems = [
    ...(onOpenHistory ? [{
      icon: <ClockIcon />,
      label: trustCopy(language).history,
      onClick: () => closeDrawerThen(onOpenHistory)
    }] : []),
    ...(hasRejectedDeposits && onOpenRefund ? [{
      icon: <RefundIcon />,
      label: 'Refund',
      onClick: () => closeDrawerThen(onOpenRefund),
      highlight: true
    }] : []),
    ...(onOpenScan ? [{
      icon: <QrCodeIcon />,
      label: copy.scan,
      onClick: () => closeDrawerThen(onOpenScan)
    }] : []),
    ...(onOpenMerchantPos ? [{
      icon: <ArrowDownIcon />,
      label: copy.pointOfSale,
      onClick: () => closeDrawerThen(onOpenMerchantPos)
    }] : []),
    { icon: <SettingsIcon />, label: copy.settings, onClick: () => closeDrawerThen(onOpenSettings) },
    ...(featureAvailability.buyBitcoin && onOpenPartnerBuy ? [{
      icon: <CurrencyIcon />, label: copy.buy, onClick: () => closeDrawerThen(onOpenPartnerBuy)
    }] : []),
    ...(featureAvailability.recurringBuy ? [{
      icon: <ClockIcon />, label: copy.recurring, onClick: () => closeDrawerThen(onOpenDca)
    }] : []),
  ];

  const handleConfirmLogout = async () => {
    if(removalLatch.current||!recoveryAcknowledged)return;
    const text=trustCopy(language);
    if((isExitInProgress||hasPendingConversion)){setRemovalError(text.removalBlocked);return;}
    const epoch=++removalEpoch.current;
    removalLatch.current=true;setRemovalBusy(true);setRemovalError('');
    try {
      if(!sdk)throw Error('Wallet unavailable');
      const outcome=await runVerifiedRemoval({
        read:offset=>sdk.listPayments({offset,limit:100}),
        isCurrent:()=>{const current=removalContext.current;return epoch===removalEpoch.current&&current.isOpen&&current.showLogoutConfirm&&current.sdk===sdk&&!current.hasPendingConversion&&!current.isExitInProgress;},
        erase:onLogout,
      });
      if(outcome==='removed'){setShowLogoutConfirm(false);onClose();}
      else if(outcome==='blocked')setRemovalError(text.removalBlocked);
      else if(outcome==='unavailable')setRemovalError(text.removalUnavailable);
    } catch {setRemovalError(text.removalUnavailable);}
    finally {removalLatch.current=false;setRemovalBusy(false);}
  };

  return createPortal(
    <Transition show={isOpen} as="div" className="fixed inset-0 z-50">
      {/* Backdrop — Material 3 emphasized easing (decelerate enter /
          accelerate exit) at 100ms. Duration is faster than M3's
          `motionDurationMedium4` canonical nav-drawer spec (400ms);
          we prioritise snap over the full M3 arc. */}
      <TransitionChild
        as="div"
        enter="transition-opacity ease-m3-emphasized-decelerate duration-150"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity ease-m3-emphasized-accelerate duration-100"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        className="fixed inset-0"
      >
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={closeMenu} />
      </TransitionChild>

      {/* Panel */}
      {leftOffset !== null && (
        <div
          className="fixed top-0 bottom-0 w-[min(88vw,320px)] overflow-hidden"
          style={{ left: leftOffset }}
        >
          <TransitionChild
            as="div"
            enter="transition transform ease-m3-emphasized-decelerate duration-150"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition transform ease-m3-emphasized-accelerate duration-100"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
            className="w-[min(88vw,320px)] h-full bg-spark-surface border-r border-spark-border shadow-glass-lg px-5 flex flex-col"
            style={{ paddingTop: safeAreaTop, paddingBottom: safeAreaBottom }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5 pt-4 shrink-0">
              <GetYourSatsWordmark />
              <button
                onClick={closeMenu}
                className="p-2 -mr-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Compact navigation: working destinations only. */}
            <nav className="flex-1 min-h-0 overflow-y-auto space-y-1" aria-label="Wallet menu">
              {menuItems.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={item.label}
                  className={`w-full min-h-12 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-white/5 hover:text-spark-text-primary ${
                    ('highlight' in item && item.highlight)
                      ? 'text-spark-warning'
                      : 'text-spark-text-secondary'
                  }`}
                  onClick={item.onClick}
                >
                  <span className="shrink-0 flex h-6 w-6 items-center justify-center" aria-hidden="true">{item.icon}</span>
                  <span className="min-w-0 text-[15px] leading-5 font-display font-medium">{item.label}</span>
                </button>
              ))}
            </nav>

            {/* Destructive action and help remain clearly separate, without
                boxed links, disabled-product badges or heavy dividers. */}
            <div className="shrink-0 pb-5 pt-3 space-y-3">
              <button
                type="button"
                onClick={() => { setRecoveryAcknowledged(false); setRemovalError(''); setShowLogoutConfirm(true); }}
                aria-label={trustCopy(language).removeTitle}
                className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-xl text-sm text-spark-text-muted hover:text-spark-warning hover:bg-spark-warning/5"
              >
                <span className="shrink-0 flex h-6 w-6 items-center justify-center" aria-hidden="true"><LogoutIcon /></span>
                <span className="leading-5">{trustCopy(language).removeTitle}</span>
              </button>
              <div className="flex items-center justify-start gap-5 pl-3 text-xs text-spark-text-muted">
                <button type="button"
                  onClick={() => { void openExternalUrl(PRIVACY_POLICY_URL + '?lang=' + language); }}
                  className="min-h-10 hover:text-spark-text-primary">{copy.privacy}</button>
                <button type="button"
                  onClick={() => { void openExternalUrl(SUPPORT_URL + '?lang=' + language); }}
                  className="min-h-10 hover:text-spark-text-primary">{copy.support}</button>
              </div>
              <p data-testid="menu-app-version" className="pl-3 text-[11px] text-spark-text-muted">
                GetYourSats · v{appVersion}
              </p>
            </div>

            {/* Logout Confirmation Dialog.
                Scrim is intentionally light (bg-black/50, blur-sm): this
                dialog is nested inside the drawer, whose own bg-black/60 +
                blur-sm scrim is already behind it. A standalone-weight
                bg-black/85 would stack on top and read as ~94% black with
                doubled blur; bg-black/50 over the drawer lands at the ~80%
                a normal dialog shows. */}
            <Transition show={showLogoutConfirm} as="div" className="fixed inset-0 z-60">
              <TransitionChild
                as="div"
                enter="transition-opacity ease-out duration-150"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="transition-opacity ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
                className="fixed inset-0 bg-black/50 backdrop-blur-sm"
                onClick={cancelRemoval}
              />
              <div className="fixed inset-0 flex items-center justify-center p-4">
                <TransitionChild
                  as="div"
                  enter="transition transform ease-out duration-200"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="transition transform ease-in duration-150"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                  className="w-full max-w-sm bg-spark-surface border border-spark-border rounded-2xl p-6 shadow-glass-lg"
                >
                  {/* Warning Icon */}
                  <div className="flex justify-center mb-4">
                    <div className="w-14 h-14 rounded-full bg-spark-warning/15 flex items-center justify-center">
                      <AlertTriangleIcon className="w-7 h-7 text-spark-warning" />
                    </div>
                  </div>

                  <h3 className="font-display text-lg font-semibold text-spark-text-primary text-center mb-2">
                    {trustCopy(language).removeTitle}
                  </h3>
                  <p className={`text-spark-text-secondary text-sm text-center ${isPasskey ? 'mb-3' : 'mb-6'}`}>
                    {trustCopy(language).removeBody}
                  </p>
                  {isPasskey && (
                    <button
                      type="button"
                      onClick={() => { void openExternalUrl(ACCOUNT_DELETION_GUIDE_URL); }}
                      className="mx-auto mb-6 flex items-center gap-1 text-xs text-spark-text-muted underline hover:text-spark-text-secondary transition-colors"
                    >
                      How to remove your passkey
                      <ExternalLinkIcon size="xs" />
                    </button>
                  )}

                  {/* Logout wipes the plan and the backup an exit needs, and the
                      phrase alone cannot finish it: only saved exit data can. */}
                  {isExitInProgress && (
                    <SimpleAlert variant="warning" hideIcon className="mb-6 text-left">
                      A unilateral exit is in progress, and logging out deletes what it needs to
                      finish. Save its exit data first, from the exit&apos;s Advanced section.
                    </SimpleAlert>
                  )}

                  <label className="my-4 flex items-start gap-3 text-sm text-spark-text-secondary">
                    <input type="checkbox" checked={recoveryAcknowledged} disabled={removalBusy} onChange={e=>setRecoveryAcknowledged(e.target.checked)}/>
                    {trustCopy(language).recoveryCheck}
                  </label>
                  {removalError&&<p role="alert" className="mb-3 text-sm text-spark-warning">{removalError}</p>}
                  <div className="flex gap-3">
                    <button
                      onClick={cancelRemoval}
                      className="flex-1 px-4 py-3 border border-spark-border text-spark-text-secondary rounded-xl font-medium hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={()=>void handleConfirmLogout()}
                      disabled={!recoveryAcknowledged||removalBusy||isExitInProgress}
                      className="flex-1 px-4 py-3 bg-spark-primary text-black rounded-xl font-medium hover:bg-spark-primary/90 transition-colors"
                    >
                      {trustCopy(language).removeTitle}
                    </button>
                  </div>
                </TransitionChild>
              </div>
            </Transition>
          </TransitionChild>
        </div>
      )}
    </Transition>,
    document.body
  );
};

export default SideMenu;
