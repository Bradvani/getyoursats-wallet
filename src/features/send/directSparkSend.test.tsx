import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BreezSdk, PrepareSendPaymentResponse } from '@breeztech/breez-sdk-spark';
import { WalletProvider, WalletInfoProvider, WalletStatusProvider } from '@/contexts/WalletContext';
import { ContactsProvider } from '@/contexts/ContactsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient, createMockPayment } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import SendPaymentDialog from './SendPaymentDialog';

const ADDRESS = 'spark1testaddress123456789';

describe('direct Spark BTC sending', () => {
  it('prepares and sends directly to a Spark address without LNURL-Pay', async () => {
    const client = createMockClient() as BreezSdk;
    const prepared = {
      paymentMethod: { type: 'sparkAddress', address: ADDRESS },
      amount: 1000n,
    } as unknown as PrepareSendPaymentResponse;
    client.prepareSendPayment = vi.fn().mockResolvedValue(prepared);
    client.sendPayment = vi.fn().mockResolvedValue({
      payment: createMockPayment('send', { amount: 1000n, fees: 0n }),
    });

    render(
      <ToastProvider>
        <WalletProvider client={client} isConnected>
          <WalletInfoProvider walletInfo={{ balanceSats: 500_000 } as never}>
            <WalletStatusProvider hasPendingConversion={false}>
              <FiatDataProvider>
                <StableBalanceProvider>
                  <ContactsProvider>
                    <SendPaymentDialog isOpen onClose={vi.fn()} />
                  </ContactsProvider>
                </StableBalanceProvider>
              </FiatDataProvider>
            </WalletStatusProvider>
          </WalletInfoProvider>
        </WalletProvider>
      </ToastProvider>,
    );
    await waitForSheetOpen();

    fireEvent.change(await screen.findByTestId('payment-input'), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByTestId('continue-button'));
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Continue'));
    const confirm = await screen.findByTestId('send-confirm-button');
    expect(client.prepareSendPayment).toHaveBeenCalledWith(expect.objectContaining({
      paymentRequest: { type: 'input', input: ADDRESS },
      amount: 1000n,
    }));

    fireEvent.click(confirm);
    await waitFor(() => expect(client.sendPayment).toHaveBeenCalledWith({
      prepareResponse: prepared,
      options: undefined,
    }));
    expect(client.lnurlPay).not.toHaveBeenCalled();
  });
});
