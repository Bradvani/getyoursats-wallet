import {APP_LANGUAGES, setAppLanguage} from '../services/presentationPreferences';
import {walletSetupCopy} from '../locales/walletSetup';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import WalletSetupCard from './WalletSetupCard';
import {EMPTY_WALLET_SETUP, type WalletSetupProgress} from './walletSetupState';
import type {WalletSetupController} from '../hooks/useWalletSetup';

beforeEach(() => localStorage.setItem('gys:language:v1', 'en'));
afterEach(() => { cleanup(); localStorage.clear(); });

const controller = (progress: Partial<WalletSetupProgress>): WalletSetupController => ({
  scope: 'gys:wallet-setup:v1:mainnet:02' + 'a'.repeat(64),
  progress: {...EMPTY_WALLET_SETUP, ...progress},
  beginTour: vi.fn(), next: vi.fn(), skip: vi.fn(), dismissCard: vi.fn(),
});

describe('setup card backup completion', () => {
  it('keeps backup actionable after a passkey review and completed guide', () => {
    const onReviewRecovery = vi.fn();
    render(<WalletSetupCard setup={controller({tourStatus: 'completed', recoveryStatus: 'passkey-reviewed'})}
      onReviewRecovery={onReviewRecovery} onStartTour={vi.fn()}/>);
    expect(screen.getByTestId('wallet-setup-card')).toHaveTextContent('Passkey reviewed. Back up your wallet.');
    expect(screen.getByTestId('wallet-setup-card')).toHaveTextContent('1/2');
    fireEvent.click(screen.getByTestId('wallet-setup-backup'));
    expect(onReviewRecovery).toHaveBeenCalledOnce();
  });

  it.each(['not-started', 'skipped', 'completed'] as const)('hides a verified backup card even when the guide is %s', tourStatus => {
    render(<WalletSetupCard setup={controller({tourStatus, recoveryStatus: 'phrase-verified'})}
      onReviewRecovery={vi.fn()} onStartTour={vi.fn()}/>);
    expect(screen.queryByTestId('wallet-setup-card')).not.toBeInTheDocument();
  });

  it('offers an accessible exit without completing backup', () => {
    const setup = controller({});
    render(<WalletSetupCard setup={setup} onReviewRecovery={vi.fn()} onStartTour={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss wallet setup'}));
    expect(setup.dismissCard).toHaveBeenCalledOnce();
    expect(setup.progress.recoveryStatus).toBe('pending');
    expect(setup.next).not.toHaveBeenCalled();
  });

  it('hides a dismissed card with an unverified backup', () => {
    render(<WalletSetupCard setup={controller({cardDismissed: true})}
      onReviewRecovery={vi.fn()} onStartTour={vi.fn()}/>);
    expect(screen.queryByTestId('wallet-setup-card')).not.toBeInTheDocument();
  });

  it('disappears only after both the phrase check and guide are complete', () => {
    render(<WalletSetupCard setup={controller({tourStatus: 'completed', recoveryStatus: 'phrase-verified'})}
      onReviewRecovery={vi.fn()} onStartTour={vi.fn()}/>);
    expect(screen.queryByTestId('wallet-setup-card')).not.toBeInTheDocument();
  });
});

it.each(APP_LANGUAGES)('labels the exit in $code', ({code}) => {
  setAppLanguage(code);
  render(<WalletSetupCard setup={controller({})} onReviewRecovery={vi.fn()} onStartTour={vi.fn()}/>);
  expect(screen.getByRole('button', {name: walletSetupCopy(code).dismiss})).toBeVisible();
});
