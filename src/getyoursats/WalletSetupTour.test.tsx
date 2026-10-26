import {useState} from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {APP_LANGUAGES, getAppLanguage, setAppLanguage} from '../services/presentationPreferences';
import {walletSetupCopy} from '../locales/walletSetup';
import {WALLET_TOUR_STEPS} from './walletSetupState';
import WalletSetupTour, {type WalletTourStep} from './WalletSetupTour';

vi.mock('../locales/loadFonts', () => ({loadLocaleFonts: vi.fn(async () => {})}));

let reducedMotion = true;
const motionListeners = new Set<() => void>();

function changeMotionPreference(value: boolean) {
  reducedMotion = value;
  motionListeners.forEach(listener => listener());
}

const callbacks = () => ({
  onNext: vi.fn(), onSkip: vi.fn(), onReviewRecovery: vi.fn(), onPersonalize: vi.fn(),
  onOpenReceive: vi.fn(), onOpenPos: vi.fn(),
});

function setup(props: Partial<Parameters<typeof WalletSetupTour>[0]> = {}) {
  const actions = callbacks();
  const view = render(<WalletSetupTour step="language" recoveryMethod="passkey" recoveryStatus="pending"
    hasNativeAddress={false} {...actions} {...props}/>);
  return {...view, ...actions};
}

