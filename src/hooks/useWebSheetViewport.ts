import { useLayoutEffect, useState } from 'react';

export interface WebSheetViewport {
  height: number;
  top: number;
  keyboardOpen: boolean;
  zoomed: boolean;
}

/** One coordinate system for web sheets. Native WebViews resize themselves. */
export function readWebSheetViewport(): WebSheetViewport {
  const viewport = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const scale = viewport?.scale || 1;
  const zoomed = Math.abs(scale - 1) > 0.01;
  // Pinch zoom reduces visualViewport.height without opening a keyboard.
  // Keep layout-sized geometry during zoom and leave panning to the browser.
  const height = Math.min(layoutHeight, (viewport?.height || layoutHeight) * scale);
  const keyboardOpen = layoutHeight - height > 100;
  return {
    height,
    // iOS can retain an offset after dismissal. A full-height viewport must
    // return to the top; never counter-pan the page or constrain user zoom.
    top: keyboardOpen && !zoomed ? Math.max(0, viewport?.offsetTop || 0) : 0,
    keyboardOpen,
    zoomed,
  };
}

export function useWebSheetViewport(enabled: boolean): WebSheetViewport {
  const [viewport, setViewport] = useState(readWebSheetViewport);
  useLayoutEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = readWebSheetViewport();
      setViewport(previous => previous.height === next.height && previous.top === next.top &&
        previous.keyboardOpen === next.keyboardOpen && previous.zoomed === next.zoomed ? previous : next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const visualViewport = window.visualViewport;
    update();
    visualViewport?.addEventListener('resize', schedule);
    visualViewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      cancelAnimationFrame(frame);
      visualViewport?.removeEventListener('resize', schedule);
      visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pageshow', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
    };
  }, [enabled]);
  return viewport;
}
