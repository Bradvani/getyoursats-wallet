import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LnurlWorkflow from './LnurlWorkflow';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
const parsed = {
  callback: 'https://example.invalid',
  minSendable: 1000,
  maxSendable: 200_000_000_000,
  metadataStr: '[["text/plain","Moto"]]',
  commentAllowed: 255,
  domain: 'example.invalid',
  url: 'https://example.invalid',
};
function setup(initial: number | undefined = 2049, min = 1000) {
  const onPrepare = vi.fn().mockResolvedValue({ amountSats: 1000, feeSats: 2 });
  const onPay = vi.fn();
  const onRun = vi.fn();
  const client = createMockClient() as unknown as BreezSdk;
  const view = (balanceSats: number | undefined) => (
    <WalletProvider client={client}>
      <FiatDataProvider>
        <StableBalanceProvider>
          <LnurlWorkflow
            parsed={{ ...parsed, minSendable: min }}
            balanceSats={balanceSats}
            onPrepare={onPrepare}
            onPay={onPay}
            onRun={onRun}
            onBack={() => {}}
          />
        </StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
  const mounted = render(view(initial));
  return {
    onPrepare,
    onPay,
    onRun,
    update: (n: number | undefined) => mounted.rerender(view(n)),
  };
}
describe('LNURL available balance', () => {
  it('shows the live wallet balance separately from the recipient range', () => {
    const { update } = setup();
    expect(screen.getByTestId('lnurl-available-balance')).toHaveTextContent(
      '2 049 sats'
    );
    expect(screen.getByLabelText('Amount')).toHaveAttribute(
      'placeholder',
      'Enter amount'
    );
    update(3500);
    expect(screen.getByTestId('lnurl-available-balance')).toHaveTextContent(
      '3 500 sats'
    );
  });
  it('shows unknown balance as loading and prevents preparation', () => {
    const { onPrepare, update } = setup();
    update(undefined);
    expect(screen.getByTestId('lnurl-available-balance')).toHaveTextContent(
      'Checking balance'
    );
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '1' },
    });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(onPrepare).not.toHaveBeenCalled();
  });
  it('revalidates a previously selected maximum after the balance drops', () => {
    const { update, onPrepare } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(screen.getByLabelText('Amount')).toHaveValue(2049);
    update(100);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText('Amount exceeds available balance')).toBeVisible();
    expect(onPrepare).not.toHaveBeenCalled();
  });
  it('prepares Max with SDK fee inclusion', async () => {
    const { onPrepare } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Max' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(onPrepare).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2049n, feePolicy: 'feesIncluded' })
      )
    );
  });
  it('permits amounts above one BTC when balance and recipient allow it', async () => {
    const { onPrepare } = setup(190_000_000);
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '150000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(onPrepare).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 150000000n })
      )
    );
  });
  it('rejects amounts above the recipient limit even with enough funds', () => {
    const { onPrepare } = setup(300_000_000);
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '250000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onPrepare).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Recipient accepts/)).toHaveLength(2);
  });
  it('caps Max at the recipient limit and keeps fees included', async () => {
    const { onPrepare } = setup(300_000_000);
    fireEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(screen.getByLabelText('Amount')).toHaveValue(200_000_000);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(onPrepare).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 200_000_000n,
          feePolicy: 'feesIncluded',
        })
      )
    );
  });
  it('rejects a recipient minimum greater than the balance', () => {
    const { onPrepare } = setup(10, 100_000);
    expect(
      screen.queryByRole('button', { name: 'Max' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Your balance is below the recipient’s minimum.')
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Amount'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onPrepare).not.toHaveBeenCalled();
  });
});
