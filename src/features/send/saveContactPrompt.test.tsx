import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk, InputType } from '@breeztech/breez-sdk-spark';
import { WalletProvider, WalletInfoProvider, WalletStatusProvider } from '@/contexts/WalletContext';
import { ContactsProvider } from '@/contexts/ContactsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import SendPaymentDialog from './SendPaymentDialog';

const ADDRESS = 'alice@example.com';
const LNURL = 'lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7';

function payRequest(address?: string) {
  return {
    callback: 'https://example.com/lnurl',
    minSendable: 1000,
    maxSendable: 100_000_000,
    metadataStr: '[["text/plain","pay alice"]]',
    commentAllowed: 0,
    domain: 'example.com',
    url: 'https://example.com/lnurl',
    address,
  };
}

/** Renders the sheet with `parse` pinned to one destination shape. */
async function renderSend(parsed: unknown, contacts: unknown[] = []) {
  const client = createMockClient() as unknown as BreezSdk;
  client.parse = vi.fn().mockResolvedValue(parsed as InputType);
  client.listContacts = vi.fn().mockResolvedValue(contacts);
  const onSuccessfulSend = vi.fn();

  render(
    <ToastProvider>
      <WalletProvider client={client} isConnected>
        <WalletInfoProvider walletInfo={{ balanceSats: 500_000 } as never}>
          <WalletStatusProvider hasPendingConversion={false}>
            <FiatDataProvider>
              <StableBalanceProvider>
                <ContactsProvider>
                  <SendPaymentDialog isOpen onClose={vi.fn()} onSuccessfulSend={onSuccessfulSend} />
                </ContactsProvider>
              </StableBalanceProvider>
            </FiatDataProvider>
          </WalletStatusProvider>
        </WalletInfoProvider>
      </WalletProvider>
    </ToastProvider>,
  );

  await waitForSheetOpen();
  return { onSuccessfulSend, client };
}

/** Drives input -> amount -> confirm -> pay -> Done, the close that prompts. */
async function payAndClose(input: string) {
  fireEvent.change(await screen.findByTestId('payment-input'), { target: { value: input } });
  fireEvent.click(screen.getByTestId('continue-button'));

  fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '1000' } });
  fireEvent.click(screen.getByText('Continue'));

  fireEvent.click(await screen.findByTestId('send-confirm-button'));
  await waitFor(() => expect(screen.getByTestId('payment-success')).toBeTruthy());

  fireEvent.click(screen.getByText('Done'));
}

