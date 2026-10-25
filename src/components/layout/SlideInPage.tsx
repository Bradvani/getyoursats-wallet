import { useMediaQuery } from '../../hooks/useMediaQuery';
import GetYourSatsWordmark from '../GetYourSatsWordmark';
import React, { ReactNode, useState, useRef, useEffect } from 'react';
import { Transition, TransitionChild } from '@headlessui/react';
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
    : slideTransforms[slideFrom];

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
    <div className="gys-slide-layer absolute inset-0 z-60 flex flex-col">
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
            {/* Fixed h-14 (56dp) Material toolbar height, matching the
                wallet page CollapsingWalletHeader top row so the back /
                close buttons land at the same screen y coordinate when
                navigating between screens. */}
            <div className="relative px-4 h-14 flex items-center justify-center">
              <div className={`gys-page-header__brand ${closeStyle==='back'?'gys-page-header__brand--back':''}`}><GetYourSatsWordmark compact /></div>
              <h1 className="text-center font-display text-lg font-semibold text-spark-text-primary">
                {title}
              </h1>

              {closeStyle === 'back' ? (
                <button
                  onClick={handleClose}
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                  aria-label="Go back"
                >
                  <BackIcon size="md" />
                </button>
              ) : (
                <button
                  onClick={handleClose}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                  aria-label="Close"
                >
                  <CloseIcon size="md" />
                </button>
              )}
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
    </div>
  );
};

export default SlideInPage;
