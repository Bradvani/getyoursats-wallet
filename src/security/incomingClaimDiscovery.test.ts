import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ListPaymentsRequest, Payment} from '@breeztech/breez-sdk-spark';
import {createIncomingClaimController, type IncomingSdk} from './incomingClaimController';
import {INCOMING_CLAIM_PREFIX, readIncomingClaims, saveIncomingClaim} from './incomingClaimJournal';
import {operationWalletKey} from './operationJournal';
import {assertNoUnresolvedRecovery} from './signedRecoveryJournal';
import {clearSignerIdentity, getSpendingRequest, lockSpendingSession, rememberSignerIdentity} from './spendApproval';

const identity = '02' + '11'.repeat(32);
let walletKey: string;

function receipt(index: number, overrides: Partial<Payment> = {}): Payment {
  return {
    id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    timestamp: 1_700_000_000 + index,
    paymentType: index % 2 ? 'send' : 'receive',
    method: index % 3 ? 'lightning' : 'spark',
    status: 'completed', amount: 500n, fees: 0n,
    ...overrides,
  };
}

function pending(index: number): Payment {
  return receipt(index, {paymentType: 'receive', method: 'spark', status: 'pending'});
}

function page(records: Payment[], request: ListPaymentsRequest): {payments: Payment[]} {
  const direction = request.sortAscending ? 1 : -1;
  return {payments: records
    .filter(p => request.toTimestamp === undefined || p.timestamp <= request.toTimestamp)
    .sort((a, b) => direction * (a.timestamp - b.timestamp || a.id.localeCompare(b.id)))
    .slice(request.offset ?? 0, (request.offset ?? 0) + (request.limit ?? 100))};
}

function harness(records: Payment[]) {
  const raw = {
    observeIncomingTransfer: vi.fn().mockResolvedValue({
      paymentId: '', identityPubkey: identity, network: 'regtest',
      observedAt: Math.floor(Date.now() / 1000), completed: false,
    }),
    claimIncomingTransfer: vi.fn(),
    observeWalletState: vi.fn().mockResolvedValue(undefined),
    listPayments: vi.fn(async (request: ListPaymentsRequest) => page(records, request)),
  };
  const assertConnection = vi.fn();
  const controller = createIncomingClaimController({
    network: 'regtest', raw: () => raw as unknown as IncomingSdk,
    walletKey: async () => walletKey, assertConnection,
  });
  return {raw, assertConnection, controller};
}

function uncertain(payment: Payment) {
  const submitted = saveIncomingClaim({
    version: 1, walletKey, paymentId: payment.id, network: 'regtest',
    amountSats: payment.amount.toString(), expiresAt: 100, state: 'submitting', revision: 0,
  });
  const record = saveIncomingClaim({...submitted, state: 'uncertain', revision: 1}, submitted);
  const storageKey = INCOMING_CLAIM_PREFIX + walletKey + ':' + payment.id;
  return {record, storageKey, bytes: localStorage.getItem(storageKey)};
}

beforeEach(async () => {
  localStorage.clear();
  const held = new Set<string>();
  Object.defineProperty(navigator, 'locks', {configurable: true, value: {
    request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({name}); } finally { held.delete(name); }
    },
  }});
  await rememberSignerIdentity({type: 'mnemonic', mnemonic: 'disposable-discovery-identity'});
  walletKey = await operationWalletKey('regtest', identity);
});

afterEach(() => { clearSignerIdentity(); vi.restoreAllMocks(); });

