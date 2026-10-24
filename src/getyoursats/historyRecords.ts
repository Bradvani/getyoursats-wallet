import type {Payment} from '@breeztech/breez-sdk-spark';

export type HistoryDirection = 'all' | 'send' | 'receive';
export type HistoryStatus = 'all' | 'pending' | 'completed' | 'failed';

/** Search only fields we can derive locally from the connected wallet SDK. */
export function selectHistory(
  records: Payment[],
  query: string,
  direction: HistoryDirection,
  status: HistoryStatus,
): Payment[] {
  const normalized = query.trim().toLowerCase();
  return records
    .filter(tx =>
      (direction === 'all' || tx.paymentType === direction) &&
      (status === 'all' || tx.status === status) &&
      (!normalized || [tx.id, tx.paymentType, tx.method, tx.status]
        .some(value => String(value ?? '').toLowerCase().includes(normalized)))
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** Escape Excel-style formula injection and CSV delimiters before downloading. */
function csvCell(value: string): string {
  const guarded = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function historyToCsv(records: Payment[]): string {
  const columns = ['Date UTC', 'Payment ID', 'Direction', 'Network', 'Status', 'Amount sats', 'Fee sats'];
  const rows = records.map(tx => {
    const timestamp = Number.isFinite(tx.timestamp) && tx.timestamp > 0
      ? new Date(tx.timestamp * 1000).toISOString()
      : '';
    return [
      timestamp,
      tx.id,
      tx.paymentType,
      tx.method,
      tx.status,
      String(tx.amount),
      String(tx.fees),
    ].map(value => csvCell(String(value ?? ''))).join(',');
  });
  return [columns.join(','), ...rows].join('\r\n') + '\r\n';
}
