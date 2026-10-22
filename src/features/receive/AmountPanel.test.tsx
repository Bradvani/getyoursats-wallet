import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { saveDenomination } from '../../getyoursats/denomination';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import AmountPanel from './AmountPanel';

async function renderAmountPanel(client?: BreezSdk) {
  const setAmountSats = vi.fn();
  const mockClient = client ?? createMockClient();
  render(<WalletProvider client={mockClient} isConnected>
    <FiatDataProvider><StableBalanceProvider>
      <AmountPanel isOpen amountSats={null} setAmountSats={setAmountSats}
        setAmountDisplay={vi.fn()} description="" setDescription={vi.fn()}
        isLoading={false} error={null} onCreateInvoice={vi.fn()}
        onClose={vi.fn()} resetCount={0}/>
    </StableBalanceProvider></FiatDataProvider>
  </WalletProvider>);
  await waitForSheetOpen();
  return {setAmountSats, client:mockClient};
}
describe('GetYourSats receive amount denomination',()=>{
  beforeEach(()=>saveDenomination('sats'));
  afterEach(()=>saveDenomination('sats'));
  it('starts in exact sats and sends integer sats to the invoice request',async()=>{
    const {setAmountSats}=await renderAmountPanel();
    fireEvent.change(screen.getByTestId('invoice-amount-input'),{target:{value:'5000'}});
    await waitFor(()=>expect(setAmountSats).toHaveBeenCalledWith(5000n));
  });
  it('converts BTC input to exact sats',async()=>{
    const {setAmountSats}=await renderAmountPanel();
    fireEvent.click(screen.getByRole('button',{name:'BTC'}));
    fireEvent.change(screen.getByTestId('invoice-amount-input'),{target:{value:'0.00005'}});
    await waitFor(()=>expect(setAmountSats).toHaveBeenCalledWith(5000n));
  });
  it('converts INR at a real SDK-provided BTC/INR quote',async()=>{
    const client=createMockClient({listFiatRates:vi.fn().mockResolvedValue({
      rates:[{coin:'INR',value:5_000_000},{coin:'USD',value:100_000}]
    })} as unknown as Partial<BreezSdk>);
    const {setAmountSats}=await renderAmountPanel(client);
    const inr=screen.getByRole('button',{name:'INR'});
    await waitFor(()=>expect(inr).not.toBeDisabled());
    fireEvent.click(inr);
    fireEvent.change(screen.getByTestId('invoice-amount-input'),{target:{value:'50'}});
    await waitFor(()=>expect(setAmountSats).toHaveBeenCalledWith(1000n));
  });
  it('disables INR entry if the provider has no quote',async()=>{
    const client=createMockClient({listFiatRates:vi.fn().mockResolvedValue({rates:[]})} as unknown as Partial<BreezSdk>);
    await renderAmountPanel(client);
    await waitFor(()=>expect(client.listFiatRates).toHaveBeenCalled());
    expect(screen.getByRole('button',{name:'INR'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'BTC'})).not.toBeDisabled();
  });
});
