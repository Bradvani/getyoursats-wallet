import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useIOSSheetFocusGuard} from './useIOSSheetFocusGuard';

let root: HTMLDivElement;
let field: HTMLInputElement;
let frames: Map<number, FrameRequestCallback>;
let hit: Element | null;
let clock: number;

function touch(target: Element, type: string, options: {
  x?: number; y?: number; count?: number; id?: number; cancelable?: boolean;
} = {}) {
  const point = {identifier: options.id ?? 1, clientX: options.x ?? 20, clientY: options.y ?? 100};
  const touches = type === 'touchend' || type === 'touchcancel' ? []
    : Array.from({length: options.count ?? 1}, (_, i) => ({...point, identifier: point.identifier + i}));
  const event = new Event(type, {bubbles: true, cancelable: options.cancelable ?? true});
  Object.defineProperties(event, {
    touches: {value: touches}, changedTouches: {value: [point]}, timeStamp: {value: clock},
  });
  act(() => {target.dispatchEvent(event);});
  return event;
}

function tap(target: Element = field) {
  touch(target, 'touchstart');
  clock += 50;
  return touch(target, 'touchend');
}

function nextFrame() {
  const callbacks = Array.from(frames.values());
  frames.clear();
  act(() => {callbacks.forEach(callback => callback(clock));});
}

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15');
  vi.stubGlobal('visualViewport', {scale: 1});
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {frames.delete(id);});
  root = document.createElement('div');
  field = document.createElement('input');
  field.value = '125';
  root.append(field);
  document.body.append(root);
  hit = field;
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => hit);
  clock = 0;
});

afterEach(() => {
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('iOS sheet input focus', () => {
  it('focuses within the tap gesture without browser reveal and restores exact inline styles', () => {
    field.style.setProperty('opacity', '0.75', 'important');
    field.style.setProperty('transition-property', 'color', 'important');
    const originalFocus = field.focus.bind(field);
    const focus = vi.spyOn(field, 'focus').mockImplementation(options => {
      expect(field.style.opacity).toBe('0');
      expect(field.style.getPropertyPriority('opacity')).toBe('important');
      expect(field.style.transitionProperty).toBe('none');
      originalFocus(options);
    });
    renderHook(() => useIOSSheetFocusGuard(root, true));
    expect(tap().defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
    expect(field).toHaveFocus();
    expect(field.value).toBe('125');
    nextFrame();
    expect(field.style.opacity).toBe('0.75');
    expect(field.style.transitionProperty).toBe('color');
    expect(field.style.getPropertyPriority('opacity')).toBe('important');
    expect(field.style.getPropertyPriority('transition-property')).toBe('important');
  });

  it('restores absent styles and cancels pending work when its sheet unmounts', () => {
    const {unmount} = renderHook(() => useIOSSheetFocusGuard(root, true));
    tap();
    expect(field.style.opacity).toBe('0');
    unmount();
    expect(field.style.opacity).toBe('');
    expect(field.style.transitionProperty).toBe('');
    expect(frames.size).toBe(0);
    field.blur();
    expect(tap().defaultPrevented).toBe(false);
    expect(field).not.toHaveFocus();
  });

  it('leaves focused-field selection native and never reopens focus after Done', () => {
    renderHook(() => useIOSSheetFocusGuard(root, true));
    tap();
    nextFrame();
    field.setSelectionRange(0, 2);
    const focus = vi.spyOn(field, 'focus');
    expect(tap().defaultPrevented).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 2]);
    act(() => field.blur());
    expect(touch(field, 'touchend').defaultPrevented).toBe(false);
    nextFrame();
    expect(field).not.toHaveFocus();
    expect(focus).not.toHaveBeenCalled();
    expect(tap().defaultPrevented).toBe(true);
    expect(field).toHaveFocus();
  });

  it.each(['drag', 'returning drag', 'scroll', 'long press', 'pinch', 'cancel', 'context menu', 'different hit', 'end movement'])(
    'leaves %s untouched instead of focusing the original touch target', scenario => {
    renderHook(() => useIOSSheetFocusGuard(root, true));
    const focus = vi.spyOn(field, 'focus');
    touch(field, 'touchstart');
    if (scenario === 'drag' || scenario === 'returning drag') touch(field, 'touchmove', {y: 160});
    if (scenario === 'returning drag') touch(field, 'touchmove', {y: 100});
    if (scenario === 'scroll') root.dispatchEvent(new Event('scroll'));
    if (scenario === 'long press') clock = 500;
    if (scenario === 'pinch') touch(field, 'touchmove', {count: 2});
    if (scenario === 'cancel') touch(field, 'touchcancel');
    if (scenario === 'context menu') field.dispatchEvent(new Event('contextmenu', {bubbles: true}));
    if (scenario === 'different hit') hit = root;
    const end = touch(field, 'touchend', {y: scenario === 'end movement' ? 160 : 100});
    expect(end.defaultPrevented).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(field).not.toHaveFocus();
    expect(field.style.opacity).toBe('');
  });

  it.each(['disabled', 'readOnly', 'checkbox', 'range', 'date', 'none', 'inert'])(
    'does not intercept the %s control', kind => {
    if (kind === 'disabled' || kind === 'readOnly') field[kind] = true;
    else if (kind === 'none') field.inputMode = 'none';
    else if (kind === 'inert') root.setAttribute('inert', '');
    else field.type = kind;
    renderHook(() => useIOSSheetFocusGuard(root, true));
    expect(tap().defaultPrevented).toBe(false);
    expect(field.style.opacity).toBe('');
  });

  it('supports recipient textareas and amount inputs after the previous field is removed', () => {
    const recipient = document.createElement('textarea');
    root.prepend(recipient);
    renderHook(() => useIOSSheetFocusGuard(root, true));
    hit = recipient;
    expect(tap(recipient).defaultPrevented).toBe(true);
    expect(recipient).toHaveFocus();
    recipient.remove();
    nextFrame();
    field.type = 'number';
    hit = field;
    expect(tap().defaultPrevented).toBe(true);
    expect(field).toHaveFocus();
  });

  it.each(['android', 'native', 'zoom', 'multi-touch'])('does not take over %s focus', mode => {
    if (mode === 'android') vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36');
    if (mode === 'zoom') vi.stubGlobal('visualViewport', {scale: 2});
    renderHook(() => useIOSSheetFocusGuard(root, mode !== 'native'));
    touch(field, 'touchstart', {count: mode === 'multi-touch' ? 2 : 1});
    expect(touch(field, 'touchend').defaultPrevented).toBe(false);
    expect(field.style.opacity).toBe('');
    expect(field).not.toHaveFocus();
  });

  it('leaves a tap native when zoom changes before touchend', () => {
    renderHook(() => useIOSSheetFocusGuard(root, true));
    touch(field, 'touchstart');
    vi.stubGlobal('visualViewport', {scale: 1.5});
    expect(touch(field, 'touchend').defaultPrevented).toBe(false);
    expect(field).not.toHaveFocus();
  });
});
