import React, {
  ReactNode,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Sheet, type SheetRef } from 'react-modal-sheet';
import { useWebSheetViewport, type WebSheetViewport } from '../../../hooks/useWebSheetViewport';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { animate } from 'motion/react';
import { usePreventScroll } from '@react-aria/overlays';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { useStatusBarColor } from '../../../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE } from '../../../utils/statusBarManager';
import { useBackButton } from '../../../hooks/useBackButton';
import { useLatest } from '../../../hooks/useLatest';
import {
  BottomSheetCardContext,
  SetSheetBackContext,
  SetSheetOwnsScrollContext,
  SheetBackContext,
  SheetFullSnapContext,
} from './BottomSheetCardContext';

/**
 * Bottom sheet adapter over react-modal-sheet.
 *
 * Delegates gestures and snap physics to the library. Web sheets fit the
 * visual viewport and reveal focused inputs inside their scrollport; native
 * sheets keep the platform keyboard resize path. Neither path lifts the root
 * and pads for the same keyboard at once.
 */

export type BottomSheetMaxWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const maxWidthMap: Record<BottomSheetMaxWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full',
};

/**
 * Below this measured content height the content snap is not trusted
 * (mid-mount measurements, test environments) and the sheet falls back
 * to [closed, full].
 */
const MIN_CONTENT_SNAP_PX = 50;
/**
 * Content taller than this fraction of the viewport collapses the snap
 * ladder to [closed, full]: an intermediate snap a few px under full
 * is indistinguishable from it.
 */
const CONTENT_SNAP_COLLAPSE_RATIO = 0.9;
/**
 * Margin (px) the focused field is kept clear of the scroller's bottom
 * edge on native. There is no keyboard inset to clear on native (the
 * WebView resizes above the keyboard), only the scroller's own edge.
 */
const NATIVE_REVEAL_MARGIN_PX = 24;

/**
 * BottomSheetCard reports its natural height (handle + content) up to
 * the container, which turns it into the px snap point the sheet opens
 * at. The report fires synchronously from a ref callback so the snap
 * exists before the library computes its open animation target.
 */
const ContentMeasureContext = createContext<(px: number | null) => void>(
  () => {},
);

// Web sheets fit the visible viewport. Native sheets retain the platform
// keyboard resize path below. There is no second keyboard-height padding.
const WebSheetViewportContext = createContext<WebSheetViewport | null>(null);

const IS_NATIVE = Capacitor.isNativePlatform();

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';

export interface BottomSheetContainerProps {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
  onClose?: () => void;
  maxWidth?: BottomSheetMaxWidth;
  /** Maximum height as viewport percentage (default: 100) */
  maxHeightVh?: number;
  /** Whether sheet takes full height (for QR scanner, etc.) */
  fullHeight?: boolean;
  /** Whether to show a backdrop overlay */
  showBackdrop?: boolean;
  /**
   * Stacking order of the sheet root. Raise it past any opaque overlay
   * the sheet opens from: SlideInPage is z-60, so a sheet left at the
   * default opens behind it and reads as a dead button.
   */
  zIndex?: number;
}

