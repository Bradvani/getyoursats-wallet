import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {BreezSdk, InputType} from '@breeztech/breez-sdk-spark';
import {WalletProvider, WalletInfoProvider, WalletStatusProvider} from '@/contexts/WalletContext';
import {ContactsProvider} from '@/contexts/ContactsContext';
import {ToastProvider} from '@/contexts/ToastContext';
import {FiatDataProvider} from '@/contexts/FiatDataContext';
import {StableBalanceProvider} from '@/contexts/StableBalanceContext';
import {createMockClient} from '@/test/mocks/mockWalletApi';
import SendPaymentDialog from './SendPaymentDialog';
import {dismissKeyboard} from '@/utils/keyboard';

vi.mock('@/utils/keyboard', () => ({dismissKeyboard: vi.fn().mockResolvedValue(undefined)}));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

const address = 'alice@example.invalid';
const parsedAddress = {
  type: 'lightningAddress', address,
  payRequest: {callback: 'https://example.invalid/pay', minSendable: 1000, maxSendable: 100000000,
    metadataStr: '[["text/plain","Synthetic recipient"]]', commentAllowed: 0,
    domain: 'example.invalid', url: 'https://example.invalid/pay', address},
} as InputType;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}

function setup(client: BreezSdk, props: Partial<Parameters<typeof SendPaymentDialog>[0]> = {}) {
  const onClose = vi.fn();
  const tree = (next: Partial<Parameters<typeof SendPaymentDialog>[0]>) => (
    <ToastProvider><WalletProvider client={client} isConnected>
      <WalletInfoProvider walletInfo={{balanceSats: 500000} as never}><WalletStatusProvider hasPendingConversion={false}>
        <FiatDataProvider><StableBalanceProvider><ContactsProvider>
          <SendPaymentDialog isOpen onClose={onClose} {...next}/>
        </ContactsProvider></StableBalanceProvider></FiatDataProvider>
      </WalletStatusProvider></WalletInfoProvider>
    </WalletProvider></ToastProvider>
  );
  const view = render(tree(props));
  return {...view, onClose, change: (next: Partial<Parameters<typeof SendPaymentDialog>[0]>) => view.rerender(tree(next))};
}

