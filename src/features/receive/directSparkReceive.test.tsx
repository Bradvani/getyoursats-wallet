import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BreezSdk, ReceivePaymentRequest } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import ReceivePaymentDialog from './ReceivePaymentDialog';

function renderReceive(client: BreezSdk) {
  return render(
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
}

describe('fee-free direct Spark receive entry', () => {
  it('offers an explicit Spark receive request without reinterpreting a Lightning Address', async () => {
    const client = createMockClient();
    renderReceive(client);
    await waitForSheetOpen();
    const button = await screen.findByTestId('direct-spark-receive-entry');
    expect(button).toHaveTextContent('0 sats transfer fee');
    fireEvent.click(button);

    const panel = await screen.findByTestId('direct-spark-receive-panel');
    await within(panel).findByTestId('spark-address-text');
    expect(client.receivePayment).toHaveBeenCalledWith({ paymentMethod: { type: 'sparkAddress' } });
    expect(within(panel).getByText(/This is not a Lightning invoice/i)).toBeInTheDocument();
    expect(screen.queryByTestId('lightning-invoice-text')).toBeNull();

    fireEvent.click(within(panel).getByRole('button', { name: 'Back to Lightning' }));
    expect(await screen.findByTestId('direct-spark-receive-entry')).toBeInTheDocument();
  });

  it('does not expose a stale/empty QR when Spark address generation fails and can retry', async () => {
    const client = createMockClient();
    const original = client.receivePayment.bind(client);
    let sparkAttempts = 0;
    client.receivePayment = vi.fn().mockImplementation(async (request: ReceivePaymentRequest) => {
      if (request.paymentMethod.type === 'sparkAddress' && ++sparkAttempts === 1) {
        throw new Error('Spark operator offline');
      }
      return original(request);
    });

    renderReceive(client);
    await waitForSheetOpen();
    fireEvent.click(await screen.findByTestId('direct-spark-receive-entry'));
    const panel = await screen.findByTestId('direct-spark-receive-panel');
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Spark operator offline');
    expect(within(panel).queryByTestId('spark-address-text')).toBeNull();

    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(sparkAttempts).toBe(2));
    await within(panel).findByTestId('spark-address-text');
    expect(within(panel).queryByRole('alert')).toBeNull();
  });
});
