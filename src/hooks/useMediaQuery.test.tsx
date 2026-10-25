import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

it('updates when the device preference changes and removes the listener on unmount', () => {
  let matches = false;
  let notify = () => {};
  const removeEventListener = vi.fn();
  vi.mocked(window.matchMedia).mockImplementation(() => ({
    get matches() { return matches; },
    addEventListener: (_type: string, callback: () => void) => { notify = callback; },
    removeEventListener,
  }) as unknown as MediaQueryList);
  const view = renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)'));
  expect(view.result.current).toBe(false);
  act(() => { matches = true; notify(); });
  expect(view.result.current).toBe(true);
  view.unmount();
  expect(removeEventListener).toHaveBeenCalledWith('change', notify);
});
