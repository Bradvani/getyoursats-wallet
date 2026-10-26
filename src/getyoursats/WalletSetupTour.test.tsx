import {useState} from 'react';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import WalletSetupTour, {type WalletTourStep} from './WalletSetupTour';

vi.mock('../hooks/useBackButton', () => ({useBackButton: () => {}}));

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

const callbacks = () => ({
  onNext: vi.fn(), onSkip: vi.fn(), onReviewRecovery: vi.fn(), onPersonalize: vi.fn(),
});

function setup(props: Partial<Parameters<typeof WalletSetupTour>[0]> = {}) {
  const actions = callbacks();
  const view = render(<WalletSetupTour step="protect" recoveryMethod="passkey" recoveryStatus="pending"
    hasNativeAddress={false} {...actions} {...props}/>);
  return {...view, ...actions};
}

afterEach(async () => {
  await act(async () => {cleanup();});
  if (vi.isFakeTimers()) {
    await act(async () => {await vi.runOnlyPendingTimersAsync();});
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('manual wallet setup tour', () => {
  it('starts with passkey recovery and requires an explicit action to leave it', async () => {
    const actions = setup();
    expect(screen.getByRole('dialog', {name: 'Wallet tour'})).toBeVisible();
    expect(screen.getByRole('heading', {name: 'Start with recovery'})).toBeVisible();
    expect(screen.getByText('An offline backup is optional.')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await waitFor(() => expect(screen.getByRole('button', {name: 'Next'})).toHaveFocus());
    expect(actions.onNext).not.toHaveBeenCalled();
    expect(actions.onSkip).not.toHaveBeenCalled();
    expect(actions.onReviewRecovery).not.toHaveBeenCalled();
  });

  it('keeps next, skip and recovery actions independent', () => {
    const actions = setup();
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    expect(actions.onNext).toHaveBeenCalledOnce();
    expect(actions.onReviewRecovery).not.toHaveBeenCalled();
    expect(actions.onSkip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Review Recovery'}));
    expect(actions.onReviewRecovery).toHaveBeenCalledOnce();
    expect(actions.onNext).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', {name: 'Skip for now'}));
    expect(actions.onSkip).toHaveBeenCalledOnce();
  });

  it('recognises a verified offline backup without asking for another check', () => {
    setup({recoveryMethod: 'phrase', recoveryStatus: 'phrase-verified'});
    expect(screen.getByText('Offline backup confirmed')).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Review Recovery'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next'})).toBeVisible();
  });

  it('does not describe a passkey review as a verified backup', () => {
    setup({recoveryStatus: 'passkey-reviewed'});
    expect(screen.getByText('Passkey recovery reviewed')).toBeVisible();
    expect(screen.queryByText('Offline backup confirmed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Review Recovery'})).toBeVisible();
  });

  it('keeps an optional name separate from wallet recovery', () => {
    const actions = setup({step: 'identity'});
    expect(screen.getByText('Email is optional and does not recover your wallet.')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
    fireEvent.click(screen.getByRole('button', {name: 'Choose My Name'}));
    expect(actions.onPersonalize).toHaveBeenCalledOnce();
    expect(actions.onNext).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Finish Tour'}));
    expect(actions.onNext).toHaveBeenCalledOnce();
  });

  it('uses the already registered name state without asking to register again', () => {
    setup({step: 'identity', hasNativeAddress: true});
    expect(screen.getByRole('heading', {name: 'Your name is ready'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Choose My Name'})).not.toBeInTheDocument();
  });

  it('does not describe stable-balance conversion as a display toggle', () => {
    setup({step: 'balance'});
    expect(screen.getByText('Use the tabs below your balance to view sats, BTC or your display currency. Choose your currency in Settings.')).toBeVisible();
    expect(screen.getByText('Display preferences do not move your funds.')).toBeVisible();
  });

  it('dismisses with Escape and restores the opening control focus', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open setup</button>
        {open && <WalletSetupTour step="protect" recoveryMethod="passkey" recoveryStatus="pending"
          hasNativeAddress={false} onNext={() => {}} onSkip={() => {onSkip(); setOpen(false);}}
          onReviewRecovery={() => {}} onPersonalize={() => {}}/>}
      </>;
    }
    const view = render(<Harness/>);
    const opener = screen.getByRole('button', {name: 'Open setup'});
    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('button', {name: 'Next'})).toHaveFocus());
    expect(view.container).toHaveAttribute('aria-hidden', 'true');
    expect(view.container.inert).toBe(true);
    await user.keyboard('{Escape}');
    expect(onSkip).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(view.container).not.toHaveAttribute('aria-hidden');
    expect(view.container.inert).not.toBe(true);
    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('button', {name: 'Next'})).toHaveFocus());
    expect(view.container).toHaveAttribute('aria-hidden', 'true');
    expect(view.container.inert).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
    expect(view.container).not.toHaveAttribute('aria-hidden');
    expect(view.container.inert).not.toBe(true);
  });

  it('keeps keyboard focus within the tour', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open setup</button>
        <button type="button">Send outside the tour</button>
        {open && <WalletSetupTour step="protect" recoveryMethod="passkey" recoveryStatus="pending"
          hasNativeAddress={false} {...actions}/>}
      </>;
    }
    render(<Harness/>);
    await user.click(screen.getByRole('button', {name: 'Open setup'}));
    const next = screen.getByRole('button', {name: 'Next'});
    await waitFor(() => expect(next).toHaveFocus());
    for (let i = 0; i < 7; i++) {
      await user.tab();
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    }
    expect(screen.queryByRole('button', {name: 'Send outside the tour'})).not.toBeInTheDocument();
  });

  it('centers the complete card when neither side of the anchor fits its content', () => {
    vi.stubGlobal('innerWidth', 320);
    vi.stubGlobal('innerHeight', 568);
    const anchor = document.createElement('div');
    anchor.setAttribute('data-wallet-tour', 'identity');
    anchor.getBoundingClientRect = () => new DOMRect(16, 260, 288, 36);
    document.body.append(anchor);
    try {
      setup({step: 'identity'});
      expect(document.querySelector('.gys-wallet-tour__panel')).toHaveAttribute('data-placement', 'center');
      expect(document.querySelector('.gys-wallet-tour__spotlight')).not.toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'Choose My Name'})).toBeVisible();
      expect(screen.getByRole('button', {name: 'Finish Tour'})).toBeVisible();
    } finally {
      anchor.remove();
    }
  });

  it('keeps the card usable when a spotlight anchor is missing', () => {
    setup({step: 'receive'});
    expect(document.querySelector('.gys-wallet-tour__panel')).toHaveAttribute('data-placement', 'center');
    expect(document.querySelector('.gys-wallet-tour__scrim')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Skip for now'})).toBeVisible();
  });

  it.each<WalletTourStep>(['protect', 'balance', 'receive', 'identity'])('announces the %s step without changing it automatically', (step) => {
    setup({step});
    expect(screen.getByRole('status')).toHaveTextContent(`Step ${['protect', 'balance', 'receive', 'identity'].indexOf(step) + 1} of 4:`);
  });
});
