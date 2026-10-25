import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '../../../contexts/WalletContext';
import { FiatDataProvider } from '../../../contexts/FiatDataContext';
import { StableBalanceProvider } from '../../../contexts/StableBalanceContext';
import { createMockClient } from '../../../test/mocks/mockWalletApi';
import CrossChainWorkflow from './CrossChainWorkflow';

const route = { chain: 'base', asset: 'USDC', provider: 'orchestra', decimals: 6 } as CrossChainRoutePair;
const details = { address: '0xrecipient', addressFamily: 'evm' as const };
function mount({ unavailable = false, wrongRecipient = false, expired = false } = {}) {
  const client = createMockClient();
  client.getCrossChainRoutes = vi.fn().mockResolvedValue(unavailable ? [{ ...route, chain: 'ethereum' }] : [route]);
  client.prepareSendPayment = vi.fn().mockResolvedValue({ amount: 1000n, paymentMethod: {
    type: 'crossChainAddress', route, recipientAddress: wrongRecipient ? '0xother' : details.address,
    amountIn: 1000n, estimatedOut: 990000n, feeAmount: 10000n,
    expiresAt: expired ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
  } });
  const run = vi.fn();
  render(<WalletProvider client={client}><FiatDataProvider><StableBalanceProvider>
    <CrossChainWorkflow addressDetails={details} destination={{ details, rawInput: details.address, chain: 'base', asset: 'USDC' }}
      amountSats={1000} feesIncluded={false} onBack={vi.fn()} onRun={run} />
  </StableBalanceProvider></FiatDataProvider></WalletProvider>);
  return { client, run };
}
describe('cross-chain execution keeps the selected destination', () => {
  it('does not substitute a different network when the selected route disappears', async () => {
    const { client, run } = mount({ unavailable: true });
    await screen.findByText('The selected asset and network are unavailable. Go back and review the destination.');
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it('refuses a quote for another recipient', async () => {
    const { client, run } = mount({ wrongRecipient: true });
    await screen.findByText('Couldn’t get a quote from any provider right now. Try again, or go back and use a different amount.');
    expect(screen.queryByRole('button', { name: /^Send$/ })).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });
  it('requires a fresh review when the quote has expired', async () => {
    const { client, run } = mount({ expired: true });
    fireEvent.click(await screen.findByRole('button', { name: /^Send$/ }));
    await screen.findByText('This quote has expired or no longer matches the destination. Go back to request and review a new quote.');
    expect(run).not.toHaveBeenCalled();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });
});
