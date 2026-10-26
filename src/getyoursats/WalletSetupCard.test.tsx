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
  beginTour: vi.fn(), next: vi.fn(), skip: vi.fn(),
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

  it('keeps the guide available when backup is checked but setup was skipped', () => {
    const onStartTour = vi.fn();
    render(<WalletSetupCard setup={controller({tourStatus: 'skipped', recoveryStatus: 'phrase-verified'})}
      onReviewRecovery={vi.fn()} onStartTour={onStartTour}/>);
    expect(screen.getByText('Recovery backup checked')).toBeVisible();
    expect(screen.queryByTestId('wallet-setup-backup')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wallet-setup-start'));
    expect(onStartTour).toHaveBeenCalledOnce();
  });

  it('disappears only after both the phrase check and guide are complete', () => {
    render(<WalletSetupCard setup={controller({tourStatus: 'completed', recoveryStatus: 'phrase-verified'})}
      onReviewRecovery={vi.fn()} onStartTour={vi.fn()}/>);
    expect(screen.queryByTestId('wallet-setup-card')).not.toBeInTheDocument();
  });
});
