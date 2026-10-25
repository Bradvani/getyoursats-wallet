import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SlideInPage from './SlideInPage';

vi.mock('../../hooks/useStatusBarColor', () => ({ useStatusBarColor: () => {} }));
vi.mock('../GetYourSatsWordmark', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('slide page navigation lifecycle', () => {
  it('cancels an outgoing close when another destination unmounts the page', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const view = render(<SlideInPage title="Currency" onClose={onClose}>Currencies</SlideInPage>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    view.unmount();
    act(() => { vi.advanceTimersByTime(250); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only once after repeated clicks', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<SlideInPage title="Settings" onClose={onClose}>Preferences</SlideInPage>);
    const button = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(button);
    fireEvent.click(button);
    act(() => { vi.advanceTimersByTime(250); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not wait 220ms when reduced motion is requested', () => {
    vi.useFakeTimers();
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    const onClose = vi.fn();
    render(<SlideInPage title="Settings" onClose={onClose}>Preferences</SlideInPage>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => { vi.advanceTimersByTime(0); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
