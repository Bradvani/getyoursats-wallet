import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastProvider } from '@/contexts/ToastContext';
import { getSettings, saveSettings } from '@/services/settings';
import { setAppLanguage } from '@/services/presentationPreferences';
import BitcoinAddressDisplay from './BitcoinAddressDisplay';

beforeEach(() => setAppLanguage('en'));

function renderDetails() {
  render(<ToastProvider><BitcoinAddressDisplay address="bc1qexample" isLoading={false} section="details"/></ToastProvider>);
}

describe('Bitcoin deposit fee disclosure', () => {
  it('separates the receiving deposit cost from the sender fee before sharing an address', () => {
    saveSettings({ depositMaxFee: { type: 'fixed', amount: 500 } });
    renderDetails();
    expect(screen.getByText(/A provider deposit fee is deducted/)).toHaveTextContent('Your sending wallet may charge a separate fee.');
    expect(screen.getByText('Automatic fee limit').parentElement).toHaveTextContent('500 sats');
    expect(screen.getByText(/Deposits within your fee limit/)).toHaveTextContent('including faster delivery when available');
    expect(screen.getByTestId('bitcoin-address-text')).toBeInTheDocument();
    expect(getSettings().depositMaxFee).toEqual({ type: 'fixed', amount: 500 });
  });

  it('keeps fee-rate units distinct from a fixed amount', () => {
    saveSettings({ depositMaxFee: { type: 'rate', satPerVbyte: 3 } });
    renderDetails();
    expect(screen.getByText('Automatic fee limit').parentElement).toHaveTextContent('3 SAT/vB');
    expect(getSettings().depositMaxFee).toEqual({ type: 'rate', satPerVbyte: 3 });
  });

  it('discloses a network-based limit without pretending it is a known total', () => {
    saveSettings({ depositMaxFee: { type: 'networkRecommended', leewaySatPerVbyte: 2 } });
    renderDetails();
    expect(screen.getByText('Automatic fee limit').parentElement).toHaveTextContent('Network rate + 2 SAT/vB');
    expect(getSettings().depositMaxFee).toEqual({ type: 'networkRecommended', leewaySatPerVbyte: 2 });
  });
});