// The prompt keys on what the destination resolved to, so an LNURL naming an
// address offers the save that the same address typed by hand does (#366).
describe('save-as-contact prompt after a send', () => {
  it('offers to save a lightning address', async () => {
    const { onSuccessfulSend } = await renderSend({
      type: 'lightningAddress',
      address: ADDRESS,
      payRequest: payRequest(ADDRESS),
    });

    await payAndClose(ADDRESS);
    expect(onSuccessfulSend).toHaveBeenCalledWith(ADDRESS);
  });

  it('offers to save an LNURL that resolves to a lightning address', async () => {
    const { onSuccessfulSend } = await renderSend({ type: 'lnurlPay', ...payRequest(ADDRESS) });

    await payAndClose(LNURL);
    expect(onSuccessfulSend).toHaveBeenCalledWith(ADDRESS);
  });

  it('saves the resolved address, not the raw input', async () => {
    const { onSuccessfulSend } = await renderSend({
      type: 'lightningAddress',
      address: ADDRESS,
      payRequest: payRequest(ADDRESS),
    });

    // A `lightning:` URI resolves to the same recipient; the scheme prefix
    // must not reach contacts, which are keyed on the bare address.
    await payAndClose(`lightning:${ADDRESS}`);
    expect(onSuccessfulSend).toHaveBeenCalledWith(ADDRESS);
  });

  it('stays quiet when the address is already a contact', async () => {
    const { onSuccessfulSend } = await renderSend(
      { type: 'lnurlPay', ...payRequest(ADDRESS) },
      [{ id: 'c1', name: 'Alice', paymentIdentifier: ADDRESS.toUpperCase() }],
    );

    await payAndClose(LNURL);
    expect(onSuccessfulSend).not.toHaveBeenCalled();
  });

  // A scanned QR yields a bech32 blob with no `address`, which is the case
  // QA hit: the confirm step showed the bare domain and nothing was offered.
  it('offers to save a scanned LNURL whose address is only in metadata', async () => {
    const { onSuccessfulSend } = await renderSend({
      type: 'lnurlPay',
      ...payRequest(undefined),
      metadataStr: '[["text/plain","Tips"],["text/identifier","alice@example.com"]]',
    });

    await payAndClose(LNURL);
    expect(onSuccessfulSend).toHaveBeenCalledWith(ADDRESS);
  });

  it('shows the resolved address on the confirm step, not the domain', async () => {
    await renderSend({
      type: 'lnurlPay',
      ...payRequest(undefined),
      metadataStr: '[["text/identifier","alice@example.com"]]',
    });

    fireEvent.change(await screen.findByTestId('payment-input'), { target: { value: LNURL } });
    fireEvent.click(screen.getByTestId('continue-button'));
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Continue'));

    const destination = await screen.findByTestId('send-destination');
    expect(destination.textContent).toBe(ADDRESS);
  });

  it('falls back to the domain when the LNURL is not an address', async () => {
    await renderSend({ type: 'lnurlPay', ...payRequest(undefined) });

    fireEvent.change(await screen.findByTestId('payment-input'), { target: { value: LNURL } });
    fireEvent.click(screen.getByTestId('continue-button'));
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Continue'));

    const destination = await screen.findByTestId('send-destination');
    expect(destination.textContent).toBe('example.com');
  });

  it('names the recipient on the amount step of a scanned LNURL', async () => {
    await renderSend({
      type: 'lnurlPay',
      ...payRequest(undefined),
      metadataStr: '[["text/plain","Tips"],["text/identifier","alice@example.com"]]',
    });

    fireEvent.change(await screen.findByTestId('payment-input'), { target: { value: LNURL } });
    fireEvent.click(screen.getByTestId('continue-button'));

    expect(await screen.findByText(ADDRESS)).toBeTruthy();
  });

  it('names an existing contact when a scanned LNURL resolves to one', async () => {
    await renderSend(
      {
        type: 'lnurlPay',
        ...payRequest(undefined),
        metadataStr: '[["text/identifier","alice@example.com"]]',
      },
      [{ id: 'c1', name: 'Alice', paymentIdentifier: ADDRESS }],
    );

    fireEvent.change(await screen.findByTestId('payment-input'), { target: { value: LNURL } });
    fireEvent.click(screen.getByTestId('continue-button'));

    expect(await screen.findByText('Alice')).toBeTruthy();
  });

  it('stays quiet for a bare LNURL that resolves to no address', async () => {
    const { onSuccessfulSend } = await renderSend({ type: 'lnurlPay', ...payRequest(undefined) });

    await payAndClose(LNURL);
    expect(onSuccessfulSend).not.toHaveBeenCalled();
  });
});


it('keeps one transfer screen from actual SDK invocation through a verified result',async()=>{
 const {client}=await renderSend({type:'lightningAddress',address:ADDRESS,payRequest:payRequest(ADDRESS)});
 let finish!:(value:Awaited<ReturnType<BreezSdk['lnurlPay']>>)=>void;
 client.lnurlPay=vi.fn(()=>new Promise<Awaited<ReturnType<BreezSdk['lnurlPay']>>>(resolve=>{finish=resolve}));
 fireEvent.change(await screen.findByTestId('payment-input'),{target:{value:ADDRESS}});
 fireEvent.click(screen.getByTestId('continue-button'));
 fireEvent.change(await screen.findByLabelText('Amount'),{target:{value:'1000'}});
 fireEvent.click(screen.getByText('Continue'));
 fireEvent.click(await screen.findByTestId('send-confirm-button'));
 const view=await screen.findByTestId('transfer-experience');
 await waitFor(()=>expect(view).toHaveAttribute('data-phase','processing'));
 await waitFor(()=>expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50'));
 expect(client.lnurlPay).toHaveBeenCalledOnce();
 finish({payment:{id:'sequence-real-hook-fixture',status:'completed',paymentType:'send',method:'lightning',amount:1000n,fees:1n,timestamp:1700000000}} as Awaited<ReturnType<BreezSdk['lnurlPay']>>);
 await waitFor(()=>expect(view).toHaveAttribute('data-phase','confirmed'));
 expect(screen.getByTestId('transfer-experience')).toBe(view);
 expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
 expect(client.lnurlPay).toHaveBeenCalledOnce();
 expect(await screen.findByTestId('payment-fiat-amount')).toHaveTextContent('≈ $1.00 USD');
});
