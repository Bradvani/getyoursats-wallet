import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BreezSdk, CrossChainRoutePair, ReceivePaymentRequest } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import ReceivePaymentDialog from '../ReceivePaymentDialog';
import CrossChainReceiveWorkflow from './CrossChainReceiveWorkflow';

const usdcOn = (chain: string): CrossChainRoutePair => ({
  provider: 'orchestra',
  chain,
  asset: 'USDC',
  decimals: 6,
  exactOutEligible: false,
  acceptedAssets: [{ asset: { type: 'bitcoin' } }],
  deliveryMethods: ['spark'],
}) as unknown as CrossChainRoutePair;

describe('USD receive deposit address', () => {
  it('steps back to the network choice from the header arrow', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    client.getCrossChainRoutes = vi.fn().mockResolvedValue([usdcOn('solana'), usdcOn('base')]);
    const receive = client.receivePayment.bind(client);
    client.receivePayment = vi.fn().mockImplementation(async (request: ReceivePaymentRequest) =>
      request.paymentMethod.type === 'crossChain'
        ? {
            paymentRequest: 'solana:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
            fee: 0n,
            crossChainInfo: {
              depositAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
              depositAmount: 10_050_000n,
              expectedReceivedAmount: 12_298n,
              destinationAsset: 'BTC',
              serviceFeeAmount: 10_000n,
              serviceFeeAsset: 'USDC',
              serviceFeeAssetDecimals: 6,
              expiresAt: 1_900_000_000,
            },
          }
        : receive(request),
    );

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

    fireEvent.click(screen.getByTestId('usd-tab'));
    fireEvent.change(await screen.findByTestId('cross-chain-receive-amount-input'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));
    fireEvent.click(await screen.findByText('Solana'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Your deposit quote');
    expect(screen.queryByTestId('cross-chain-deposit-address')).toBeNull();
    expect(screen.getByRole('button',{name:'Continue to deposit QR'})).toBeDisabled();
    expect(screen.getByTestId('cross-chain-deposit-amount')).toHaveTextContent('10.05 USDC');
    // Service cost is visible before revealing a deposit address or opening
    // the additional cost details. The SDK quote is already net of it.
    expect(screen.getByText('0.01 USDC')).toBeInTheDocument();
    expect(screen.getAllByText('0.01 USDC')).toHaveLength(1);
    expect(screen.getByText('12 298 sats')).toBeInTheDocument();
    expect(screen.getByText('Includes provider charges and any GetYourSats fee.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cost details'));
    // The SDK's service-fee asset differs from the source asset on some
    // routes. Never mislabel their arithmetic difference as chain gas.
    expect(screen.getByText('Service fee')).toBeInTheDocument();
    expect(screen.getByText('Additional quoted deposit')).toBeInTheDocument();
    expect(screen.queryByText('Cross-Chain Network Fee')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:'Continue to deposit QR'}));
    await screen.findByTestId('cross-chain-deposit-address');

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));

    expect(await screen.findByText('Select Network for USDC')).toBeInTheDocument();
    expect(screen.queryByTestId('cross-chain-deposit-address')).toBeNull();
  });
});

describe('USD receive amount', () => {
  it('accepts a comma as the decimal separator', async () => {
    const client = createMockClient() as unknown as BreezSdk;

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

    fireEvent.click(screen.getByTestId('usd-tab'));
    const amount = await screen.findByTestId('cross-chain-receive-amount-input');
    fireEvent.change(amount, { target: { value: '5,50' } });

    expect(amount).toHaveValue('5.50');
    expect(screen.getByTestId('cross-chain-receive-continue')).toBeEnabled();
  });
});

describe('cross-chain deposit service cost', () => {
  it.each([
    { fee: 12_345n, asset: 'USDC', decimals: 6, display: '0.012345 USDC' },
    { fee: 0n, asset: 'USDC', decimals: 6, display: '0 USDC' },
    { fee: 120n, asset: undefined, decimals: undefined, display: '120 sats' },
    { fee: 120n, asset: 'USDC', decimals: undefined, display: 'Fee unavailable' },
  ])('discloses $display once without changing the deposit or net receipt', async ({fee, asset, decimals, display}) => {
    const client = createMockClient();
    const route = {...usdcOn('bsc'), asset:'USDT', decimals:18};
    client.getCrossChainRoutes = vi.fn().mockResolvedValue([route]);
    client.receivePayment = vi.fn().mockResolvedValue({
      paymentRequest: '0xdeposit', fee:0n,
      crossChainInfo: {
        depositAddress:'0xdeposit', depositAmount:10_050_000_000_000_000_000n,
        expectedReceivedAmount:12_298n, destinationAsset:'BTC', serviceFeeAmount:fee,
        serviceFeeAsset:asset, serviceFeeAssetDecimals:decimals, expiresAt:1_900_000_000,
      },
    });
    render(<ToastProvider><WalletProvider client={client} isConnected><FiatDataProvider><StableBalanceProvider>
      <CrossChainReceiveWorkflow active />
    </StableBalanceProvider></FiatDataProvider></WalletProvider></ToastProvider>);
    fireEvent.change(screen.getByTestId('cross-chain-receive-amount-input'), {target:{value:'10'}});
    fireEvent.click(screen.getByTestId('cross-chain-receive-continue'));
    await screen.findByText('Your deposit quote');
    expect(screen.getAllByText(display)).toHaveLength(1);
    expect(screen.getByTestId('cross-chain-deposit-amount')).toHaveTextContent('10.05 USDT');
    expect(screen.getByText('12 298 sats')).toBeInTheDocument();
    expect(screen.queryByTestId('cross-chain-deposit-address')).toBeNull();
    expect(client.receivePayment).toHaveBeenCalledWith({
      paymentMethod:{type:'crossChain', route, amount:10_000_000_000_000_000_000n},
    });
  });
});