beforeEach(() => {
  reducedMotion = true;
  motionListeners.clear();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() { return media === '(prefers-reduced-motion: reduce)' && reducedMotion; },
    onchange: null,
    addEventListener: (_event: string, listener: () => void) => {
      if (media === '(prefers-reduced-motion: reduce)') motionListeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => motionListeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  localStorage.clear();
  setAppLanguage('en');
});

afterEach(() => {
  cleanup();
  setAppLanguage('en');
  vi.unstubAllGlobals();
});

describe('inline wallet guide', () => {
  it('keeps the wallet accessible without taking focus or opening a modal', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    const onWalletAction = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open guide</button>
        {open && <WalletSetupTour step="protect" recoveryMethod="passkey" recoveryStatus="pending"
          hasNativeAddress={false} {...actions}/>}
        <button type="button" onClick={onWalletAction}>Use the wallet</button>
      </>;
    }
    const view = render(<Harness/>);
    const opener = screen.getByRole('button', {name: 'Open guide'});
    await user.click(opener);
    expect(screen.getByRole('region', {name: 'Wallet guide'})).toBeVisible();
    expect(opener).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view.container).not.toHaveAttribute('inert');
    expect(view.container).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).not.toBe('hidden');
    await user.click(screen.getByRole('button', {name: 'Use the wallet'}));
    expect(onWalletAction).toHaveBeenCalledOnce();
    expect(actions.onSkip).not.toHaveBeenCalled();
    expect(actions.onNext).not.toHaveBeenCalled();
  });

  it('allows keyboard focus to leave the inline guide', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(<>
      <WalletSetupTour step="protect" recoveryMethod="passkey" recoveryStatus="pending" hasNativeAddress={false} {...actions}/>
      <button type="button">Wallet action after guide</button>
    </>);
    screen.getByTestId('wallet-setup-next').focus();
    await user.tab();
    expect(screen.getByRole('button', {name: 'Wallet action after guide'})).toHaveFocus();
  });

  it('keeps Next focused across chapters and keeps Skip independently available', () => {
    const actions = callbacks();
    const props = {recoveryMethod: 'passkey' as const, recoveryStatus: 'pending' as const, hasNativeAddress: false, ...actions};
    const view = render(<WalletSetupTour step="protect" {...props}/>);
    const next = screen.getByTestId('wallet-setup-next');
    next.focus();
    fireEvent.click(next);
    expect(actions.onNext).toHaveBeenCalledOnce();
    expect(actions.onReviewRecovery).not.toHaveBeenCalled();
    view.rerender(<WalletSetupTour step="balance" {...props}/>);
    expect(screen.getByTestId('wallet-setup-next')).toBe(next);
    expect(next).toHaveFocus();
    fireEvent.click(screen.getByTestId('wallet-setup-skip'));
    expect(actions.onSkip).toHaveBeenCalledOnce();
    expect(actions.onReviewRecovery).not.toHaveBeenCalled();
  });

  it('lets the language choice immediately update the guide and persists the override', async () => {
    const user = userEvent.setup();
    setAppLanguage('hi');
    setup();
    expect(screen.getByRole('heading', {name: 'अपनी भाषा चुनें'})).toBeVisible();
    const chooser = screen.getByRole('combobox', {name: 'भाषा'});
    await user.click(chooser);
    await user.clear(chooser);
    await user.type(chooser, 'English');
    await user.click(screen.getByRole('option', {name: 'English'}));
    expect(screen.getByRole('heading', {name: 'Choose your language'})).toBeVisible();
    expect(screen.getByRole('combobox', {name: 'Language'})).toHaveValue('English');
    expect(getAppLanguage()).toBe('en');
    expect(localStorage.getItem('gys:language:v1')).toBe('en');
  });

  it('starts from a detected device language without requiring it to be saved first', () => {
    localStorage.removeItem('gys:language:v1');
    vi.stubGlobal('navigator', {...navigator, languages: ['hi-IN', 'en-US']});
    setup();
    expect(screen.getByRole('heading', {name: 'अपनी भाषा चुनें'})).toBeVisible();
    expect(screen.getByRole('combobox', {name: 'भाषा'})).toHaveValue('हिन्दी');
    expect(localStorage.getItem('gys:language:v1')).toBeNull();
  });

  it('keeps independent backup outstanding after passkey review', () => {
    const actions = setup({step: 'protect', recoveryStatus: 'passkey-reviewed'});
    expect(screen.getByRole('heading', {name: 'Give yourself a way back'})).toBeVisible();
    expect(screen.getByText('Write down your recovery words and check the copy before adding more sats.')).toBeVisible();
    expect(screen.getByText('Keep an independent backup in case you lose access to your passkey or its provider.')).toBeVisible();
    expect(screen.queryByText(/optional/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Recovery backup checked on this device.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wallet-setup-action'));
    expect(actions.onReviewRecovery).toHaveBeenCalledOnce();
    expect(actions.onNext).not.toHaveBeenCalled();
  });

  it('recognises verified recovery without requesting another word check', () => {
    setup({step: 'protect', recoveryMethod: 'phrase', recoveryStatus: 'phrase-verified'});
    expect(screen.getByRole('heading', {name: 'Your recovery copy is checked'})).toBeVisible();
    expect(screen.getByText('Recovery backup checked on this device.')).toBeVisible();
    expect(screen.queryByTestId('wallet-setup-action')).not.toBeInTheDocument();
    expect(screen.getByTestId('wallet-setup-next')).toBeVisible();
  });

  it.each([
    ['receive', 'onOpenReceive'], ['pos', 'onOpenPos'], ['identity', 'onPersonalize'],
  ] as const)('opens the actual %s destination only on its contextual action', (step, callback) => {
    const actions = setup({step});
    expect(actions[callback]).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('wallet-setup-next'));
    expect(actions.onNext).toHaveBeenCalledOnce();
    expect(actions[callback]).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('wallet-setup-action'));
    expect(actions[callback]).toHaveBeenCalledOnce();
  });

  it('shows POS as a preview with a real checkout action and an explicit confirmation requirement', () => {
    setup({step: 'pos'});
    expect(screen.getByText('Preview')).toBeVisible();
    expect(screen.getByText('Set a price')).toBeVisible();
    expect(screen.getByText('Show QR')).toBeVisible();
    expect(screen.getByText('Confirm payment')).toBeVisible();
    expect(screen.getByText('Wait for confirmed payment before completing a sale.')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Explore Point of Sale'})).toBeVisible();
    expect(screen.queryByText(/payment received|paid/i)).not.toBeInTheDocument();
  });

  it('keeps naming separate from recovery and recognises an existing native name', () => {
    const actions = callbacks();
    const props = {step: 'identity' as const, recoveryMethod: 'passkey' as const, recoveryStatus: 'pending' as const, ...actions};
    const view = render(<WalletSetupTour hasNativeAddress={false} {...props}/>);
    expect(screen.getByText('Email is for your name. It cannot recover your wallet.')).toBeVisible();
    expect(screen.getByTestId('wallet-setup-next')).toHaveTextContent('Finish');
    view.rerender(<WalletSetupTour hasNativeAddress {...props}/>);
    expect(screen.getByRole('heading', {name: 'Your address is ready'})).toBeVisible();
    expect(screen.queryByTestId('wallet-setup-action')).not.toBeInTheDocument();
  });

  it('preserves geometry under covering flows while removing the guide from interaction', () => {
    const actions = callbacks();
    const props = {step: 'protect' as const, recoveryMethod: 'passkey' as const, recoveryStatus: 'pending' as const, hasNativeAddress: false, ...actions};
    const view = render(<WalletSetupTour {...props}/>);
    const guide = screen.getByTestId('wallet-setup-guide');
    view.rerender(<WalletSetupTour {...props} paused/>);
    expect(screen.getByTestId('wallet-setup-guide')).toBe(guide);
    expect(guide).toHaveAttribute('inert');
    expect(guide).toHaveAttribute('aria-hidden', 'true');
    expect(guide).toHaveAttribute('data-paused', 'true');
    expect(screen.queryByRole('region', {name: 'Wallet guide'})).not.toBeInTheDocument();
    view.rerender(<WalletSetupTour {...props}/>);
    expect(screen.getByRole('region', {name: 'Wallet guide'})).toBe(guide);
    expect(guide).not.toHaveAttribute('inert');
    expect(guide).not.toHaveAttribute('aria-hidden');
  });

  it('keeps all information visible and actions manual with reduced motion', () => {
    const actions = setup({step: 'pos'});
    expect(screen.getByTestId('wallet-setup-guide')).toHaveAttribute('data-motion', 'reduced');
    expect(screen.getByRole('heading', {name: 'Your wallet is a checkout'})).toBeVisible();
    expect(screen.getByTestId('wallet-setup-next')).toBeVisible();
    expect(actions.onNext).not.toHaveBeenCalled();
    expect(actions.onOpenPos).not.toHaveBeenCalled();
  });

  it('responds to device motion preferences immediately while preserving focus and manual progression', () => {
    reducedMotion = false;
    const actions = setup({step: 'pos'});
    const guide = screen.getByTestId('wallet-setup-guide');
    const next = screen.getByTestId('wallet-setup-next');
    next.focus();
    expect(guide).toHaveAttribute('data-motion', 'full');

    act(() => changeMotionPreference(true));
    expect(guide).toHaveAttribute('data-motion', 'reduced');
    expect(screen.getByTestId('wallet-setup-next')).toBe(next);
    expect(next).toHaveFocus();

    act(() => changeMotionPreference(false));
    expect(guide).toHaveAttribute('data-motion', 'full');
    expect(next).toHaveFocus();
    expect(actions.onNext).not.toHaveBeenCalled();
    expect(actions.onOpenPos).not.toHaveBeenCalled();
    actions.unmount();
    expect(motionListeners.size).toBe(0);
  });

  it.each(APP_LANGUAGES)('uses complete $code guide copy and the correct reading direction', ({code}) => {
    setAppLanguage(code);
    setup({step: 'pos'});
    const text = walletSetupCopy(code);
    expect(screen.getByRole('region', {name: text.guideLabel})).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
    expect(screen.getByRole('heading', {name: text.steps.pos.title})).toBeVisible();
    expect(screen.getByTestId('wallet-setup-next')).toHaveTextContent(text.next);
    expect(screen.getByTestId('wallet-setup-action')).toHaveTextContent(text.posAction);
    expect(Object.keys(text.steps)).toEqual(WALLET_TOUR_STEPS);
    expect(Object.values(text.steps).every(value => Boolean(value.title && value.body && value.detail))).toBe(true);
  });

  it.each<WalletTourStep>(['language', 'protect', 'balance', 'receive', 'pos', 'identity'])('announces %s without automatic progression', step => {
    const actions = setup({step});
    const position = WALLET_TOUR_STEPS.indexOf(step) + 1;
    expect(screen.getByTestId('wallet-setup-guide')).toHaveAttribute('data-wallet-tour-step', step);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(position));
    expect(screen.getByRole('status')).toHaveTextContent(`${position}/6:`);
    expect(actions.onNext).not.toHaveBeenCalled();
    expect(actions.onSkip).not.toHaveBeenCalled();
  });

  it('reacts to language changes without remounting the persistent Next control', () => {
    setup({step: 'receive'});
    const next = screen.getByTestId('wallet-setup-next');
    next.focus();
    act(() => setAppLanguage('ar'));
    expect(screen.getByTestId('wallet-setup-next')).toBe(next);
    expect(next).toHaveFocus();
    expect(screen.getByRole('heading', {name: walletSetupCopy('ar').steps.receive.title})).toBeVisible();
  });
});
