import type {BreezSdk, ListPaymentsRequest, Payment} from '@breeztech/breez-sdk-spark';

type HistoryFilters = Pick<ListPaymentsRequest,
  'typeFilter' | 'statusFilter' | 'assetFilter' | 'paymentDetailsFilter' | 'fromTimestamp' | 'toTimestamp'>;

export interface PaymentHistorySnapshot {
  payments: Payment[];
  throughTimestamp: number;
}

interface HistoryOptions extends HistoryFilters {
  signal?: AbortSignal;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 1_000;

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('History request cancelled', 'AbortError');
}

/** Read a bounded ledger snapshot; a page failure never returns a partial ledger.
 * Ascending order and a fixed upper time bound keep newer arrivals from shifting
 * earlier offsets. The SDK does not expose a transactional database snapshot. */
export async function readPaymentHistory(
  sdk: Pick<BreezSdk, 'listPayments'>,
  {signal, ...filters}: HistoryOptions = {},
): Promise<PaymentHistorySnapshot> {
  const throughTimestamp = filters.toTimestamp ?? Math.floor(Date.now() / 1_000);
  const records = new Map<string, Payment>();
  for (let page = 0; page < MAX_PAGES; page++) {
    checkCancelled(signal);
    const result = await sdk.listPayments({
      ...filters,
      toTimestamp: throughTimestamp,
      sortAscending: true,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    checkCancelled(signal);
    if (!Array.isArray(result.payments)) throw new Error('Wallet payment history is unavailable.');
    const previousCount = records.size;
    for (const payment of result.payments) {
      if (typeof payment.id !== 'string' || !payment.id) throw new Error('Wallet history contains an invalid payment record.');
      records.set(payment.id, payment);
    }
    if (result.payments.length < PAGE_SIZE) {
      return {
        payments: [...records.values()].sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id)),
        throughTimestamp,
      };
    }
    if (records.size === previousCount) throw new Error('Wallet history pagination did not advance. Retry syncing the wallet.');
  }
  throw new Error('Wallet history is too large to load completely. No partial export was created.');
}