describe('bounded incoming-payment discovery', () => {
  it('finds older unattempted direct receipts across 275 mixed payments without claiming', async () => {
    const records = Array.from({length: 275}, (_, index) => receipt(index));
    for (const index of [0, 150, 274]) records[index] = pending(index);
    records[107] = pending(107);
    records[110] = receipt(110, {paymentType: 'receive', method: 'lightning', status: 'pending'});
    records[130] = {...pending(130), fees: 1n};
    const saved = uncertain(records[107]);
    const h = harness(records);

    const candidates = await h.controller.discover();

    expect(candidates.map(p => p.id)).toEqual([records[274].id, records[150].id, records[0].id]);
    expect(h.raw.listPayments.mock.calls.map(([request]) => request.offset)).toEqual([0, 100, 200]);
    const boundary = h.raw.listPayments.mock.calls[0][0].toTimestamp;
    expect(Number.isSafeInteger(boundary)).toBe(true);
    expect(h.raw.listPayments.mock.calls.every(([request]) => request.toTimestamp === boundary && request.sortAscending)).toBe(true);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(localStorage.getItem(saved.storageKey)).toBe(saved.bytes);
    expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
    expect(getSpendingRequest()).toBeNull();
  });

  it('filters the latest version of an overlapping receipt after the complete scan', async () => {
    const records = Array.from({length: 150}, (_, index) => receipt(index));
    records[0] = pending(0);
    records[99] = pending(99);
    records[149] = pending(149);
    const h = harness(records);
    h.raw.listPayments
      .mockResolvedValueOnce({payments: records.slice(0, 100)})
      .mockResolvedValueOnce({payments: [{...records[99], status: 'completed'}, ...records.slice(100)]});

    expect((await h.controller.discover()).map(p => p.id)).toEqual([records[149].id, records[0].id]);
    expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
  });

  it('rejects a failed later page and preserves unresolved attempts instead of returning partial candidates', async () => {
    const records = Array.from({length: 250}, (_, index) => pending(index));
    const saved = uncertain(records[200]);
    const h = harness(records);
    h.raw.listPayments.mockImplementation(async request => {
      if (request.offset === 100) throw new Error('later page unavailable');
      return page(records, request);
    });

    await expect(h.controller.discover()).rejects.toThrow('later page unavailable');
    expect(h.raw.listPayments).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(saved.storageKey)).toBe(saved.bytes);
    expect(() => assertNoUnresolvedRecovery(walletKey)).toThrow(/incoming payment/);
    expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
  });

  it.each([0, 100])('stops before another page when the wallet locks during offset %s', async offset => {
    const records = Array.from({length: 275}, (_, index) => pending(index));
    const saved = uncertain(records[250]);
    const h = harness(records);
    h.raw.listPayments.mockImplementation(async request => {
      if (request.offset === offset) lockSpendingSession();
      return page(records, request);
    });

    await expect(h.controller.discover()).rejects.toThrow(/session|locked/i);
    expect(h.raw.listPayments).toHaveBeenCalledTimes(offset / 100 + 1);
    expect(localStorage.getItem(saved.storageKey)).toBe(saved.bytes);
    expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
  });

  it('cancels discovery after wallet replacement even when the replacement session is unlocked', async () => {
    const records = Array.from({length: 250}, (_, index) => pending(index));
    const h = harness(records);
    h.raw.listPayments.mockImplementation(async request => {
      await rememberSignerIdentity({type: 'mnemonic', mnemonic: 'replacement-discovery-identity'});
      return page(records, request);
    });

    await expect(h.controller.discover()).rejects.toThrow(/session/i);
    expect(h.raw.listPayments).toHaveBeenCalledTimes(1);
    expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
  });

  it('stops after a later page invalidates the SDK connection', async () => {
    const records = Array.from({length: 275}, (_, index) => pending(index));
    const h = harness(records);
    let connected = true;
    h.assertConnection.mockImplementation(() => { if (!connected) throw new Error('Wallet connection replaced'); });
    h.raw.listPayments.mockImplementation(async request => {
      if (request.offset === 100) connected = false;
      return page(records, request);
    });

    await expect(h.controller.discover()).rejects.toThrow('Wallet connection replaced');
    expect(h.raw.listPayments).toHaveBeenCalledTimes(2);
    expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
  });

  it('keeps a missing attempted receipt uncertain even when the complete history is empty', async () => {
    const saved = uncertain(pending(0));
    const h = harness([]);

    expect(await h.controller.discover()).toEqual([]);
    expect(readIncomingClaims(walletKey)).toEqual([saved.record]);
    expect(localStorage.getItem(saved.storageKey)).toBe(saved.bytes);
    expect(() => assertNoUnresolvedRecovery(walletKey)).toThrow(/incoming payment/);
    expect(h.raw.claimIncomingTransfer).not.toHaveBeenCalled();
  });
});
