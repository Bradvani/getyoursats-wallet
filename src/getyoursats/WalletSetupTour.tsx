import {Dialog, DialogDescription, DialogPanel, DialogTitle} from '@headlessui/react';
import {useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {PrimaryButton, SecondaryButton} from '../components/ui/buttons';
import {useBackButton} from '../hooks/useBackButton';
import {safeAreaBottom, safeAreaTop} from '../utils/safeAreaInsets';
import './walletSetup.css';

export type WalletTourStep = 'protect' | 'balance' | 'receive' | 'identity';

interface WalletSetupTourProps {
  step: WalletTourStep;
  recoveryMethod: 'passkey' | 'phrase' | 'device';
  recoveryStatus: 'pending' | 'passkey-reviewed' | 'phrase-verified';
  hasNativeAddress: boolean;
  onNext: () => void;
  onSkip: () => void;
  onReviewRecovery: () => void;
  onPersonalize: () => void;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TourLayout {
  anchor: Rect | null;
  panel: Rect;
  placement: 'above' | 'below' | 'beside' | 'center';
}

const steps: WalletTourStep[] = ['protect', 'balance', 'receive', 'identity'];
const stepNames = ['Recovery', 'Balance', 'Receive', 'Your name'];

function viewport(): Rect {
  const view = window.visualViewport;
  return {
    left: view?.offsetLeft ?? 0,
    top: view?.offsetTop ?? 0,
    width: view?.width || window.innerWidth,
    height: view?.height || window.innerHeight,
  };
}

function centeredLayout(): TourLayout {
  const view = viewport();
  const width = Math.max(0, Math.min(408, view.width - 32));
  const height = Math.max(0, Math.min(354, view.height - 32));
  return {
    anchor: null,
    panel: {
      left: view.left + (view.width - width) / 2,
      top: view.top + (view.height - height) / 2,
      width,
      height,
    },
    placement: 'center',
  };
}

function visibleTarget(target: HTMLElement, view: Rect): Rect | null {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  let left = Math.max(view.left + 4, rect.left - 6);
  let top = Math.max(view.top + 4, rect.top - 6);
  let right = Math.min(view.left + view.width - 4, rect.right + 6);
  let bottom = Math.min(view.top + view.height - 4, rect.bottom + 6);
  for (let parent = target.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft);
      right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
    }
    if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
      top = Math.max(top, bounds.top + parent.clientTop);
      bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
    }
  }
  return right - left >= 20 && bottom - top >= 20
    ? {left, top, width: right - left, height: bottom - top}
    : null;
}

function recoveryCopy(method: WalletSetupTourProps['recoveryMethod'], status: WalletSetupTourProps['recoveryStatus']) {
  if (status === 'phrase-verified') {
    return {
      title: 'Your backup comes first',
      body: 'You checked your recovery words. Keep the handwritten backup somewhere private, separate from this device.',
      detail: 'Offline backup confirmed',
    };
  }
  if (method === 'passkey' && status === 'passkey-reviewed') {
    return {
      title: 'Your way back in',
      body: 'You reviewed access to your passkey. An independent offline backup is still available in Settings.',
      detail: 'Passkey recovery reviewed',
    };
  }
  if (method === 'passkey') {
    return {
      title: 'Start with recovery',
      body: 'Your passkey opens this wallet. Review where it is saved and how you will get back in if you change devices.',
      detail: 'An offline backup is optional.',
    };
  }
  return {
    title: 'Start with recovery',
    body: method === 'device'
      ? 'This device holds your wallet keys. An offline recovery backup gives you a way back if it is lost or replaced.'
      : 'Your recovery words are the way back to this wallet. Check your offline backup before adding more sats.',
    detail: 'Your recovery words stay private.',
  };
}

