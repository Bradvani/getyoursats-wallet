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
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

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

  it('follows a late standalone Safari pan without another viewport event and stops after settling', () => {
    let now = 0;
    let nextId = 0;
    const pending = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pending.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
    const tick = (at: number) => {
      now = at;
      const callbacks = [...pending.values()];
      pending.clear();
      act(() => callbacks.forEach(callback => callback(now)));
    };
    const {result, rerender} = renderHook(({enabled}) => useWebSheetViewport(enabled),
      {initialProps: {enabled: true}});

    // Native focus first shortens the viewport, then pans it on a later frame.
    viewport.height = 430;
    act(() => viewport.dispatchEvent(new Event('resize')));
    tick(16);
    expect(result.current).toMatchObject({height: 430, top: 0, keyboardOpen: true});
    viewport.offsetTop = 280;
    tick(80);
    expect(result.current.top).toBe(280);
    tick(1001);
    expect(pending.size).toBe(0);

    // A later keyboard cycle restarts sampling. A stale dismissal offset clears.
    viewport.height = 844;
    act(() => document.dispatchEvent(new Event('focusout')));
    tick(1017);
    expect(result.current).toMatchObject({height: 844, top: 0, keyboardOpen: false});
    viewport.height = 430;
    viewport.offsetTop = 0;
    act(() => document.dispatchEvent(new Event('focusin')));
    tick(1033);
    viewport.offsetTop = 190;
    tick(1080);
    expect(result.current.top).toBe(190);
    rerender({enabled: false});
    expect(pending.size).toBe(0);
  });
});
