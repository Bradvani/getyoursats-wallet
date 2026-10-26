import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { InputType, PrepareSendPaymentResponse } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { useSendPayment } from './useSendPayment';

const BOLT11 = 'lnbc100n1test';

/** Stands in for the SDK parser, which strips a `lightning:` prefix and reports
 *  the bare invoice in the details it returns. */
const bolt11Details = (input: string) =>
  ({
    type: 'bolt11Invoice',
    invoice: { bolt11: input.replace(/^lightning:/i, '') },
    amountMsat: 10000,
  }) as unknown as InputType;

function renderSendPayment(parse: (input: string) => Promise<InputType>) {
  const client = createMockClient({ parse: vi.fn().mockImplementation(parse) } as never);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WalletProvider client={client} isConnected>
      <FiatDataProvider>
        <StableBalanceProvider>{children}</StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
  return { client, ...renderHook(() => useSendPayment(), { wrapper }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}

describe('processInput destinations', () => {
  it('prepares a scanned `lightning:` invoice with the bare bolt11 (breez/glow-app#168)', async () => {
    const { client, result } = renderSendPayment(async (input) => bolt11Details(input));

    await act(() => result.current.processInput(`lightning:${BOLT11}`));

    await waitFor(() =>
      expect(client.prepareSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRequest: { type: 'input', input: BOLT11 } }),
      ),
    );
    // The field still shows what was scanned, so back-navigation is not surprising.
    expect(result.current.paymentInput?.rawInput).toBe(`lightning:${BOLT11}`);
  });

  it('prepares a BIP21 URI with the address it wraps', async () => {
    const address = 'bc1qtest';
    const { client, result } = renderSendPayment(
      async (uri) =>
        ({
          type: 'bip21',
          uri,
          amountSat: 1000,
          paymentMethods: [{ type: 'bitcoinAddress', address }],
        }) as unknown as InputType,
    );

    await act(() => result.current.processInput(`bitcoin:${address}?amount=0.00001`));

    await waitFor(() =>
      expect(client.prepareSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRequest: { type: 'input', input: address } }),
      ),
    );
  });

  it('refuses an address from another network before preparing (#450)', async () => {
    const { client, result } = renderSendPayment(
      async (address) => ({ type: 'bitcoinAddress', address, network: 'testnet3' }) as unknown as InputType,
    );

    await act(() => result.current.processInput('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'));

    expect(result.current.error).toBe('That is a testnet address. Enter a mainnet Bitcoin address.');
    expect(result.current.currentStep).toBe('input');
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['Invalid input: Lnurl error: lnurl contains invalid k1 parameter', 'This login code is not valid. Refresh the site for a new one.'],
    ['Invalid input: Lnurl error: lnurl contains unsupported action', 'This login code is not valid. Refresh the site for a new one.'],
    ['Invalid input: invalid input', 'Invalid payment destination'],
  ])('names a broken login code apart from other bad input (%s)', async (sdkError, shown) => {
    const { result } = renderSendPayment(() => Promise.reject(new Error(sdkError)));

    await act(() => result.current.processInput('lnurl1bad'));

    expect(result.current.error).toBe(shown);
  });

  it('prepares an invoice with a sub-sat amount rounded up, as the SDK requires', async () => {
    const { client, result } = renderSendPayment(
      async (input) => ({ ...(bolt11Details(input) as object), amountMsat: 654_321 }) as InputType,
    );

    await act(() => result.current.processInput(BOLT11));

    await waitFor(() =>
      expect(client.prepareSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRequest: { type: 'input', input: BOLT11 }, amount: 655n }),
      ),
    );
  });

  const onchain = { type: 'bitcoinAddress', address: 'bc1qtest' };
  const spark = { type: 'sparkAddress', address: 'spark1test' };

  it.each([
    { rail: 'Lightning', methods: [onchain, spark, bolt11Details(BOLT11)], paid: BOLT11 },
    { rail: 'on-chain', methods: [spark, onchain], paid: 'bc1qtest' },
  ])('pays a unified BIP21 over $rail whatever order the parser lists it in', async ({ methods, paid }) => {
    const { client, result } = renderSendPayment(
      async (uri) => ({ type: 'bip21', uri, amountSat: 1000, paymentMethods: methods }) as unknown as InputType,
    );

    await act(() => result.current.processInput('bitcoin:bc1qtest?amount=0.00001'));

    await waitFor(() =>
      expect(client.prepareSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRequest: { type: 'input', input: paid } }),
      ),
    );
  });
});

