import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CrossChainRoutePair, PrepareSendPaymentRequest } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '../../../contexts/WalletContext';
import { FiatDataProvider } from '../../../contexts/FiatDataContext';
import { StableBalanceProvider } from '../../../contexts/StableBalanceContext';
import { createMockClient } from '../../../test/mocks/mockWalletApi';
import CrossChainWorkflow from './CrossChainWorkflow';

const route = { chain: 'bsc', asset: 'USDT', provider: 'orchestra', decimals: 18 } as CrossChainRoutePair;
const details = { address: '0xrecipient', addressFamily: 'evm' as const };

function mount({ providers = false, serviceFeeAmount = 12_345n, serviceFeeAsset = 'USDC', serviceFeeAssetDecimals = 6,
  missingFee = false, sourceTransferFeeSats = 0, feesIncluded = false }: { providers?: boolean; serviceFeeAmount?: bigint; serviceFeeAsset?: string; serviceFeeAssetDecimals?: number; missingFee?: boolean; sourceTransferFeeSats?: number; feesIncluded?: boolean } = {}) {
  const client = createMockClient();
  const routes = providers ? [route, { ...route, provider: 'boltz' } as CrossChainRoutePair] : [route];
  client.getCrossChainRoutes = vi.fn().mockResolvedValue(routes);
  client.prepareSendPayment = vi.fn().mockImplementation(async (request: PrepareSendPaymentRequest) => ({
    amount: 1000n,
    paymentMethod: {
      type: 'crossChainAddress', route: request.paymentRequest.type === 'crossChain' ? request.paymentRequest.route : route,
      recipientAddress: details.address, amountIn: 1000n, estimatedOut: 970_000_000_000_000_000n,
      feeAmount: 30_000_000_000_000_000n, sourceTransferFeeSats,
      serviceFeeAmount: missingFee ? undefined : serviceFeeAmount, serviceFeeAsset, serviceFeeAssetDecimals,
      expiresAt: '2099-01-01T00:00:00Z',
    },
  }));
  const run = vi.fn(async (runner: () => Promise<unknown>) => { await runner(); });
  render(<WalletProvider client={client}><FiatDataProvider><StableBalanceProvider>
    <CrossChainWorkflow addressDetails={details} destination={{ details, rawInput: details.address, chain: 'bsc', asset: 'USDT' }}
      amountSats={1000} feesIncluded={feesIncluded} onBack={vi.fn()} onRun={run} />
  </StableBalanceProvider></FiatDataProvider></WalletProvider>);
  return { client, run };
}

describe('cross-chain service fee review', () => {
  it('shows the same actual fee asset and precision in provider preview and confirmation', async () => {
    const {client} = mount({ providers: true });
    const provider = await screen.findByRole('button', { name: /Flashnet/ });
    await within(provider).findByText('0.012345 USDC');
    expect(within(provider).getByText('0.03 USDT')).toBeInTheDocument();
    expect(within(provider).getByText('Estimated conversion cost')).toBeInTheDocument();
    fireEvent.click(provider);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Included service fee')).toBeInTheDocument();
    expect(screen.getAllByText('0.012345 USDC')).toHaveLength(1);
    expect(screen.getByText('~0.97 USDT')).toBeInTheDocument();
    expect(screen.getAllByText('0.03 USDT')).toHaveLength(1);
    expect(screen.getByTestId('cross-chain-source-debit').textContent?.replace(/[^0-9]/g,'')).toBe('1000');
    expect(screen.getByText('Includes provider charges and any GetYourSats fee.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'Send'}));
    await waitFor(() => expect(client.sendPayment).toHaveBeenCalledTimes(1));
    const prepared = await vi.mocked(client.prepareSendPayment).mock.results[0].value;
    expect(client.sendPayment).toHaveBeenCalledWith({prepareResponse:prepared});
    expect(prepared.paymentMethod.amountIn).toBe(1000n);
    expect(prepared.paymentMethod.estimatedOut).toBe(970_000_000_000_000_000n);
  });

  it('shows a quoted zero service fee without hiding it', async () => {
    mount({ serviceFeeAmount: 0n });
    expect(await screen.findByText('0 USDC')).toBeInTheDocument();
    expect(screen.queryByText('Fee unavailable')).toBeNull();
  });

  it('does not substitute a valuation gap or a zero when service fee data is missing', async () => {
    mount({ missingFee: true });
    expect(await screen.findByText('Fee unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0 USDC')).toBeNull();
    expect(screen.getByText('0.03 USDT')).toBeInTheDocument();
  });

  it.each([false, true])('shows the BTC maximum debit with a separate network budget, feesIncluded=%s', async (feesIncluded) => {
    const {client} = mount({sourceTransferFeeSats:100, feesIncluded, providers:true});
    const provider = await screen.findByRole('button',{name:/Flashnet/});
    await within(provider).findByText('100 sats');
    expect(within(provider).getByText('Network fee limit')).toBeInTheDocument();
    fireEvent.click(provider);
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(await screen.findByText('Maximum debit')).toBeInTheDocument();
    expect(screen.getByTestId('cross-chain-source-debit').textContent?.replace(/[^0-9]/g,'')).toBe('1100');
    expect(screen.getByText('Network fee limit')).toBeInTheDocument();
    expect(screen.getAllByText('100 sats')).toHaveLength(1);
    expect(screen.getAllByText('0.03 USDT')).toHaveLength(1);
    expect(screen.getAllByText('0.012345 USDC')).toHaveLength(1);
    expect(screen.getByText('~0.97 USDT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Send'}));
    await waitFor(()=>expect(client.sendPayment).toHaveBeenCalledTimes(1));
    const prepared=await vi.mocked(client.prepareSendPayment).mock.results[0].value;
    expect(client.sendPayment).toHaveBeenCalledWith({prepareResponse:prepared});
    expect(prepared.paymentMethod.amountIn).toBe(1000n);
    expect(prepared.paymentMethod.sourceTransferFeeSats).toBe(100);
    expect(client.prepareSendPayment).toHaveBeenCalledWith(expect.objectContaining({amount:1000n,feePolicy:feesIncluded?'feesIncluded':undefined}));
  });
});