export default function WalletSetupTour({
  step, recoveryMethod, recoveryStatus, hasNativeAddress,
  onNext, onSkip, onReviewRecovery, onPersonalize,
}: WalletSetupTourProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [layout, setLayout] = useState<TourLayout>(centeredLayout);
  const index = steps.indexOf(step);
  const content = step === 'protect' ? recoveryCopy(recoveryMethod, recoveryStatus)
    : step === 'balance' ? {
      title: 'Your sats, at a glance',
      body: 'Use the tabs below your balance to view sats, BTC or your display currency. Choose your currency in Settings.',
      detail: 'Display preferences do not move your funds.',
    }
    : step === 'receive' ? {
      title: 'Receive your first sats',
      body: 'Open Receive to show your QR or copy your Lightning address. Share it with someone sending you sats.',
      detail: 'Your wallet is ready to use while setup is unfinished.',
    }
    : hasNativeAddress ? {
      title: 'Your name is ready',
      body: 'Copy your GetYourSats address from Home or Receive whenever someone wants to send you sats.',
      detail: 'You can revisit this tour in Settings.',
    } : {
      title: 'Make your address yours',
      body: 'Verify an email in Settings to choose an available name for your GetYourSats address.',
      detail: 'Email is optional and does not recover your wallet.',
    };

  // Let Dialog discover its application root before enabling modal isolation.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Headless UI needs a committed closed render to identify the background root.
    setReady(true);
  }, []);

  useBackButton(onSkip, ready);

  useLayoutEffect(() => {
    if (!ready) return;
    let frame: number | null = null;
    const target = document.querySelector<HTMLElement>(`[data-wallet-tour="${step}"]`);
    const measure = () => {
      frame = null;
      const view = viewport();
      const bounds = boundsRef.current;
      const css = bounds ? getComputedStyle(bounds) : null;
      const inset = (side: 'Top' | 'Right' | 'Bottom' | 'Left') => {
        const value = Number.parseFloat(css?.[`padding${side}`] ?? '');
        return Number.isFinite(value) ? Math.max(12, value) : 16;
      };
      const left = view.left + inset('Left');
      const top = view.top + inset('Top');
      const right = view.left + view.width - inset('Right');
      const bottom = view.top + view.height - inset('Bottom');
      const width = Math.max(0, Math.min(408, right - left));
      const fullHeight = Math.max(0, bottom - top);
      const measuredHeight = (headerRef.current?.offsetHeight ?? 0)
        + (bodyRef.current?.scrollHeight ?? 0)
        + (footerRef.current?.offsetHeight ?? 0) + 2;
      const desiredHeight = Math.min(fullHeight, measuredHeight > 40 ? measuredHeight : 354);
      const found = document.querySelector<HTMLElement>(`[data-wallet-tour="${step}"]`);
      let anchor = found ? visibleTarget(found, view) : null;
      let placement: TourLayout['placement'] = 'center';
      let panel: Rect = {
        left: left + (right - left - width) / 2,
        top: top + (fullHeight - desiredHeight) / 2,
        width,
        height: desiredHeight,
      };
      const gap = 14;
      if (anchor) {
        const roomBelow = bottom - anchor.top - anchor.height - gap;
        const roomAbove = anchor.top - top - gap;
        const roomRight = right - anchor.left - anchor.width - gap;
        const roomLeft = anchor.left - left - gap;
        if (view.width >= 760 && (roomRight >= width || roomLeft >= width)) {
          placement = 'beside';
          panel = {
            ...panel,
            left: roomRight >= width ? anchor.left + anchor.width + gap : anchor.left - width - gap,
            top: Math.max(top, Math.min(bottom - desiredHeight, anchor.top)),
          };
        } else if (Math.max(roomBelow, roomAbove) >= desiredHeight) {
          const below = roomBelow >= desiredHeight;
          placement = below ? 'below' : 'above';
          panel = {
            ...panel,
            left: Math.max(left, Math.min(right - width, anchor.left + anchor.width / 2 - width / 2)),
            top: below ? anchor.top + anchor.height + gap : anchor.top - desiredHeight - gap,
          };
        } else {
          // Center the full card when a separate spotlight would hide actions.
          anchor = null;
        }
      }
      const next = {anchor, panel, placement};
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    if (target) {
      const rect = target.getBoundingClientRect();
      const view = viewport();
      const visible = visibleTarget(target, view);
      if (!visible || visible.height < rect.height || visible.width < rect.width) {
        target.scrollIntoView?.({block: 'nearest', inline: 'nearest', behavior: 'instant'});
      }
    }
    measure();
    const resize = new ResizeObserver(schedule);
    for (const element of [target, panelRef.current, boundsRef.current]) {
      if (element) resize.observe(element);
    }
    const mutation = new MutationObserver(schedule);
    const wallet = target?.closest('.gys-wallet');
    if (wallet) mutation.observe(wallet, {childList: true, subtree: true});
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [ready, step, recoveryMethod, recoveryStatus, hasNativeAddress]);

  const panelStyle: CSSProperties = {
    left: layout.panel.left,
    top: layout.panel.top,
    width: layout.panel.width,
    maxHeight: layout.panel.height,
  };
  const boundsStyle = {
    '--gys-tour-safe-top': safeAreaTop,
    '--gys-tour-safe-bottom': safeAreaBottom,
  } as CSSProperties;

  return (
    <Dialog open={ready} onClose={onSkip} className="gys-wallet-tour" aria-label="Wallet tour">
      <div ref={boundsRef} className="gys-wallet-tour__bounds" style={boundsStyle} aria-hidden="true" />
      {layout.anchor
        ? <div className="gys-wallet-tour__spotlight" style={layout.anchor} aria-hidden="true" />
        : <div className="gys-wallet-tour__scrim" aria-hidden="true" />}
      <DialogPanel ref={panelRef} className="gys-wallet-tour__panel" style={panelStyle}
        data-wallet-tour-step={step} data-placement={layout.placement}>
        <div ref={headerRef} className="gys-wallet-tour__header">
          <div className="gys-wallet-tour__eyebrow">
            <DialogTitle as="span">Wallet tour</DialogTitle><span>{index + 1} of {steps.length}</span>
          </div>
          <div className="gys-wallet-tour__progress" role="progressbar" aria-label="Tour progress"
            aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1}
            aria-valuetext={`Step ${index + 1} of ${steps.length}: ${stepNames[index]}`}>
            {steps.map((item, position) => <span key={item} data-passed={position <= index} />)}
          </div>
        </div>
        <div ref={bodyRef} className="gys-wallet-tour__body">
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            Step {index + 1} of {steps.length}: {content.title}
          </p>
          <h2 className="gys-wallet-tour__title">{content.title}</h2>
          <DialogDescription className="gys-wallet-tour__description">{content.body}</DialogDescription>
          <p className="gys-wallet-tour__detail">{content.detail}</p>
          {step === 'protect' && recoveryStatus !== 'phrase-verified' && (
            <SecondaryButton className="gys-wallet-tour__context-action" onClick={onReviewRecovery}>
              Review Recovery
            </SecondaryButton>
          )}
          {step === 'identity' && !hasNativeAddress && (
            <SecondaryButton className="gys-wallet-tour__context-action" onClick={onPersonalize}>
              Choose My Name
            </SecondaryButton>
          )}
        </div>
        <div ref={footerRef} className="gys-wallet-tour__footer">
          <PrimaryButton className="gys-wallet-tour__next" onClick={onNext} autoFocus data-autofocus>
            {step === 'identity' ? 'Finish Tour' : 'Next'}
          </PrimaryButton>
          <button type="button" className="gys-wallet-tour__skip" onClick={onSkip}>Skip for now</button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
