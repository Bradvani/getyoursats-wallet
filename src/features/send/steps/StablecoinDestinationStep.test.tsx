import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BreezSdk, CrossChainRoutePair, PrepareSendPaymentResponse } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '../../../contexts/WalletContext';
import { createMockClient } from '../../../test/mocks/mockWalletApi';
import StablecoinDestinationStep from './StablecoinDestinationStep';
import { quoteIsCurrent, quoteMatchesDestination, routeMatchesAddress, type StablecoinDestination } from '../utils/stablecoinDestination';

const route = (chain: string, asset = 'USDC') => ({ chain, asset, provider: 'orchestra' }) as CrossChainRoutePair;
const details = { address: '0xrecipient', addressFamily: 'evm' as const };
function setup(routes = [route('base'), route('ethereum')]) {
  const next = vi.fn();
  const client = createMockClient() as BreezSdk;
  client.parse = vi.fn().mockResolvedValue({ type: 'crossChainAddress', ...details });
  client.getCrossChainRoutes = vi.fn().mockResolvedValue(routes);
  render(<WalletProvider client={client}><StablecoinDestinationStep initialInput={details.address} onBack={vi.fn()} onContinue={next} /></WalletProvider>);
  return { client, next };
}
async function choose(chain = 'base') {
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Recipient receives'), { target: { value: 'USDC' } });
  fireEvent.change(screen.getByLabelText('Destination network'), { target: { value: chain } });
}
describe('stablecoin destination review', () => {
  it('requires explicit asset and network selection before amount, even with one route', async () => {
    const { next, client } = setup([route('solana')]);
    await waitFor(() => expect(client.getCrossChainRoutes).toHaveBeenCalledWith({ type: 'send', addressDetails: { type: 'crossChainAddress', ...details } }));
    expect(screen.getByRole('button', { name: 'Continue to amount' })).toBeDisabled();
    await choose('solana');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to amount' }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ asset: 'USDC', chain: 'solana', rawInput: details.address }));
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });
  it('invalidates the network when changing assets', async () => {
    setup([route('base'), route('tron', 'USDT')]);
    await choose();
    expect(screen.getByRole('button', { name: 'Continue to amount' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Recipient receives'), { target: { value: 'USDT' } });
    expect(screen.getByLabelText('Destination network')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Continue to amount' })).toBeDisabled();
  });
  it('blocks immediately after editing an address and refuses an incompatible old network', async () => {
    const { client } = setup();
    await choose();
    vi.mocked(client.getCrossChainRoutes).mockResolvedValue([route('solana')]);
    fireEvent.change(screen.getByLabelText('Recipient address'), { target: { value: 'solanaRecipient' } });
    expect(screen.getByRole('button', { name: 'Continue to amount' })).toBeDisabled();
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Destination network')).toHaveValue('base');
    expect(screen.getByRole('button', { name: 'Continue to amount' })).toBeDisabled();
  });
  it('ignores a stale lookup response after a newer address is entered', async () => {
    const { client } = setup();
    let resolveOld!: (routes: CrossChainRoutePair[]) => void;
    vi.mocked(client.getCrossChainRoutes).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await waitFor(() => expect(resolveOld).toBeDefined());
    fireEvent.change(screen.getByLabelText('Recipient address'), { target: { value: 'newRecipient' } });
    vi.mocked(client.getCrossChainRoutes).mockResolvedValue([route('tron', 'USDT')]);
    await waitFor(() => expect(client.getCrossChainRoutes).toHaveBeenCalledTimes(2));
    await act(async () => resolveOld([route('base')]));
    fireEvent.change(screen.getByLabelText('Recipient receives'), { target: { value: 'USDT' } });
    expect(screen.getByRole('option', { name: 'Tron' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Base' })).not.toBeInTheDocument();
  });
  it('shows retry on lookup failure and never advances', async () => {
    const { client, next } = setup();
    vi.mocked(client.getCrossChainRoutes).mockRejectedValue(new Error('offline'));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Continue to amount' })).toBeDisabled();
    vi.mocked(client.getCrossChainRoutes).mockResolvedValue([route('base')]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await choose();
    expect(next).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue to amount' })).toBeEnabled();
  });
});

describe('selected destination quote binding', () => {
  const destination: StablecoinDestination = { rawInput: details.address, details, asset: 'USDC', chain: 'base' };
  const quote = (overrides = {}) => ({ paymentMethod: { type: 'crossChainAddress', route: route('base'), recipientAddress: details.address, expiresAt: '2099-01-01T00:00:00Z', ...overrides } }) as PrepareSendPaymentResponse;
  it('accepts only the selected recipient, asset and chain', () => {
    expect(quoteMatchesDestination(quote(), destination)).toBe(true);
    expect(quoteMatchesDestination(quote({ recipientAddress: 'another' }), destination)).toBe(false);
    expect(quoteMatchesDestination(quote({ route: route('ethereum') }), destination)).toBe(false);
    expect(quoteMatchesDestination(quote({ route: route('base', 'USDT') }), destination)).toBe(false);
  });
  it('refuses expired or malformed quote expiry', () => {
    expect(quoteIsCurrent(quote())).toBe(true);
    expect(quoteIsCurrent(quote({ expiresAt: '2000-01-01T00:00:00Z' }))).toBe(false);
    expect(quoteIsCurrent(quote({ expiresAt: 'invalid' }))).toBe(false);
  });
  it('preserves chain and token constraints carried by a payment URI', () => {
    const parsed = { ...details, chainId: 8453, contractAddress: '0xAbCd' };
    const matching = { ...route('base'), chainId: '8453', contractAddress: '0xabcd' };
    expect(routeMatchesAddress(matching, parsed)).toBe(true);
    expect(routeMatchesAddress({ ...matching, chainId: '1' }, parsed)).toBe(false);
    expect(routeMatchesAddress({ ...matching, contractAddress: '0xother' }, parsed)).toBe(false);
    expect(routeMatchesAddress({ ...matching, chainId: undefined }, parsed)).toBe(false);
  });
});
