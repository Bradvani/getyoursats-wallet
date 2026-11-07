import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readWebSheetViewport, useWebSheetViewport} from './useWebSheetViewport';

class Viewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}
let viewport: Viewport;
beforeEach(() => {
  viewport = new Viewport();
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('visualViewport', viewport);
});
afterEach(() => vi.unstubAllGlobals());

describe('web sheet viewport', () => {
  it('fits the visible portrait area above the keyboard and follows its pan', () => {
    viewport.height = 460;
    viewport.offsetTop = 62;
    expect(readWebSheetViewport()).toEqual({height: 460, top: 62, keyboardOpen: true, zoomed: false});
  });

  it('resets a stale iOS offset after keyboard dismissal', () => {
    viewport.offsetTop = 62;
    expect(readWebSheetViewport()).toEqual({height: 844, top: 0, keyboardOpen: false, zoomed: false});
  });

  it('preserves layout and user panning during pinch zoom', () => {
    viewport.scale = 2;
    viewport.height = 422;
    viewport.offsetTop = 100;
    expect(readWebSheetViewport()).toEqual({height: 844, top: 0, keyboardOpen: false, zoomed: true});
  });

  it('distinguishes the keyboard from magnification when both are present', () => {
    viewport.scale = 2;
    viewport.height = 230;
    viewport.offsetTop = 100;
    expect(readWebSheetViewport()).toEqual({height: 460, top: 0, keyboardOpen: true, zoomed: true});
  });

  it('falls back to the resized window without VisualViewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('innerHeight', 420);
    expect(readWebSheetViewport()).toEqual({height: 420, top: 0, keyboardOpen: false, zoomed: false});
  });

  it('tracks keyboard events and cleans up listeners when a sheet closes', () => {
    let callback: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {callback = next; return 1;});
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const remove = vi.spyOn(viewport, 'removeEventListener');
    const {result, rerender, unmount} = renderHook(({enabled}) => useWebSheetViewport(enabled),
      {initialProps: {enabled: true}});
    viewport.height = 430;
    viewport.offsetTop = 40;
    act(() => {viewport.dispatchEvent(new Event('resize')); callback?.(0);});
    expect(result.current.height).toBe(430);
    expect(result.current.top).toBe(40);
    rerender({enabled: false});
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    unmount();
  });
});