export const BottomSheetContainer: React.FC<BottomSheetContainerProps> = ({
  isOpen,
  children,
  className = '',
  onClose,
  maxWidth = 'full',
  maxHeightVh = 100,
  fullHeight = false,
  showBackdrop = false,
  zIndex = 50,
}) => {
  const desktopPointer = useMediaQuery('(min-width: 1024px) and (pointer: fine)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const sheetRef = useRef<SheetRef>(null);
  const [contentPx, setContentPx] = useState<number | null>(null);
  const currentSnap = useRef(1);
  const fullyOpen = useRef(false);
  const [snapIndex, setSnapIndex] = useState(1);

  // Freeze the measured content height while the user holds the sheet at
  // the full snap: content that grows to fill the expanded sheet would
  // otherwise push contentPx past the near-full collapse and flip the
  // snap ladder, fighting its own expansion.
  const reportContentPx = useCallback((px: number | null) => {
    if (currentSnap.current === 2 && px !== null) return;
    setContentPx(px);
  }, []);

  const webViewport = useWebSheetViewport(isOpen && !IS_NATIVE);
  const isKeyboardOpen = !IS_NATIVE && webViewport.keyboardOpen;

  // Keyboard-free viewport height, the stable basis for the snap
  // ladder's collapse rule. It must NOT shrink when the native
  // keyboard resizes the WebView: that reshaped [closed, content,
  // full] into [closed, full] mid keyboard, silently turning snap
  // index 1 from content height into fullscreen (the spurious
  // auto-fullscreen on focus). The keyboard only ever changes height,
  // never width, so we recompute solely on width changes (orientation
  // / window resize) and leave it untouched for every keyboard event.
  const [stableViewportH, setStableViewportH] = useState(() => {
    // A sheet can first mount while the keyboard is already up (a child
    // sheet opening over a focused parent). On native the WebView is
    // already shrunk, so window.innerHeight is the keyboard-up height;
    // add the reported keyboard inset back so the basis is keyboard-free.
    // On web the keyboard overlays (innerHeight stays full), so no
    // adjustment is needed.
    if (IS_NATIVE) {
      const kb = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--keyboard-height',
        ),
      );
      if (Number.isFinite(kb) && kb > 0) return window.innerHeight + kb;
    }
    return window.innerHeight;
  });
  useEffect(() => {
    let lastWidth = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth !== lastWidth) {
        // Orientation / window resize: re-baseline to the new width.
        lastWidth = window.innerWidth;
        setStableViewportH(window.innerHeight);
      } else {
        // Height-only change is the keyboard, which only ever shrinks the
        // viewport. The keyboard-free height is the tallest it gets, so
        // track the max: this self-corrects a basis that was seeded
        // shrunken (mounted with the keyboard up) the first time the
        // keyboard closes, without letting the keyboard collapse it.
        setStableViewportH((prev) => Math.max(prev, window.innerHeight));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // True while focus is inside this sheet's container; the viewport
  // re-snap uses it to freeze sheets that do not own the keyboard.
  const focusWithin = useRef(false);

  // Snap ladder: [closed, content height, full] with drag-to-expand
  // between the last two; collapses to [closed, full] for near-full
  // content. Values are px from the sheet bottom.
  const useContentSnap =
    !fullHeight &&
    contentPx !== null &&
    contentPx > MIN_CONTENT_SNAP_PX &&
    contentPx < stableViewportH * CONTENT_SNAP_COLLAPSE_RATIO;
  const snapPoints = fullHeight
    ? undefined
    : useContentSnap
      ? [0, IS_NATIVE ? contentPx : Math.min(contentPx, webViewport.height), 1]
      : [0, 1];

  // Expanded-to-fullscreen state (user dragged a content-sized sheet
  // to the top snap): square corners + status bar tint, matching the
  // old implementation. Near-full single-snap sheets keep the rounded
  // look, as before.
  const isFullSnap = useContentSnap && snapIndex === 2;

  // Race-free native re-position. The keyboard resizes the WebView, so
  // the resting snap offset must shrink with it. react-modal-sheet only
  // moves the sheet via snapTo(), which animates to a snapValueY cached
  // against the asynchronously re-measured root height: that loses the
  // race against the keyboard resize and leaves the sheet gapped above
  // the keyboard. Instead we drive the exposed `y` MotionValue directly
  // from the LIVE viewport height, so the sheet sits flush regardless of
  // when the library re-measures.
  const repositionRef = useRef<(animated: boolean) => void>(() => {});
  const lastReposTargetRef = useRef<number | null>(null);
  // Live keyboard height, set from the Keyboard plugin events (below) on
  // both platforms. The resting position is derived purely from this plus
  // the stable keyboard-free height, never window.innerHeight.
  const keyboardHeightRef = useRef(0);
  // Reassigned after every commit so it reads the latest contentPx /
  // snap without re-subscribing the resize listener.
  useLayoutEffect(() => {
    repositionRef.current = (animated: boolean) => {
      const sheet = sheetRef.current;
      if (!sheet || fullHeight || !fullyOpen.current) return;
      if (!IS_NATIVE) {
        const target = useContentSnap && currentSnap.current === 1
          ? Math.max(0, webViewport.height - (contentPx ?? webViewport.height)) : 0;
        // Follow the system keyboard geometry directly, without a second tween
        // chasing it or an old snap animation overwriting the settled position.
        sheet.y.stop();
        sheet.y.set(target);
        return;
      }
      const idx = currentSnap.current;
      if (idx <= 0) return;
      const active = document.activeElement;
      const editableActive =
        active instanceof HTMLElement && active.matches(EDITABLE_SELECTOR);
      // A background sheet (an editable is focused but not inside this
      // sheet) holds its offset so it stays visually put under the child.
      if (editableActive && !focusWithin.current) {
        return;
      }
      // Effective viewport bottom == top of the keyboard, derived from the
      // stable keyboard-free height minus the reported keyboard height,
      // NOT window.innerHeight (iOS defers its resize ~0.5s; Android's
      // back-button dismissal fires none). The keyboard only counts as up
      // for THIS sheet while one of its own fields is focused: once
      // navigation unmounts the focused field (or it blurs), treat it as
      // gone immediately and drop to the full-height snap rather than
      // waiting on the possibly-delayed keyboardDidHide. That removes the
      // mispositioned / half-expanded transient when returning to a sheet
      // with the keyboard still up.
      const kb = editableActive ? keyboardHeightRef.current : 0;
      const bottom = Math.max(0, stableViewportH - kb);
      // Index 2 (full) or the collapsed [0, 1] ladder rest at y 0 (top
      // of the keyboard). The content snap rests contentPx px above it.
      const restY =
        !useContentSnap || idx >= 2
          ? 0
          : Math.max(0, bottom - (contentPx ?? bottom));
      // A stale --keyboard-height (hide events missed while
      // backgrounded) inflates stableViewportH and computes a rest
      // below the live viewport; clamp so the sheet can never park
      // fully off-screen.
      const targetY = Math.min(restY, Math.max(0, window.innerHeight - 96));
      if (lastReposTargetRef.current === targetY) return;
      lastReposTargetRef.current = targetY;
      if (animated && !reducedMotion) {
        animate(sheet.y, targetY, {
          type: 'tween',
          ease: 'easeOut',
          duration: 0.2,
        });
      } else {
        // Instant set for corrections that must not read as motion
        // (settling the position right as the open animation ends).
        sheet.y.set(targetY);
      }
    };
  });

  const dismiss = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    onClose?.();
  }, [onClose]);

  // Wire the Android hardware back button to close the sheet while
  // it's open, via the shared LIFO stack so nested sheets dismiss
  // topmost-first. No-op on non-native platforms. The handler is stable:
  // re-pushed on every render, it would jump above a handler registered
  // after it, such as a page's step-back inside the sheet.
  const latestDismiss = useLatest(dismiss);
  const onBackButton = useCallback(() => {
    latestDismiss.current();
  }, [latestDismiss]);
  useBackButton(onBackButton, isOpen);

  // System bar tinting on native: nav bar matches the sheet surface
  // for the whole time it's open (the card always meets the nav bar);
  // status bar only when the sheet covers the top of the screen.
  useStatusBarColor(STATUS_BAR_SURFACE, isOpen, 'nav');
  useStatusBarColor(
    STATUS_BAR_SURFACE,
    isOpen && (fullHeight || isFullSnap),
    'status',
  );

  // Scroll lock + iOS focus-pan suppression from the maintained
  // react-aria package instead of the library's vendored snapshot:
  // the snapshot predates Adobe's iOS 26 fixes, and Safari's focus
  // pan slipping through is what briefly shoves the page behind the
  // sheet off-screen when the keyboard opens (the pan is invisible
  // to JS until it finishes, so it can only be prevented, not
  // corrected). The matching disableScrollLocking on <Sheet> below
  // keeps the two locks from stacking.
  usePreventScroll({ isDisabled: !isOpen });

  // NATIVE ONLY. The keyboard resizes the WebView (Android
  // adjustResize / IME padding, iOS resize: 'native'), shrinking the
  // sheet root. Drive the sheet's y to match the new viewport bottom
  // via the race-free reposition above on every resize (keyboard
  // show/hide, rotation). Animated: when the resize changes the target
  // at all (blur-driven hide before the willHide event lands,
  // rotation), a tween reads as one motion; when a keyboard event
  // already landed the same target, the dedupe makes this a no-op
  // without disturbing a running tween.
  //
  // Web uses the visual viewport geometry below; native listens here because
  // its WebView resizes separately from the browser keyboard model.
  useEffect(() => {
    if (!IS_NATIVE || !isOpen || fullHeight) return;
    const onResize = () => repositionRef.current(true);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [isOpen, fullHeight]);

  // NATIVE. Drive the re-position off the Keyboard plugin events, which
  // fire reliably with the keyboard height on both platforms. willShow
  // and willHide fire at the START of the system keyboard animation, so
  // the sheet's tween runs alongside the keyboard's own slide instead
  // of after it. Plugin events are the only reliable signal: iOS
  // resize:'native' defers its setFrame ~0.5s, and Android's
  // back-button dismissal keeps the field focused (no blur, and on
  // API <=34 no resize), so a resize-only approach leaves the sheet
  // hanging at its lifted position until some later event. didHide
  // stays as a safety net (deduped when willHide already landed the
  // sheet). A field switch fires willShow with the same height (deduped
  // by lastReposTargetRef), so the sheet does not flap between fields.
  useEffect(() => {
    if (!IS_NATIVE || !isOpen || fullHeight) {
      return;
    }
    let cancelled = false;
    const handles: PluginListenerHandle[] = [];
    const track = (h: PluginListenerHandle) => {
      if (cancelled) h.remove();
      else handles.push(h);
    };
    void Keyboard.addListener('keyboardWillShow', (info) => {
      keyboardHeightRef.current = info.keyboardHeight;
      repositionRef.current(true);
    }).then(track);
    void Keyboard.addListener('keyboardWillHide', () => {
      keyboardHeightRef.current = 0;
      repositionRef.current(true);
    }).then(track);
    void Keyboard.addListener('keyboardDidHide', () => {
      keyboardHeightRef.current = 0;
      repositionRef.current(true);
    }).then(track);
    return () => {
      cancelled = true;
      handles.forEach((h) => h.remove());
    };
  }, [isOpen, fullHeight]);

  // Native content-size changes retain their existing animated reposition.
  useEffect(() => {
    if (IS_NATIVE && isOpen && useContentSnap && currentSnap.current === 1) {
      repositionRef.current(true);
    }
  }, [contentPx, isOpen, useContentSnap]);

  useLayoutEffect(() => {
    if (!IS_NATIVE && isOpen) repositionRef.current(false);
  }, [isOpen, webViewport.height, contentPx, useContentSnap]);

  return (
    <Sheet
      ref={sheetRef}
      isOpen={isOpen}
      onClose={dismiss}
      onOpenEnd={() => {
        fullyOpen.current = true;
        // Settle the position in case the keyboard resized the WebView
        // during the open animation: the resize reposition is gated on
        // fullyOpen and would have been skipped while opening.
        repositionRef.current(false);
      }}
      onCloseStart={() => {
        fullyOpen.current = false;
        lastReposTargetRef.current = null;
        keyboardHeightRef.current = 0;
        // Back to the content snap for the next open: onSnap only
        // fires on changes, so a fullscreen index from this session
        // would otherwise leak into the next one.
        currentSnap.current = 1;
        setSnapIndex(1);
      }}
      onSnap={(index) => {
        currentSnap.current = index;
        setSnapIndex(index);
      }}
      // "full" for every sheet: the top snap must reach the real top
      // of the screen. detent "default" reserves safe-area-top + 34px,
      // which read as a gap when a sheet was dragged to fullscreen.
      detent="full"
      snapPoints={snapPoints}
      initialSnap={1}
      avoidKeyboard={false}
      // While typing, drags would fight the keyboard inset and the
      // focused field; the built-in avoidance had the same lockout.
      disableDrag={isKeyboardOpen || desktopPointer}
      prefersReducedMotion={reducedMotion}
      tweenConfig={{ ease: 'easeOut', duration: desktopPointer ? 0.18 : 0.25 }}
      // The vendored lock is replaced by usePreventScroll above.
      disableScrollLocking
      // Drop the library's decorative styles (white card, grey pills);
      // the surface look comes from our classes below.
      unstyled
      // Keep sheets in the app's existing z order (confirm dialogs render
      // at z-50 in the same stacking context); the library would otherwise
      // default to 9999. Toasts deliberately sit above every sheet, in
      // their own stacking context at 99999.
      //
      // Constrain the library's position:fixed root to the app content
      // column (#content-root is max-w-4xl) and center it, so on wide web
      // viewports the sheet tracks the page width instead of spanning the
      // whole window. The old hand-rolled sheet was absolute inside the
      // column and inherited this for free. The backdrop is a separate
      // fixed child and still covers the full viewport.
      style={{
        zIndex, maxWidth: desktopPointer && !fullHeight ? '42.5rem' : '56rem', marginInline: 'auto',
        ...(!IS_NATIVE ? {top: webViewport.top, bottom: 'auto', height: webViewport.height} : {}),
      }}
      // Web sheets live outside the app root so a page transform cannot change
      // the containing block of their fixed viewport. Native keeps its portal.
      mountPoint={IS_NATIVE ? document.getElementById('root') ?? undefined : undefined}
    >
      <Sheet.Container
        onFocusCapture={() => {
          focusWithin.current = true;
        }}
        onBlurCapture={(e) => {
          const next = e.relatedTarget;
          if (!(next instanceof Node) || !e.currentTarget.contains(next)) {
            focusWithin.current = false;
          }
        }}
        className={`bg-spark-surface ${fullHeight || isFullSnap ? 'rounded-none' : 'bottom-sheet-card-bordered'} shadow-glass-lg w-full ${maxWidthMap[maxWidth]} mx-auto ${className}`}
        style={
          {
            ...(maxHeightVh < 100
              ? { maxHeight: `${maxHeightVh}dvh` }
              : null),
          } as React.CSSProperties
        }
      >
        <ContentMeasureContext.Provider value={reportContentPx}>
          <WebSheetViewportContext.Provider value={IS_NATIVE ? null : webViewport}>
            <SheetFullSnapContext.Provider value={isFullSnap}>
              {children}
            </SheetFullSnapContext.Provider>
          </WebSheetViewportContext.Provider>
        </ContentMeasureContext.Provider>
      </Sheet.Container>
      {showBackdrop && (
        <Sheet.Backdrop className="bg-black/60" onTap={dismiss} />
      )}
    </Sheet>
  );
};

