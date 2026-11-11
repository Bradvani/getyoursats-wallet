import {describe, expect, it, vi} from 'vitest';
import type {GetInfoResponse, ObserveDepositClaimResponse, Payment} from '@breeztech/breez-sdk-spark';
import {BtcReceiptObservationError, createBtcReceiptObserver, type BtcReceiptRequest} from './rampnowBtcReceipt';

const identity = '02' + 'a'.repeat(64);
const otherIdentity = '03' + 'b'.repeat(64);
const txid = '1'.repeat(64);
const time = 1_800_000_000_100;
function request() {
  return {outputs: [{txid, vout: 2, amountSats: 1000n}], maximumClaimFeeSats: 100n};
}
function payment(): Payment {
  return {id: 'deposit-transfer', paymentType: 'receive', method: 'deposit', status: 'completed',
    amount: 950n, fees: 50n, timestamp: Math.floor(time / 1000), details: {type: 'deposit', txId: txid, vout: 2}};
}
function observation(): ObserveDepositClaimResponse {
  return {txid, vout: 2, identityPubkey: identity, network: 'signet', observedAt: Math.floor(time / 1000),
    completed: true, payment: payment()};
}
function fixture(value = observation()) {
  const info = {identityPubkey: identity, balanceSats: 12345, tokenBalances: new Map(), recoverableFundsSats: 0} satisfies GetInfoResponse;
  const sdk = {getInfo: vi.fn(async () => ({...info})), observeDepositClaim: vi.fn(async () => value)};
  const assertCurrentSession = vi.fn();
  const now = vi.fn(() => time);
  const observer = createBtcReceiptObserver({sdk, network: 'signet', identityPubkey: identity, assertCurrentSession, now});
  return {sdk, assertCurrentSession, now, observer};
}