describe('scan to Send handoff', () => {
  it('holds a resolving surface until amount entry is ready, without mounting the input form', async () => {
    const parse = deferred<InputType>();
    const client = createMockClient({parse: vi.fn().mockReturnValue(parse.promise)});
    setup(client, {initialRawInput: address, initialInputId: 1});
    expect(await screen.findByTestId('send-resolving-input')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-input')).not.toBeInTheDocument();
    const surface = screen.getByTestId('send-flow');
    expect(client.parse).toHaveBeenCalledExactlyOnceWith(address);
    await act(async () => parse.resolve(parsedAddress));
    expect(await screen.findByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByTestId('send-flow')).toBe(surface);
    expect(screen.queryByTestId('payment-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('send-resolving-input')).not.toBeInTheDocument();
    expect(client.prepareLnurlPay).not.toHaveBeenCalled();
    expect(client.lnurlPay).not.toHaveBeenCalled();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });

  it('makes an invalid scan editable with its error instead of dropping back to the wallet', async () => {
    const parse = deferred<InputType>();
    const client = createMockClient({parse: vi.fn().mockReturnValue(parse.promise)});
    const view = setup(client, {initialRawInput: 'not-a-destination', initialInputId: 1});
    await screen.findByTestId('send-resolving-input');
    await act(async () => parse.reject(new Error('Unrecognized input')));
    expect(await screen.findByTestId('payment-input')).toHaveValue('not-a-destination');
    expect(screen.getByTestId('send-error-banner')).toBeInTheDocument();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(client.parse).toHaveBeenCalledOnce();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });

  it('preserves the explicit review gate for an amount-bearing invoice', async () => {
    const invoice = 'lnbc1synthetic';
    const client = createMockClient();
    setup(client, {initialRawInput: invoice, initialInputId: 1});
    expect(await screen.findByTestId('payment-input')).toHaveValue(invoice);
    expect(client.parse).toHaveBeenCalledExactlyOnceWith(invoice);
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
    expect(client.sendPayment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('continue-button'));
    await waitFor(() => expect(client.prepareSendPayment).toHaveBeenCalledOnce());
    expect(client.sendPayment).not.toHaveBeenCalled();
  });

  it('never restores an older recipient when a later rescan fails', async () => {
    const client = createMockClient({parse: vi.fn().mockResolvedValue(parsedAddress)});
    const view = setup(client, {initialRawInput: address, initialInputId: 1});
    await screen.findByLabelText('Amount');
    const surface = screen.getByTestId('send-flow');
    const second = deferred<InputType>();
    vi.mocked(client.parse).mockReturnValueOnce(second.promise);
    view.change({initialRawInput: 'not-a-destination', initialInputId: 2});
    expect(await screen.findByTestId('send-resolving-input')).toBeInTheDocument();
    await act(async () => second.reject(new Error('Unrecognized input')));
    expect(await screen.findByTestId('payment-input')).toHaveValue('not-a-destination');
    expect(screen.getByTestId('send-error-banner')).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-flow')).toBe(surface);
    expect(client.parse).toHaveBeenCalledTimes(2);
    expect(client.prepareLnurlPay).not.toHaveBeenCalled();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });

  it('accepts an intentional rescan of the same code without remounting Send', async () => {
    const client = createMockClient({parse: vi.fn().mockResolvedValue(parsedAddress)});
    const view = setup(client, {initialRawInput: address, initialInputId: 1});
    await screen.findByLabelText('Amount');
    const surface = screen.getByTestId('send-flow');
    const second = deferred<InputType>();
    vi.mocked(client.parse).mockReturnValueOnce(second.promise);
    view.change({initialRawInput: address, initialInputId: 2});
    expect(await screen.findByTestId('send-resolving-input')).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-input')).not.toBeInTheDocument();
    await act(async () => second.resolve(parsedAddress));
    await screen.findByLabelText('Amount');
    expect(screen.getByTestId('send-flow')).toBe(surface);
    expect(client.parse).toHaveBeenCalledTimes(2);
  });

  it('keeps the current destination when the camera is cancelled', async () => {
    const client = createMockClient();
    const view = setup(client);
    const input = await screen.findByTestId('payment-input');
    fireEvent.change(input, {target: {value: address}});
    const surface = screen.getByTestId('send-flow');
    view.change({coveredByScanner: true});
    expect(surface).toHaveAttribute('inert');
    view.change({coveredByScanner: false});
    expect(screen.getByTestId('send-flow')).toBe(surface);
    expect(surface).not.toHaveAttribute('inert');
    expect(screen.getByTestId('payment-input')).toHaveValue(address);
    expect(client.parse).not.toHaveBeenCalled();
  });

  it('ignores a clipboard read that completes after the camera is cancelled', async () => {
    const clipboard = deferred<string>();
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: () => clipboard.promise}});
    const client = createMockClient();
    const onScanQr = vi.fn();
    const view = setup(client, {onScanQr});
    fireEvent.change(await screen.findByTestId('payment-input'), {target: {value: 'previous@example.invalid'}});
    fireEvent.click(await screen.findByRole('button', {name: 'Paste'}));
    fireEvent.click(screen.getByRole('button', {name: 'Scan QR'}));
    view.change({onScanQr, coveredByScanner: true});
    view.change({onScanQr});
    await act(async () => clipboard.resolve('old@example.invalid'));
    expect(screen.getByTestId('payment-input')).toHaveValue('previous@example.invalid');
    expect(client.parse).not.toHaveBeenCalled();
    expect(onScanQr).toHaveBeenCalledOnce();
  });

  it('ignores a clipboard read that completes after the scanned recipient is ready', async () => {
    const clipboard = deferred<string>();
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: () => clipboard.promise}});
    const client = createMockClient({parse: vi.fn().mockResolvedValue(parsedAddress)});
    const onScanQr = vi.fn();
    const view = setup(client, {onScanQr});
    fireEvent.click(await screen.findByRole('button', {name: 'Paste'}));
    fireEvent.click(screen.getByRole('button', {name: 'Scan QR'}));
    view.change({onScanQr, coveredByScanner: true});
    view.change({onScanQr, initialRawInput: address, initialInputId: 1});
    await screen.findByLabelText('Amount');
    await act(async () => clipboard.resolve('old@example.invalid'));
    expect(client.parse).toHaveBeenCalledExactlyOnceWith(address);
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-input')).not.toBeInTheDocument();
    expect(client.prepareLnurlPay).not.toHaveBeenCalled();
  });

  it.each(['Continue', 'Enter'] as const)('ignores a pending %s keyboard dismissal after scanning begins', async action => {
    const keyboard = deferred<void>();
    vi.mocked(dismissKeyboard).mockReturnValueOnce(keyboard.promise);
    const client = createMockClient();
    const onScanQr = vi.fn();
    const view = setup(client, {onScanQr});
    const input = await screen.findByTestId('payment-input');
    const scanButton = await screen.findByRole('button', {name: 'Scan QR'});
    fireEvent.change(input, {target: {value: address}});
    if (action === 'Continue') fireEvent.click(screen.getByTestId('continue-button'));
    else fireEvent.keyDown(input, {key: 'Enter'});
    fireEvent.click(scanButton);
    view.change({onScanQr, coveredByScanner: true});
    view.change({onScanQr});
    await act(async () => keyboard.resolve());
    expect(client.parse).not.toHaveBeenCalled();
    expect(screen.getByTestId('payment-input')).toHaveValue(address);
  });
});