export interface BottomSheetCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Sheet body: drag handle header + scrollable content area. Must be
 * rendered as the direct child of BottomSheetContainer (it expands to
 * react-modal-sheet's Header/Content pair, which the library expects
 * as direct children of its container for keyboard avoidance and
 * scroll handling).
 */
export const BottomSheetCard = forwardRef<HTMLDivElement, BottomSheetCardProps>(
  ({ children, className = '' }, ref) => {
    const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
    const [stepBack, setStepBack] = useState<(() => void) | null>(null);
    // Content areas registered via useSheetOwnsScroll.
    const [ownScrollers, setOwnScrollers] = useState(0);
    const registerOwnScroller = useCallback(
      (delta: number) => setOwnScrollers((n) => n + delta),
      [],
    );
    const reportHeight = useContext(ContentMeasureContext);
    const webViewport = useContext(WebSheetViewportContext);
    const handleRef = useRef<HTMLDivElement | null>(null);
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    // Reveal within the actual scrollport in either direction. Measuring only
    // bottom overlap left fields above the visible area stranded after a pan.
    const revealFocused = useCallback(() => {
      const scroller = scrollerRef.current;
      const active = document.activeElement;
      if (!scroller || webViewport?.zoomed || !(active instanceof HTMLElement) ||
          !scroller.contains(active) || !active.matches(EDITABLE_SELECTOR)) return;
      const bounds = scroller.getBoundingClientRect();
      const field = active.getBoundingClientRect();
      const margin = IS_NATIVE ? NATIVE_REVEAL_MARGIN_PX : 16;
      const top = Math.max(bounds.top, webViewport?.top ?? 0) + margin;
      const bottom = Math.min(bounds.bottom, webViewport
        ? webViewport.top + webViewport.height : window.innerHeight) - margin;
      if (bottom <= top) return;
      const delta = field.top < top || field.height > bottom - top
        ? field.top - top : Math.max(0, field.bottom - bottom);
      if (Math.abs(delta) > 1) scroller.scrollBy({top: delta, behavior: 'instant'});
    }, [webViewport]);

    const revealFrame = useRef(0);
    const scheduleReveal = useCallback(() => {
      cancelAnimationFrame(revealFrame.current);
      revealFrame.current = requestAnimationFrame(revealFocused);
    }, [revealFocused]);
    useLayoutEffect(() => {
      scheduleReveal();
      const scroller = scrollerRef.current;
      const observer = new ResizeObserver(scheduleReveal);
      if (scroller) observer.observe(scroller);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(revealFrame.current);
      };
    }, [scheduleReveal]);

    const measure = useCallback(
      (el: HTMLDivElement | null) => {
        if (!el) return;
        reportHeight(el.offsetHeight + (handleRef.current?.offsetHeight ?? 0));
      },
      [reportHeight],
    );

    // Track content growth/shrink after mount (error banners, lists
    // loading in) so the container can re-snap to the new height.
    // border-box: the keyboard-visible :focus-within rule collapses
    // this element's own bottom padding (the safe-area inset), which
    // leaves the default content-box observation blind. Unobserved,
    // the stale height held the sheet a padding's worth too high until
    // the next re-render re-measured it, so the sheet visibly stepped
    // down on the first keystroke instead of settling in one motion.
    useEffect(() => {
      if (!cardEl) return;
      const observer = new ResizeObserver(() => measure(cardEl));
      observer.observe(cardEl, { box: 'border-box' });
      return () => {
        observer.disconnect();
        reportHeight(null);
      };
    }, [cardEl, measure, reportHeight]);

    return (
      <>
        <Sheet.Header>
          <div
            ref={handleRef}
            className="bottom-sheet-handle-zone shrink-0"
            style={{ touchAction: 'none' }}
          >
            <div className="bottom-sheet-handle" />
          </div>
        </Sheet.Header>
        <Sheet.Content
          scrollClassName={`scrollbar-hidden ${IS_NATIVE ? '' : 'web-sheet-scrollport'}`}
          scrollRef={scrollerRef}
          // A step with its own scroller (useSheetOwnsScroll) takes the
          // drag off the content. The library suppresses the drag only for
          // ITS scroller, which a step that caps an inner list leaves
          // unscrollable, so without this the sheet reads every swipe over
          // the list as a drag and the list moves only when the browser
          // wins the race.
          disableDrag={!IS_NATIVE || ownScrollers > 0}
          // Web content always scrolls; dragging is confined to the handle.
          // The sheet already fits above the keyboard, so reserve only a small
          // caret margin rather than adding the keyboard height a second time.
          scrollStyle={{
            paddingBottom: IS_NATIVE ? 0 : 16,
            // touch-action intersects down the ancestor chain, so the
            // pan-down the library pairs with its drag clamps an inner
            // list's pan-y to "downward only", leaving nothing to scroll
            // with. Dropping the drag alone does not lift it: the library
            // also writes pan-down imperatively, and stops maintaining it
            // once its own scroller no longer overflows. Chromium enforces
            // the directional value, WebKit ignores it, which is why this
            // reads as flaky on iOS and immovable on Android.
            ...(ownScrollers > 0 ? { touchAction: 'pan-y' } : null),
          }}
        >
          <div
            onFocusCapture={scheduleReveal}
            ref={(el) => {
              setCardEl(el);
              // Synchronous first measurement: the ref attaches during
              // commit, before the library's open effect computes its
              // animation target, so the sheet opens straight to the
              // content snap with no full-height flash.
              measure(el);
              if (typeof ref === 'function') ref(el);
              else if (ref) ref.current = el;
            }}
            className={`bottom-sheet-content-pad px-6 pt-3 ${className}`}
          >
            <BottomSheetCardContext.Provider value={cardEl}>
              <SetSheetOwnsScrollContext.Provider value={registerOwnScroller}>
                <SetSheetBackContext.Provider value={setStepBack}>
                  <SheetBackContext.Provider value={stepBack}>
                    {children}
                  </SheetBackContext.Provider>
                </SetSheetBackContext.Provider>
              </SetSheetOwnsScrollContext.Provider>
            </BottomSheetCardContext.Provider>
          </div>
        </Sheet.Content>
      </>
    );
  },
);

BottomSheetCard.displayName = 'BottomSheetCard';
