import {describe, expect, it, vi} from 'vitest';
import type {ListPaymentsRequest, Payment} from '@breeztech/breez-sdk-spark';
import {readPaymentHistory} from './paymentHistory';
import {historyToCsv, selectHistory} from '../getyoursats/historyRecords';

const receipt = (index: number): Payment => ({
  id: `payment-${index}`, timestamp: 1_700_000_000 + index, amount: BigInt(index + 1), fees: 1n,
  paymentType: index % 2 ? 'send' : 'receive', method: 'lightning',
  status: index % 3 ? 'completed' : 'pending',
}) as Payment;

function reader(records: Payment[]) {
  return vi.fn(async (request: ListPaymentsRequest) => ({payments: records
    .filter(p => p.timestamp <= request.toTimestamp!)
    .filter(p => !request.typeFilter || request.typeFilter.includes(p.paymentType))
    .filter(p => !request.statusFilter || request.statusFilter.includes(p.status))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(request.offset, (request.offset ?? 0) + request.limit!)}));
}

describe('complete wallet payment history', () => {
  it('searches and exports a 275-payment ledger beyond the recent page', async () => {
    const records = Array.from({length: 275}, (_, i) => receipt(i));
    const listPayments = reader(records);
    const result = await readPaymentHistory({listPayments});
    expect(result.payments).toHaveLength(275);
    expect(listPayments.mock.calls.map(([request]) => request.offset)).toEqual([0, 100, 200]);
    expect(selectHistory(result.payments, 'payment-0', 'all', 'all')).toHaveLength(1);
    const csv = historyToCsv(result.payments);
    expect(csv).toContain('"payment-0"');
    expect(csv).toContain('"payment-274"');
    expect(csv.trim().split('\r\n')).toHaveLength(276);
  });

  it('holds one time boundary when new payments arrive during pagination', async () => {
    const records = Array.from({length: 251}, (_, i) => receipt(i));
    const load = reader(records);
    const listPayments = vi.fn(async (request: ListPaymentsRequest) => {
      if (request.offset === 100) records.push({...receipt(500), timestamp: request.toTimestamp! + 1});
      return load(request);
    });
    const result = await readPaymentHistory({listPayments}, {toTimestamp: 1_700_000_300});
    expect(result.payments).toHaveLength(251);
    expect(new Set(result.payments.map(p => p.id)).size).toBe(251);
    expect(result.payments.some(p => p.id === 'payment-500')).toBe(false);
    expect(listPayments.mock.calls.every(([request]) => request.toTimestamp === 1_700_000_300 && request.sortAscending)).toBe(true);
  });

  it('deduplicates overlapping pages and retains the later authoritative record', async () => {
    const records = Array.from({length: 150}, (_, i) => receipt(i));
    const listPayments = vi.fn()
      .mockResolvedValueOnce({payments: records.slice(0, 100)})
      .mockResolvedValueOnce({payments: [{...records[99], status: 'completed'}, ...records.slice(100)]});
    const result = await readPaymentHistory({listPayments});
    expect(result.payments).toHaveLength(150);
    expect(result.payments.find(p => p.id === 'payment-99')?.status).toBe('completed');
  });

  it('rejects a failed later page instead of exporting a partial ledger', async () => {
    const listPayments = vi.fn().mockResolvedValueOnce({payments: Array.from({length: 100}, (_, i) => receipt(i))})
      .mockRejectedValueOnce(new Error('connection lost'));
    await expect(readPaymentHistory({listPayments})).rejects.toThrow('connection lost');
  });

  it('stops a non-advancing SDK and malformed payment responses', async () => {
    const listPayments = vi.fn().mockResolvedValue({payments: Array.from({length: 100}, (_, i) => receipt(i))});
    await expect(readPaymentHistory({listPayments})).rejects.toThrow('did not advance');
    expect(listPayments).toHaveBeenCalledTimes(2);
    await expect(readPaymentHistory({listPayments: vi.fn().mockResolvedValue({payments: null})})).rejects.toThrow('unavailable');
  });

  it('cancels after a wallet change before fetching another page', async () => {
    const controller = new AbortController();
    const listPayments = vi.fn(async () => {
      controller.abort();
      return {payments: Array.from({length: 100}, (_, i) => receipt(i))};
    });
    await expect(readPaymentHistory({listPayments}, {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
    expect(listPayments).toHaveBeenCalledTimes(1);
  });
});
