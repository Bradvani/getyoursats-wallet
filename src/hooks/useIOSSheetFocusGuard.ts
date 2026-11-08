import {useLayoutEffect} from 'react';

const KEYBOARD_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
const TAP_DISTANCE = 8;
const TAP_DURATION = 400;

function editableTarget(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) ||
      target.disabled || target.readOnly || target.inputMode === 'none' ||
      target.closest('[inert]') ||
      (target instanceof HTMLInputElement && !KEYBOARD_INPUT_TYPES.has(target.type))) return null;
  return target;
}

function hasSelection(target: HTMLElement): boolean {
  const selection = target.ownerDocument.getSelection();
  return !!selection && !selection.isCollapsed && selection.containsNode(target, true);
}

/** Native iOS focus can pan fixed sheets even when their outer scrollport is locked. */
export function useIOSSheetFocusGuard(root: HTMLElement | null, enabled: boolean): void {
  useLayoutEffect(() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (!enabled || !root || !ios) return;

    type Tap = {target: HTMLInputElement | HTMLTextAreaElement; id: number; x: number; y: number; time: number};
    let tap: Tap | null = null;
    let frame = 0;
    let restoreStyle: (() => void) | null = null;
    const cancelTap = () => {tap = null;};
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      restoreStyle?.();
      restoreStyle = null;
    };
    const touchStart = (event: TouchEvent) => {
      tap = null;
      const target = editableTarget(event.target);
      const touch = event.touches[0];
      if (event.defaultPrevented || event.touches.length !== 1 || !target ||
          target === document.activeElement || hasSelection(target) ||
          Math.abs((window.visualViewport?.scale ?? 1) - 1) > 0.01) return;
      tap = {target, id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp};
    };
    const moved = (touch: Touch, start: Tap) =>
      Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_DISTANCE;
    const touchMove = (event: TouchEvent) => {
      if (!tap) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch.identifier !== tap.id || moved(touch, tap)) tap = null;
    };
    const touchEnd = (event: TouchEvent) => {
      const start = tap;
      tap = null;
      if (!start || event.defaultPrevented || !event.cancelable || event.touches.length !== 0) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === start.id);
      const target = editableTarget(start.target);
      if (!touch || moved(touch, start) || event.timeStamp - start.time > TAP_DURATION ||
          !target || !root.contains(target) || target === document.activeElement || hasSelection(target) ||
          Math.abs((window.visualViewport?.scale ?? 1) - 1) > 0.01) return;

      // touchend retains its starting target after a scroll. Only a stationary
      // tap may focus; drag, long press and focused-field selection stay native.
      const hit = target.ownerDocument.elementFromPoint(touch.clientX, touch.clientY);
      if (hit !== target) return;
      event.preventDefault();
      restore();
      const properties = ['opacity', 'transition-property'] as const;
      const previous = properties.map(name => ({name, value: target.style.getPropertyValue(name),
        priority: target.style.getPropertyPriority(name)}));
      restoreStyle = () => {
        for (const {name, value, priority} of previous) {
          if (value) target.style.setProperty(name, value, priority);
          else target.style.removeProperty(name);
        }
      };
      // Safari skips native focus reveal for an invisible input. Keep the
      // trusted gesture synchronous, then restore before the next paint.
      // https://gist.github.com/kiding/72721a0553fa93198ae2bb6eefaa3299
      target.style.setProperty('transition-property', 'none', 'important');
      target.style.setProperty('opacity', '0', 'important');
      frame = requestAnimationFrame(restore);
      try {
        target.focus({preventScroll: true});
      } catch (error) {
        restore();
        throw error;
      }
    };

    root.addEventListener('touchstart', touchStart, {capture: true, passive: true});
    root.addEventListener('touchmove', touchMove, {capture: true, passive: true});
    root.addEventListener('touchend', touchEnd, {capture: true, passive: false});
    root.addEventListener('touchcancel', cancelTap, true);
    root.addEventListener('scroll', cancelTap, true);
    root.addEventListener('contextmenu', cancelTap, true);
    return () => {
      restore();
      root.removeEventListener('touchstart', touchStart, true);
      root.removeEventListener('touchmove', touchMove, true);
      root.removeEventListener('touchend', touchEnd, true);
      root.removeEventListener('touchcancel', cancelTap, true);
      root.removeEventListener('scroll', cancelTap, true);
      root.removeEventListener('contextmenu', cancelTap, true);
    };
  }, [root, enabled]);
}
