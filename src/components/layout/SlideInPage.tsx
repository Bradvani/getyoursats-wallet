import {PAYMENT_UX} from '@/locales/paymentUx';
import {usePresentation} from '@/hooks/usePresentation';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import React, { ReactNode, useId, useState, useRef, useEffect } from 'react';
import { FocusTrap, FocusTrapFeatures, Transition, TransitionChild } from '@headlessui/react';
import { CloseIcon, BackIcon } from '../Icons';
import { safeAreaTop, safeAreaBottom } from '../../utils/safeAreaInsets';
import { useStatusBarColor } from '../../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE } from '../../utils/statusBarManager';

type SlideDirection = 'left' | 'right' | 'up' | 'down';

interface SlideInPageProps {
  children: ReactNode;
  title: string;
  /** Close button style: 'close' shows X on right, 'back' shows < on left */
  closeStyle?: 'close' | 'back';
  onClose: () => void;
  /** Direction the page slides in from (default: 'left') */
  slideFrom?: SlideDirection;
  /** Optional footer content */
  footer?: ReactNode;
}

const slideTransforms: Record<SlideDirection, { from: string; to: string }> = {
  left: { from: '-translate-x-full', to: 'translate-x-0' },
  right: { from: 'translate-x-full', to: 'translate-x-0' },
  up: { from: 'translate-y-full', to: 'translate-y-0' },
  down: { from: '-translate-y-full', to: 'translate-y-0' },
};

/**
 * SlideInPage - A reusable full-screen page component with:
 * - Slide-in animation from any direction
 * - Safe area handling (top for header, bottom for footer)
 * - Solid background (no grid showing through)
 * - Consistent header with title and close/back button
 * - Optional footer with safe area bottom padding
 */
const SlideInPage: React.FC<SlideInPageProps> = ({
  children,
  title,
  closeStyle = 'close',
  onClose,
  slideFrom = 'left',
  footer,
}) => {
  const {language}=usePresentation();
  const titleId=useId();
  const titleRef=useRef<HTMLHeadingElement|null>(null);
  const direction=language==='ar'&&slideFrom==='left'?'right':language==='ar'&&slideFrom==='right'?'left':slideFrom;
  const desktop = useMediaQuery('(min-width: 1024px)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [isOpen, setIsOpen] = useState(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  // Slide-in pages (Settings, Backup, Buy Providers, etc.) use a
  // solid spark-surface background, so pin the system bars to match
  // while the page is mounted. The push/pop through statusBarManager
  // means when the page closes the wallet page's glass tint is restored.
  useStatusBarColor(STATUS_BAR_SURFACE);

  const handleClose = () => {
    if (closeTimer.current !== null) return;
    setIsOpen(false);
    // Matches the `duration-200` on leave below + ~20ms padding so
    // the unmount (which kills the animation mid-flight if it's still
    // running) lands just after the slide completes.
    // Reduced motion should not wait for an invisible animation.
    const delay = reducedMotion ? 0 : desktop ? 160 : 220;
    closeTimer.current = setTimeout(onClose, delay);
  };

  const { from, to } = desktop
    ? { from: 'opacity-0 translate-y-2', to: 'opacity-100 translate-y-0' }
    : slideTransforms[direction];

  return (
    // `absolute inset-0` (not the old `relative h-dvh`) so the page
    // overlays the sibling WalletPage rendered beneath it in App.tsx's
    // overlay cases (Settings / Backup / etc.). Without the sibling,
    // the leave animation slid into empty space and the WalletPage
    // popped in only after the animation completed — felt jumpy.
    //
    // `z-60` sits above both the WalletPage bottom-bar (z-30) and
    // the SideMenu drawer (z-50, rendered via createPortal). When a
    // menu item is tapped the drawer's leave animation fires at the
    // same commit as the page's enter animation — raising this layer
    // above the drawer means the incoming page covers the drawer as
    // it slides in, collapsing two competing left-edge motions into
    // one dominant motion.
    <FocusTrap initialFocus={titleRef} features={desktop ? FocusTrapFeatures.InitialFocus | FocusTrapFeatures.RestoreFocus : undefined} className="gys-slide-layer absolute inset-0 z-60 flex flex-col"
      role={desktop?"region":"dialog"} aria-modal={desktop?undefined:true} aria-labelledby={titleId}
      onKeyDown={(event:React.KeyboardEvent<HTMLDivElement>)=>{
        if(event.key==='Escape'&&!event.defaultPrevented&&event.currentTarget.contains(event.target as Node)){
          event.preventDefault();event.stopPropagation();handleClose();
        }
      }}>
      <Transition show={isOpen} appear as="div" className="absolute inset-0 overflow-hidden">
        <TransitionChild
          as="div"
          // Material 3 emphasized easing. Enter uses the decelerate
          // curve so the page arrives with a soft settle; exit uses
          // the accelerate curve so the page departs quickly (matches
          // the M3 "standard full-screen" push-navigation pattern).
          // 250ms enter / 200ms leave hits the M3 medium1/short4 token
          // pair — shorter than the canonical 300/200 full-screen spec
          // so the page doesn't drag, but long enough to read as a
          // deliberate slide rather than a pop. Sits one token above
          // the drawer (150/100) so the motion hierarchy scales with
          // the surface size.
          enter={`transition-[transform,opacity] motion-reduce:transition-none ease-m3-emphasized-decelerate ${desktop ? 'duration-150' : 'duration-250'}`}
          enterFrom={from}
          enterTo={to}
          leave={`transition-[transform,opacity] motion-reduce:transition-none ease-m3-emphasized-accelerate ${desktop ? 'duration-150' : 'duration-200'}`}
          leaveFrom={to}
          leaveTo={from}
          className="gys-page-surface absolute inset-0 flex flex-col bg-spark-surface"
        >
          {/* Header with safe area top padding */}
          <header
            className="shrink-0 border-b border-spark-border"
            style={{ paddingTop: safeAreaTop }}
          >
            {/* The toolbar grows when the title wraps or text is enlarged. */}
            <div className={`gys-page-toolbar ${closeStyle==='back'?'gys-page-toolbar--back':''}`}>
              {closeStyle==='back'&&<button type="button" onClick={handleClose} className="gys-page-toolbar__action"
                aria-label={language==='en'?'Go back':PAYMENT_UX[language].back}>
                <BackIcon size="md" className="rtl:rotate-180"/>
              </button>}
              <h1 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h1>
              {closeStyle==='close'&&<button type="button" onClick={handleClose} className="gys-page-toolbar__action"
                aria-label={PAYMENT_UX[language].close}><CloseIcon size="md"/></button>}
            </div>
          </header>

          {/* Scrollable content. Pads for the bottom inset itself when
              there is no footer: on Android 15+ the WebView is laid out
              edge-to-edge under the navigation bar, so the last item in
              a scrolled list otherwise ends up behind it (#129). With a
              footer the footer owns that inset and padding here would
              only add dead scroll space above it. */}
          <div
            className="flex-1 overflow-y-auto min-h-0"
            style={{
              WebkitOverflowScrolling: 'touch',
              paddingBottom: footer ? undefined : safeAreaBottom,
            }}
          >
            {children}
          </div>

          {/* Optional footer with safe area bottom padding */}
          {footer && (
            <footer
              className="shrink-0 border-t border-spark-border bg-spark-surface"
              style={{ paddingBottom: safeAreaBottom }}
            >
              <div className="p-4">
                <div className="max-w-xl mx-auto">
                  {footer}
                </div>
              </div>
            </footer>
          )}
        </TransitionChild>
      </Transition>
    </FocusTrap>
  );
};

export default SlideInPage;