describe('input request isolation', () => {
  const nextAddress = 'bc1qnext';
  const parsedNext = {type: 'bitcoinAddress', address: nextAddress, network: 'bitcoin'} as InputType;

  it.each(['resolve', 'reject'] as const)('ignores an older parse %s while the scanned input is pending', async outcome => {
    const older = deferred<InputType>();
    const current = deferred<InputType>();
    const {client, result} = renderSendPayment(input => input === BOLT11 ? older.promise : current.promise);
    let olderRun!: Promise<void>;
    let currentRun!: Promise<void>;
    act(() => {olderRun = result.current.processInput(BOLT11);});
    act(() => {
      result.current.reset();
      currentRun = result.current.processInput(nextAddress, {requireReview: true});
    });
    await act(async () => {
      if (outcome === 'resolve') older.resolve(bolt11Details(BOLT11));
      else older.reject(new Error('Older lookup failed'));
      await olderRun;
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.paymentInput).toBeNull();
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
    await act(async () => {current.resolve(parsedNext); await currentRun;});
    expect(result.current.paymentInput?.rawInput).toBe(nextAddress);
    expect(result.current.currentStep).toBe('amount');
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps the newer destination when an older parse resolves after it', async () => {
    const older = deferred<InputType>();
    const {client, result} = renderSendPayment(input => input === BOLT11 ? older.promise : Promise.resolve(parsedNext));
    let olderRun!: Promise<void>;
    act(() => {olderRun = result.current.processInput(BOLT11);});
    await act(() => result.current.processInput(nextAddress, {requireReview: true}));
    await act(async () => {older.resolve(bolt11Details(BOLT11)); await olderRun;});
    expect(result.current.paymentInput?.rawInput).toBe(nextAddress);
    expect(result.current.currentStep).toBe('amount');
    expect(result.current.prepareResponse).toBeNull();
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores a previous preparation %s after a new recipient starts', async outcome => {
    const preparation = deferred<PrepareSendPaymentResponse>();
    const current = deferred<InputType>();
    const {client, result} = renderSendPayment(input => input === BOLT11 ? Promise.resolve(bolt11Details(input)) : current.promise);
    vi.mocked(client.prepareSendPayment).mockReturnValueOnce(preparation.promise);
    let olderRun!: Promise<void>;
    let currentRun!: Promise<void>;
    act(() => {olderRun = result.current.processInput(BOLT11);});
    await waitFor(() => expect(client.prepareSendPayment).toHaveBeenCalledOnce());
    act(() => {
      result.current.reset();
      currentRun = result.current.processInput(nextAddress, {requireReview: true});
    });
    await act(async () => {
      if (outcome === 'resolve') preparation.resolve({amount: 10n} as PrepareSendPaymentResponse);
      else preparation.reject(new Error('Older preparation failed'));
      await olderRun;
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.prepareResponse).toBeNull();
    await act(async () => {current.resolve(parsedNext); await currentRun;});
    expect(result.current.paymentInput?.rawInput).toBe(nextAddress);
    expect(result.current.currentStep).toBe('amount');
    expect(client.sendPayment).not.toHaveBeenCalled();
  });

  it('does not resume a pending parse after its wallet view unmounts', async () => {
    const parsing = deferred<InputType>();
    const {client, result, unmount} = renderSendPayment(() => parsing.promise);
    let operation!: Promise<void>;
    act(() => {operation = result.current.processInput(BOLT11);});
    unmount();
    await act(async () => {parsing.resolve(bolt11Details(BOLT11)); await operation;});
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });

  it('never cancels or unlocks an authorized payment through input reset', async () => {
    const payment = deferred<void>();
    const runner = vi.fn(() => payment.promise);
    const {client, result} = renderSendPayment(async () => parsedNext);
    let operation!: Promise<void>;
    act(() => {operation = result.current.handleRun(runner);});
    await act(async () => {
      result.current.reset();
      result.current.cancelPendingInput();
      await result.current.processInput(nextAddress);
      await result.current.handleRun(runner);
    });
    expect(runner).toHaveBeenCalledOnce();
    expect(client.parse).not.toHaveBeenCalled();
    expect(result.current.currentStep).toBe('processing');
    expect(result.current.isLoading).toBe(true);
    await act(async () => {payment.resolve(); await operation;});
    expect(result.current.currentStep).toBe('result');
    expect(result.current.paymentResult).toBe('unknown');
  });
});