describe('independent BTC deposit receipt observation', () => {
  it('establishes exact historical net claim credit without asserting purchase delivery or spendability', async () => {
    const {sdk, observer, assertCurrentSession} = fixture();
    const result = await observer.observe(request());
    expect(result).toMatchObject({identityPubkey: identity, network: 'signet', outpoint: request().outputs[0],
      walletClaim: {status: 'settled', paymentId: 'deposit-transfer', netCreditSats: 950n, claimFeeSats: 50n},
      providerCompletion: 'not_checked', purchaseAttribution: 'unverified', onchainOutput: 'not_checked',
      currentSpendability: 'unverified', walletReceiptVerified: false});
    expect(sdk.observeDepositClaim).toHaveBeenCalledExactlyOnceWith({txid, vout: 2});
    expect(sdk.getInfo.mock.calls).toEqual([[{ensureSynced: false}], [{ensureSynced: false}]]);
    expect(assertCurrentSession).toHaveBeenCalledTimes(4);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.walletClaim)).toBe(true);
    expect(Object.isFrozen(result.outpoint)).toBe(true);
  });

  it('separates submitted/pending claim credit from settled credit', async () => {
    const value = observation(); value.completed = false; value.payment!.status = 'pending';
    const {observer} = fixture(value);
    expect((await observer.observe(request())).walletClaim.status).toBe('pending');
  });

  it('missing transfer evidence stays unobserved even with a large wallet balance', async () => {
    const value = observation(); value.completed = false; delete value.payment;
    const {observer, sdk} = fixture(value);
    sdk.getInfo.mockResolvedValue({identityPubkey: identity, balanceSats: 2_000_000, tokenBalances: new Map(), recoverableFundsSats: 0});
    expect(await observer.observe(request())).toMatchObject({walletClaim: {status: 'not_observed', netCreditSats: null},
      currentSpendability: 'unverified', walletReceiptVerified: false});
  });

  it.each([
    ['wrong owner', (v: ObserveDepositClaimResponse) => {v.identityPubkey = otherIdentity;}],
    ['wrong network', (v: ObserveDepositClaimResponse) => {v.network = 'mainnet';}],
    ['wrong transaction', (v: ObserveDepositClaimResponse) => {v.txid = '2'.repeat(64);}],
    ['wrong output', (v: ObserveDepositClaimResponse) => {v.vout++;}],
    ['stale observation', (v: ObserveDepositClaimResponse) => {v.observedAt--;}],
    ['future observation', (v: ObserveDepositClaimResponse) => {v.observedAt += 2;}],
    ['fractional timestamp', (v: ObserveDepositClaimResponse) => {v.observedAt += 0.5;}],
    ['missing completed payment', (v: ObserveDepositClaimResponse) => {delete v.payment;}],
    ['contradictory completion', (v: ObserveDepositClaimResponse) => {v.completed = false;}],
  ])('rejects %s', async (_name, alter) => {
    const value = observation(); alter(value);
    await expect(fixture(value).observer.observe(request())).rejects.toBeInstanceOf(BtcReceiptObservationError);
  });

  it.each([
    ['send', (p: Payment) => {p.paymentType = 'send';}],
    ['non-deposit', (p: Payment) => {p.method = 'spark';}],
    ['pending', (p: Payment) => {p.status = 'pending';}],
    ['failed', (p: Payment) => {p.status = 'failed';}],
    ['missing detail', (p: Payment) => {delete p.details;}],
    ['wrong detail outpoint', (p: Payment) => {p.details = {type: 'deposit', txId: txid, vout: 3};}],
    ['wrong gross amount', (p: Payment) => {p.amount++;}],
    ['negative fees', (p: Payment) => {p.fees = -1n; p.amount = 1001n;}],
    ['fee ceiling exceeded', (p: Payment) => {p.fees = 101n; p.amount = 899n;}],
    ['zero credit', (p: Payment) => {p.amount = 0n; p.fees = 1000n;}],
    ['unsafe runtime amount', (p: Payment) => {Reflect.set(p, 'amount', 950);}],
    ['empty transfer id', (p: Payment) => {p.id = '';}],
  ])('rejects a %s receipt', async (_name, alter) => {
    const value = observation(); alter(value.payment!);
    await expect(fixture(value).observer.observe(request())).rejects.toBeInstanceOf(BtcReceiptObservationError);
  });

  it.each(['before', 'after'])('rejects a wallet identity change %s the SDK observation', async when => {
    const {sdk, observer} = fixture();
    const info = {identityPubkey: otherIdentity, balanceSats: 0, tokenBalances: new Map(), recoverableFundsSats: 0};
    if (when === 'before') sdk.getInfo.mockResolvedValueOnce(info);
    else sdk.getInfo.mockResolvedValueOnce({...info, identityPubkey: identity}).mockResolvedValueOnce(info);
    await expect(observer.observe(request())).rejects.toBeInstanceOf(BtcReceiptObservationError);
    expect(sdk.observeDepositClaim).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
  });

  it.each([1, 2, 3])('rejects a locked/replaced session after await %i', async checks => {
    const {observer, assertCurrentSession} = fixture();
    let count = 0;
    assertCurrentSession.mockImplementation(() => {if (count++ === checks) throw Error('Session changed');});
    await expect(observer.observe(request())).rejects.toBeInstanceOf(BtcReceiptObservationError);
  });

  it.each([time - 1, time + 30_001, NaN])('rejects elapsed/invalid observation window %s', async finish => {
    const {observer, now} = fixture();
    now.mockReturnValueOnce(time).mockReturnValueOnce(finish);
    await expect(observer.observe(request())).rejects.toBeInstanceOf(BtcReceiptObservationError);
  });

  it.each([{outputs: []}, {outputs: [request().outputs[0], request().outputs[0]]}])('rejects absent or multiple payout outputs', async ({outputs}) => {
    const {observer, sdk} = fixture();
    await expect(observer.observe({...request(), outputs})).rejects.toThrow('Only single-output');
    expect(sdk.getInfo).not.toHaveBeenCalled();
  });

  it.each([
    ['noncanonical txid', (r: ReturnType<typeof request>) => {r.outputs[0].txid = 'A'.repeat(64);}],
    ['non-string txid', (r: ReturnType<typeof request>) => {Reflect.set(r.outputs[0], 'txid', {toString: () => txid});}],
    ['negative output index', (r: ReturnType<typeof request>) => {r.outputs[0].vout = -1;}],
    ['fractional output index', (r: ReturnType<typeof request>) => {r.outputs[0].vout = 0.5;}],
    ['oversized output index', (r: ReturnType<typeof request>) => {r.outputs[0].vout = 0x100000000;}],
    ['zero gross value', (r: ReturnType<typeof request>) => {r.outputs[0].amountSats = 0n;}],
    ['excess gross value', (r: ReturnType<typeof request>) => {r.outputs[0].amountSats = 2_100_000_000_000_001n;}],
    ['negative ceiling', (r: ReturnType<typeof request>) => {r.maximumClaimFeeSats = -1n;}],
    ['ceiling consumes deposit', (r: ReturnType<typeof request>) => {r.maximumClaimFeeSats = 1000n;}],
  ])('rejects %s input before an SDK call', async (_name, alter) => {
    const input = request(); alter(input);
    const {observer, sdk} = fixture();
    await expect(observer.observe(input)).rejects.toBeInstanceOf(BtcReceiptObservationError);
    expect(sdk.getInfo).not.toHaveBeenCalled();
  });

  it('accepts zero claim fees and exact bigint satoshi accounting', async () => {
    const value = observation(); value.payment!.amount = 2_100_000_000_000_000n; value.payment!.fees = 0n;
    const input: BtcReceiptRequest = {outputs: [{txid, vout: 2, amountSats: 2_100_000_000_000_000n}], maximumClaimFeeSats: 0n};
    expect((await fixture(value).observer.observe(input)).walletClaim.netCreditSats).toBe(2_100_000_000_000_000n);
  });

  it('copies SDK evidence before the post-observation identity await', async () => {
    const value = observation();
    const {observer, sdk} = fixture(value);
    let reads = 0;
    sdk.getInfo.mockImplementation(async () => {
      if (++reads === 2) {value.payment!.amount = 1n; value.vout = 3;}
      return {identityPubkey: identity, balanceSats: 0, tokenBalances: new Map(), recoverableFundsSats: 0};
    });
    expect((await observer.observe(request())).walletClaim.netCreditSats).toBe(950n);
  });

  it('does not use cached history when the observation extension is unavailable', () => {
    const {sdk, assertCurrentSession} = fixture();
    Reflect.deleteProperty(sdk, 'observeDepositClaim');
    expect(() => createBtcReceiptObserver({sdk, network: 'signet', identityPubkey: identity, assertCurrentSession})).toThrow(BtcReceiptObservationError);
    expect(sdk.getInfo).not.toHaveBeenCalled();
  });

  it('copies the expected outpoint and economics before awaiting the SDK', async () => {
    const {observer, sdk} = fixture();
    const input = request();
    sdk.getInfo.mockImplementationOnce(async () => {
      input.outputs[0].vout = 3; input.outputs[0].amountSats = 1n; input.maximumClaimFeeSats = 0n;
      return {identityPubkey: identity, balanceSats: 0, tokenBalances: new Map(), recoverableFundsSats: 0};
    });
    expect((await observer.observe(input)).walletClaim.status).toBe('settled');
    expect(sdk.observeDepositClaim).toHaveBeenCalledWith({txid, vout: 2});
  });

  it('sanitizes transport failure and allows only another read, never a fallback receipt', async () => {
    const {observer, sdk} = fixture();
    sdk.observeDepositClaim.mockRejectedValueOnce(Error('secret provider diagnostic'));
    await expect(observer.observe(request())).rejects.toThrow('Bitcoin receipt could not be verified');
    expect((await observer.observe(request())).walletClaim.status).toBe('settled');
  });

  it('refuses concurrent observations', async () => {
    const {observer} = fixture();
    const first = observer.observe(request());
    await expect(observer.observe(request())).rejects.toThrow('already in progress');
    await expect(first).resolves.toMatchObject({walletClaim: {status: 'settled'}});
  });
});
