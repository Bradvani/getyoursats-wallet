import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ListPaymentsRequest, Payment} from '@breeztech/breez-sdk-spark';
import PosPage from './PosPage';
import {savePosOrders, type PosOrder} from './posLedger';
import {BROWSER_SPENDING_POLICY} from '../security/browserReleasePolicy';

const mocks = vi.hoisted(() => ({getInfo: vi.fn(), listPayments: vi.fn(), observe:vi.fn(),onPaid:null as null|(()=>void)}));
vi.mock('../contexts/WalletContext', () => ({useWallet: () => mocks}));
vi.mock('../contexts/FiatDataContext', () => ({useFiatData: () => ({fiatRates: [], fetchedAt: null, refreshFiatData: vi.fn()})}));
vi.mock('../hooks/useInvoicePaid', () => ({useInvoicePaid: (_invoice:string,callback:()=>void) => {mocks.onPaid=callback;}}));
vi.mock('../security/operationGateway',()=>({getOperationReconciliation:()=>({observe:mocks.observe})}));
vi.mock('../hooks/useInvoiceExpiry', () => ({useInvoiceExpiry: () => ({usable: true, expired: false})}));
vi.mock('../components/BrandedQrCode', () => ({default: () => <div>QR</div>}));
vi.mock('../components/PaymentMotion', () => ({default: () => <div>Payment motion</div>}));

const identity = 'a'.repeat(66);
const invoice = 'lnbc10n1' + 'q'.repeat(32);
const order: PosOrder = {id: 'older-order', invoice, amountSats: 1000, unit: 'sats', description: 'Older receipt', createdAt: 1_700_000_000_000, feeSats: 0};
const receive = (index: number): Payment => ({
  id: 'receipt-' + index, paymentType: 'receive', status: 'completed', method: 'lightning', amount: 1000n, fees: 0n,
  timestamp: 1_700_000_001 + index, details: {type: 'lightning', invoice: index === 0 ? invoice : 'lnbc10n1' + index + 'p'.repeat(32)},
}) as Payment;

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.onPaid=null;mocks.observe.mockReset();mocks.observe.mockResolvedValue(undefined);
  Reflect.set(mocks,BROWSER_SPENDING_POLICY,false);
  mocks.getInfo.mockResolvedValue({identityPubkey: identity});
  savePosOrders(identity, [order]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function ledger(records: Payment[], failLaterPage = () => false) {
  mocks.listPayments.mockImplementation(async (request: ListPaymentsRequest) => {
    if (request.offset === 100 && failLaterPage()) throw new Error('SDK temporarily unavailable');
    const sorted = records.filter(p => (!request.typeFilter || request.typeFilter.includes(p.paymentType)) &&
      (!request.statusFilter || request.statusFilter.includes(p.status)))
      .sort((a, b) => request.sortAscending ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
    return {payments: sorted.slice(request.offset ?? 0, (request.offset ?? 0) + request.limit!)};
  });
}

describe('POS receipt reconciliation across pages', () => {
  it('keeps receipt 101 confirmed after polling, a later-page failure and restart', async () => {
    const records = Array.from({length: 101}, (_, i) => receive(i));
    let fail = false;
    ledger(records, () => fail);
    const first = render(<PosPage onClose={vi.fn()}/>);
    await flush();
    fireEvent.click(screen.getByRole('button', {name: 'Payment history'}));
    await flush();
    expect(screen.getByRole('button', {name: /Older receipt.*Confirmed/})).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole('button', {name: /Older receipt.*Confirmed/})).toBeTruthy();
    expect(mocks.listPayments.mock.calls.some(([request]) => request.offset === 100)).toBe(true);
    fail = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole('button', {name: /Older receipt.*Confirmed/})).toBeTruthy();
    first.unmount();
    fail = false;
    render(<PosPage onClose={vi.fn()}/>);
    await flush();
    fireEvent.click(screen.getByRole('button', {name: 'Payment history'}));
    await flush();
    expect(screen.getByRole('button', {name: /Older receipt.*Confirmed/})).toBeTruthy();
  });

  it('reconciles an explicit changed SDK status instead of keeping a sticky paid flag', async () => {
    const records = Array.from({length: 101}, (_, i) => receive(i));
    ledger(records);
    render(<PosPage onClose={vi.fn()}/>);
    await flush();
    fireEvent.click(screen.getByRole('button', {name: 'Payment history'}));
    await flush();
    expect(screen.getByRole('button', {name: /Older receipt.*Confirmed/})).toBeTruthy();
    records[0] = {...records[0], status: 'failed'};
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole('button', {name: /Older receipt.*Awaiting verification/})).toBeTruthy();
    expect(screen.queryByRole('button', {name: /Older receipt.*Confirmed/})).toBeNull();
  });

  it('never treats an edited local paid flag as settlement evidence', async () => {
    localStorage.setItem('gys:merchant:orders:v1:' + identity, JSON.stringify([{...order, paid: true}]));
    ledger([]);
    render(<PosPage onClose={vi.fn()}/>);
    await flush();
    fireEvent.click(screen.getByRole('button', {name: 'Payment history'}));
    await flush();
    expect(screen.getByRole('button', {name: /Older receipt.*Awaiting verification/})).toBeTruthy();
    expect(screen.queryByRole('button', {name: /Older receipt.*Confirmed/})).toBeNull();
  });
});


describe('POS provider and settlement authority',()=>{
 it('does not mark a charge paid merely because an SDK event fired',async()=>{
  ledger([]);
  render(<PosPage onClose={vi.fn()}/>);
  await flush();
  fireEvent.click(screen.getByRole('button',{name:'Payment history'}));
  await flush();
  fireEvent.click(screen.getByRole('button',{name:/Older receipt.*Awaiting verification/}));
  await flush();
  expect(screen.queryByText('Payment received')).toBeNull();
  expect(mocks.onPaid).not.toBeNull();
  await act(async()=>{mocks.onPaid?.();});
  await flush();
  expect(screen.queryByText('Payment received')).toBeNull();
  expect(screen.getByText('Waiting for payment confirmation')).toBeTruthy();
 });
 it('never treats cached completed receipts as settlement when live provider observation fails',async()=>{
  ledger([receive(0)]);
  Reflect.set(mocks,BROWSER_SPENDING_POLICY,true);
  mocks.observe.mockRejectedValue(Error('Provider unreachable'));
  render(<PosPage onClose={vi.fn()}/>);
  await flush();
  expect(mocks.observe).toHaveBeenCalled();
  expect(mocks.listPayments).not.toHaveBeenCalled();
  expect(screen.queryByText('Payment received')).toBeNull();
 });
});
