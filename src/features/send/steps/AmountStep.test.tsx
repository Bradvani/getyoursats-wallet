import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import AmountStep, { AmountStepProps } from './AmountStep';

// The mock rate makes a dollar 1,000 sats.
function renderAmountStep(props: Partial<AmountStepProps> = {}, client?: BreezSdk) {
  const onNext = vi.fn();
  const mockClient = client ?? createMockClient();
  render(
    <WalletProvider client={mockClient} isConnected>
      <FiatDataProvider>
        <StableBalanceProvider>
          <AmountStep
            paymentInput="spark1test"
            amount=""
            balanceSats={100000}
            isLoading={false}
            error={null}
            onBack={vi.fn()}
            onNext={onNext}
            {...props}
          />
        </StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
  return { onNext, client: mockClient };
}

describe('AmountStep USD entry (no stable balance)', () => {
  it('lets a user edit Max and resets fee inclusion before continuing', async () => {
    const {onNext} = renderAmountStep();
    fireEvent.click(screen.getByRole('button', {name: 'Max'}));
    const input = screen.getByTestId('amount-input');
    expect(input).toHaveValue(100000);
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, {target: {value: '1500'}});
    fireEvent.click(screen.getByRole('button', {name: 'Continue'}));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(1500n, false));
  });

  it('returns to destination entry without preparing or sending', () => {
    const onBack = vi.fn();
    const {onNext, client} = renderAmountStep({onBack});
    fireEvent.click(screen.getByRole('button', {name: 'Edit destination'}));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onNext).not.toHaveBeenCalled();
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });

  it('disables destination editing while preparing', () => {
    const onBack = vi.fn();
    renderAmountStep({onBack, isLoading: true});
    expect(screen.getByRole('button', {name: 'Edit destination'})).toBeDisabled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('starts in sats and continues with a sats amount', async () => {
    const { onNext } = renderAmountStep();

    const input = screen.getByTestId('amount-input');
    expect(input).toHaveAttribute('placeholder', 'Enter amount in sats');

    fireEvent.change(input, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onNext).toHaveBeenCalledWith(1500n, false));
  });

  it('toggles to USD and converts the typed dollars to sats', async () => {
    const { onNext } = renderAmountStep();

    // The switcher appears once the USD rate loads.
    const switcher = await screen.findByRole('button', { name: 'USD' });
    await waitFor(() => expect(switcher).toBeEnabled());
    fireEvent.click(switcher);

    const input = screen.getByTestId('amount-input');
    expect(input).toHaveAttribute('placeholder', 'Enter amount in USD');

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onNext).toHaveBeenCalledWith(5000n, false));
  });

  it('rejects a USD amount that exceeds the BTC balance', async () => {
    const { onNext } = renderAmountStep();

    await waitFor(() => expect(screen.getByRole('button', {name:'USD'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name:'USD'}));
    fireEvent.change(screen.getByTestId('amount-input'), { target: { value: '500' } });

    // $500 = 500,000 sats > 100,000 sats balance
    await screen.findByText('Amount exceeds available balance');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('offers no USD toggle while the rate has not loaded', async () => {
    const client = createMockClient({
      listFiatRates: vi.fn().mockResolvedValue({ rates: [] }),
    } as unknown as Partial<BreezSdk>);
    renderAmountStep({}, client);

    await waitFor(() => expect(client.listFiatRates).toHaveBeenCalled());
    expect(screen.getByRole('button', {name:'USD'})).toBeDisabled();
    expect(screen.getByTestId('amount-input')).toHaveAttribute(
      'placeholder',
      'Enter amount in sats'
    );
  });

  it('keeps Max beside the available balance without preset amount chips', () => {
    renderAmountStep({balanceSats: 3000});
    const available = screen.getByTestId('amount-available-balance');
    const max = screen.getByRole('button', {name: 'Max'});
    expect(available).toHaveTextContent('3 000 sats');
    expect(available).toContainElement(max);
    expect(screen.queryByRole('button', {name: /[0-9].*sats/})).toBeNull();
    fireEvent.click(max);
    expect(screen.getByTestId('amount-input')).toHaveValue(3000);
    expect(max).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps typed sats usable before a fiat rate arrives', async () => {
    const client = createMockClient({
      listFiatRates: vi.fn(() => new Promise(() => {})),
    } as unknown as Partial<BreezSdk>);
    const {onNext} = renderAmountStep({balanceSats: 3000}, client);
    fireEvent.change(screen.getByTestId('amount-input'), {target: {value: '1000'}});
    fireEvent.click(screen.getByRole('button', {name: 'Continue'}));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(1000n, false));
  });

  it('keeps cross-chain (amountFirst) USD-only with no toggle', async () => {
    renderAmountStep({ amountFirst: true });

    expect(screen.getByTestId('amount-input')).toHaveAttribute(
      'placeholder',
      'Enter amount in USD'
    );
    expect(screen.queryByRole('button', { name: 'sats' })).toBeNull();
    expect(screen.queryByRole('button', { name: '$' })).toBeNull();
  });
});

it('keeps fractional sats invalid instead of multiplying the amount', async () => {
  const {onNext} = renderAmountStep();
  fireEvent.change(screen.getByTestId('amount-input'), {target:{value:'1.5'}});
  expect(screen.getByRole('button', {name:'Continue'})).toBeDisabled();
  expect(onNext).not.toHaveBeenCalled();
});

it('clears payment eligibility after an ambiguous fiat paste, preserving it for correction', async () => {
  const {onNext} = renderAmountStep();
  await waitFor(() => expect(screen.getByRole('button', {name:'USD'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button', {name:'USD'}));
  const input = screen.getByTestId('amount-input');
  fireEvent.change(input, {target:{value:'5'}});
  fireEvent.change(input, {target:{value:'1,234'}});
  expect(input).toHaveValue('1,234');
  expect(screen.getByRole('button', {name:'Continue'})).toBeDisabled();
  expect(onNext).not.toHaveBeenCalled();
});
