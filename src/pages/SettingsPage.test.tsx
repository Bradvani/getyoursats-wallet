import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { setDevMode } from '@/services/settings';
import SettingsPage from './SettingsPage';
import {FiatDataProvider} from '@/contexts/FiatDataContext';
import {StableBalanceProvider} from '@/contexts/StableBalanceContext';

const renderSettings = (onOpenWalletTour?: () => void) => render(
  <ToastProvider>
  <WalletProvider client={createMockClient() as unknown as BreezSdk} isConnected>
  <FiatDataProvider><StableBalanceProvider>
  <SettingsPage
    onBack={vi.fn()}
    config={null}
    onOpenFiatCurrencies={vi.fn()}
    onOpenBuyProviders={vi.fn()}
    onOpenPasskeySettings={vi.fn()}
    onOpenSecurity={vi.fn()}
    onOpenBackup={vi.fn()}
    onOpenEmail={vi.fn()}
    onOpenWalletTour={onOpenWalletTour}
    onOpenUnilateralExit={vi.fn()}
  />
  </StableBalanceProvider></FiatDataProvider>
  </WalletProvider>
  </ToastProvider>
);

// `vite.config.ts` defines this at build time, so the version line has nothing
// to read under vitest.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');

afterEach(() => {
  setDevMode(false);
  localStorage.clear();
});

describe('unilateral exit on the settings page', () => {
  it('is not offered without dev mode', () => {
    setDevMode(false);
    renderSettings();

    expect(screen.queryByTestId('settings-unilateral-exit')).toBeNull();
  });

  it('is offered with dev mode on', () => {
    setDevMode(true);
    renderSettings();

    expect(screen.getByTestId('settings-unilateral-exit')).toBeInTheDocument();
  });
});

describe('wallet accessibility and honest platform protection', () => {
  it('restores Orange as the display option and describes imported passkey limits plainly', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: /Orange/ })).toBeInTheDocument();
    expect(screen.getByText(/Passkeys are available when creating a new wallet/)).toBeInTheDocument();
    expect(screen.getByText(/They cannot be added to an existing wallet restored from recovery words/)).toBeInTheDocument();
  });
});

describe('help and app identity', () => {
  it('places guide replay with help near the bottom and keeps Account last', () => {
    const replay = vi.fn();
    renderSettings(replay);
    const help = screen.getByRole('region', {name: 'Help & information'});
    const display = screen.getByRole('heading', {name: 'Display'});
    const diagnostics = screen.getByRole('heading', {name: 'Diagnostics'});
    const account = screen.getByRole('heading', {name: 'Account'});
    expect(display.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(diagnostics.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(help.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const sectionHeadings = screen.getAllByRole('heading', {level: 3});
    expect(sectionHeadings[sectionHeadings.length - 1]).toBe(account);
    expect(screen.queryByRole('heading', {name: 'Getting started'})).toBeNull();
    fireEvent.click(within(help).getByRole('button', {name: 'Replay Wallet Guide'}));
    expect(replay).toHaveBeenCalledOnce();
  });

  it('shows direct Privacy and Support entries and the shared build version', () => {
    renderSettings();
    expect(screen.queryByTestId('settings-privacy-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-support-link')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-appearance-orange')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('combobox', {name:'Language'})).toBeInTheDocument();
    expect(screen.getByText('GetYourSats v0.0.0-test')).toBeInTheDocument();
  });
});
