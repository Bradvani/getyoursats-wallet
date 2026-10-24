import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import ProcessingStep from '../features/send/steps/ProcessingStep';
import ResultStep from '../features/send/steps/ResultStep';
import BrandIntro from './BrandIntro';

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('payment motion never manufactures confirmation', () => {
  it('remains pending even after a long network wait', () => {
    vi.useFakeTimers();
    const { container } = render(<ProcessingStep />);
    act(() => vi.advanceTimersByTime(120000));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-motion-state="sending"]')).not.toBeNull();
    expect(screen.queryByText('Payment Sent!')).toBeNull();
  });
  it('follows conversion, receive and failure states without success artwork', () => {
    const { container, rerender } = render(<ProcessingStep processingPhase="converting" />);
    expect(container.querySelector('[data-motion-state="converting"]')).not.toBeNull();
    rerender(<ProcessingStep operationType="withdraw" />);
    expect(container.querySelector('[data-motion-state="receiving"]')).not.toBeNull();
    rerender(<ResultStep result="failure" error="Network unavailable" onClose={() => {}} />);
    expect(container.querySelector('[data-motion-state="failed"]')).not.toBeNull();
    expect(container.querySelector('.gys-transfer__check')).toBeNull();
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();
  });
  it('only renders sent confirmation when the parent supplies success', () => {
    const { container } = render(<ResultStep result="success" error={null} onClose={() => {}} />);
    expect(container.querySelector('[data-motion-state="sent"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
describe('brand intro', () => {
  it('ends without invoking any wallet action or blocking its sibling controls', () => {
    vi.useFakeTimers();
    const { container } = render(<><BrandIntro /><button>Open wallet</button></>);
    expect(screen.getByRole('button', { name: 'Open wallet' })).toBeEnabled();
    act(() => vi.advanceTimersByTime(2200));
    expect(container.querySelector('.gys-brand-reveal')).toBeNull();
  });
  it('keeps the static identity visible throughout a long actual loading state', () => {
    vi.useFakeTimers();
    const { container } = render(<BrandIntro inline />);
    act(() => vi.advanceTimersByTime(30000));
    expect(container.querySelector('.gys-brand-reveal--inline')).not.toBeNull();
  });
});
