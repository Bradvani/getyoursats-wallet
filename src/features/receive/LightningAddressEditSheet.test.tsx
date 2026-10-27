import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BreezSdk, LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import ReceivePaymentDialog from './ReceivePaymentDialog';

const address = (username: string): LightningAddressInfo => ({
  description: `Pay to ${username}@breez.tips`,
  lightningAddress: `${username}@breez.tips`,
  lnurl: { url: `https://breez.tips/lnurlp/${username}`, bech32: 'lnurl1dp68gurn8ghj7' },
  username,
});

describe('anonymous Lightning Address personalization', () => {
  it('shows readiness instead of setup advice for the wallet-confirmed personal address', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    const personal = {...address('reader'), lightningAddress: 'reader@getyoursats.com'};
    render(
      <ToastProvider><WalletProvider client={client} isConnected preferredLightningAddress={personal}>
        <FiatDataProvider><StableBalanceProvider>
          <ReceivePaymentDialog isOpen onClose={vi.fn()} />
        </StableBalanceProvider></FiatDataProvider>
      </WalletProvider></ToastProvider>,
    );
    await waitForSheetOpen();
    expect(await screen.findByTestId('lightning-address-text')).toHaveTextContent('reader@getyoursats.com');
    expect(screen.getByText('Your personal GetYourSats address is ready to receive payments.')).toBeInTheDocument();
    expect(screen.queryByText('Personalize your address in Settings after email verification.')).toBeNull();
    expect(client.registerLightningAddress).not.toHaveBeenCalled();
  });
  it('keeps the SDK-issued Breez receiver stable and directs personalization through verified identity', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    client.getLightningAddress = vi.fn().mockResolvedValue(address('alice'));
    render(
      <ToastProvider>
        <WalletProvider client={client} isConnected>
          <FiatDataProvider>
            <StableBalanceProvider>
              <ReceivePaymentDialog isOpen onClose={vi.fn()} />
            </StableBalanceProvider>
          </FiatDataProvider>
        </WalletProvider>
      </ToastProvider>,
    );
    await waitForSheetOpen();
    expect(await screen.findByTestId('lightning-address-text')).toBeInTheDocument();
    expect(screen.queryByTitle('Edit Lightning Address')).toBeNull();
    expect(screen.getByText('Personalize your address in Settings after email verification.')).toBeInTheDocument();
    expect(client.registerLightningAddress).not.toHaveBeenCalled();
  });
});
