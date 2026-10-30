import {webcrypto} from 'node:crypto';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {BreezSdk, InputType, Seed, SignInResponse} from '@breeztech/breez-sdk-spark';
import {WalletProvider, WalletInfoProvider, WalletStatusProvider} from '@/contexts/WalletContext';
import {ContactsProvider} from '@/contexts/ContactsContext';
import {ToastProvider} from '@/contexts/ToastContext';
import {FiatDataProvider} from '@/contexts/FiatDataContext';
import {StableBalanceProvider} from '@/contexts/StableBalanceContext';
import {createMockClient} from '@/test/mocks/mockWalletApi';
import {withPasskeySendAuthorization} from '@/services/sendAuthorization';
import {buildBrowserPasskeyClient} from '@/services/passkeyService';
import SendPaymentDialog from './SendPaymentDialog';

vi.mock('@/services/passkeyService', () => ({buildBrowserPasskeyClient: vi.fn(), getPasskey: vi.fn()}));
vi.mock('@/utils/keyboard', () => ({dismissKeyboard: vi.fn().mockResolvedValue(undefined)}));

const seed: Seed = {type: 'mnemonic', mnemonic: 'disposable send authorization UI fixture'};
const address = 'alice@example.invalid';
const parsed = {
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

const signIn = vi.fn();
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  signIn.mockReset();
  vi.mocked(buildBrowserPasskeyClient).mockImplementation(() => ({signIn, free: vi.fn()}) as never);
});
afterEach(() => vi.unstubAllGlobals());

function show(client: BreezSdk) {
  const onClose = vi.fn();
  const view = render(<ToastProvider><WalletProvider client={client} isConnected>
    <WalletInfoProvider walletInfo={{balanceSats: 500000} as never}><WalletStatusProvider hasPendingConversion={false}>
      <FiatDataProvider><StableBalanceProvider><ContactsProvider>
        <SendPaymentDialog isOpen onClose={onClose} initialRawInput={address} initialInputId={1}/>
      </ContactsProvider></StableBalanceProvider></FiatDataProvider>
    </WalletStatusProvider></WalletInfoProvider>
  </WalletProvider></ToastProvider>);
  return {...view, onClose};
}

async function ready() {
  const raw = createMockClient({parse: vi.fn().mockResolvedValue(parsed)});
  const client = await withPasskeySendAuthorization(raw, {seed, label: 'Primary', rpId: 'wallet.getyoursats.com'});
  const view = show(client);
  fireEvent.change(await screen.findByLabelText('Amount'), {target: {value: '1000'}});
  fireEvent.click(screen.getByText('Continue', {selector: 'button'}));
  const confirm = await screen.findByTestId('send-confirm-button');
  expect(confirm).toBeEnabled();
  return {raw, client, view, confirm};
}

describe('confirm-send passkey experience', () => {
  it('preserves the LNURL quote after cancellation and begins the transfer only after fresh authentication', async () => {
    const first = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(first.promise);
    const {raw, confirm} = await ready();
    fireEvent.click(confirm);
    expect(await screen.findByTestId('send-authorizing')).toBeInTheDocument();
    expect(screen.queryByTestId('transfer-experience')).not.toBeInTheDocument();
    expect(raw.lnurlPay).not.toHaveBeenCalled();

    await act(async () => first.reject(new DOMException('Dismissed', 'NotAllowedError')));
    expect(await screen.findByTestId('send-authorization-error')).toHaveTextContent('Payment not sent');
    expect(screen.getByTestId('send-confirm-button')).toBe(confirm);
    expect(raw.prepareLnurlPay).toHaveBeenCalledOnce();
    expect(raw.lnurlPay).not.toHaveBeenCalled();
    expect(screen.queryByTestId('payment-unknown')).not.toBeInTheDocument();

    const second = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(second.promise);
    fireEvent.click(confirm);
    expect(await screen.findByTestId('send-authorizing')).toBeInTheDocument();
    await act(async () => second.resolve({wallet: {seed, label: 'Primary'}, labels: []}));
    await waitFor(() => expect(raw.lnurlPay).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('transfer-experience')).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it.each(['Close', 'Back'])('never sends after %s while a passkey response is pending', async action => {
    const prompt = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(prompt.promise);
    const {raw, confirm, view} = await ready();
    fireEvent.click(confirm);
    await screen.findByTestId('send-authorizing');
    fireEvent.click(screen.getByLabelText(action));
    if (action === 'Close') expect(view.onClose).toHaveBeenCalledOnce();
    else expect(view.onClose).not.toHaveBeenCalled();
    await act(async () => prompt.resolve({wallet: {seed, label: 'Primary'}, labels: []}));
    expect(raw.lnurlPay).not.toHaveBeenCalled();
  });
});
