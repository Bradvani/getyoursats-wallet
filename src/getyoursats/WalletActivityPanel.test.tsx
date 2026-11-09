import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {BreezSdk, ListPaymentsRequest, Payment} from '@breeztech/breez-sdk-spark';
import WalletActivityPanel from './WalletActivityPanel';

const wallet = vi.hoisted(() => ({sdk: null as BreezSdk | null}));
vi.mock('../contexts/WalletContext', () => ({useWalletConnection: () => ({sdk: wallet.sdk})}));
beforeEach(() => { wallet.sdk = null; });

vi.mock('../components/TransactionList', () => ({
  default: ({transactions}: {transactions: Payment[]}) =>
    <div data-testid="full-history">SDK history: {transactions.length}</div>,
}));

const payment = (id: string, status: 'pending'|'failed'|'completed', type: 'send'|'receive'): Payment =>
  ({id, status, paymentType: type, method: 'lightning', timestamp: 1710000000, amount: 1000n, fees: 0n}) as unknown as Payment;

describe('WalletActivityPanel', () => {
  it('displays real SDK payments, opens their details and preserves full history', () => {
    const onPaymentSelected = vi.fn();
    const transactions = [payment('a','completed','receive'), payment('b','pending','send')];
    render(<WalletActivityPanel transactions={transactions} isSyncing={false}
      onPaymentSelected={onPaymentSelected} exitEntries={[]}
      onExitSelected={vi.fn()} onRefresh={vi.fn()}/>);
    expect(screen.getByRole('tab',{name:'Activity'}).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Received payment')).toBeTruthy();
    expect(screen.getByText('Outgoing payment')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/Received payment, 1 000 sats, Lightning, view payment details/i}));
    expect(onPaymentSelected).toHaveBeenCalledWith(transactions[0]);
    fireEvent.click(screen.getByRole('tab',{name:/History/}));
    expect(screen.getByTestId('full-history').textContent).toContain('SDK history: 2');
  });
  it('shows a clear Back to Wallet button on full history and returns to activity', () => {
    const onViewChange = vi.fn();
    const props = {transactions:[payment('a','completed','receive')], isSyncing:false,
      onPaymentSelected:vi.fn(), exitEntries:[], onExitSelected:vi.fn(),
      onRefresh:vi.fn(), onViewChange};
    const {rerender} = render(<WalletActivityPanel {...props} view="history"/>);
    expect(screen.getByRole('heading',{name:'History'})).toBeTruthy();
    const back = screen.getByRole('button',{name:'Back to Wallet'});
    expect(back.getAttribute('data-testid')).toBe('history-back-to-wallet');
    expect(back.textContent).toBe(''); // Icon-only visually, with a full accessible name.
    fireEvent.click(back);
    expect(onViewChange).toHaveBeenCalledWith('activity');
    rerender(<WalletActivityPanel {...props} view="activity"/>);
    expect(screen.getByRole('heading',{name:'Recent payments'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Back to Wallet'})).toBeNull();
  });
  it('never invents transactions for an empty SDK history', () => {
    render(<WalletActivityPanel transactions={[]} isSyncing={false}
      onPaymentSelected={vi.fn()} exitEntries={[]}
      onExitSelected={vi.fn()} onRefresh={vi.fn()}/>);
    expect(screen.getByText('Your first transaction starts here.')).toBeTruthy();
    expect(screen.queryByTestId('full-history')).toBeNull();
  });
  it('filters the connected-wallet history and clears filters without inventing rows', () => {
    const transactions = [payment('wallet-in','completed','receive'), payment('wallet-out','pending','send')];
    render(<WalletActivityPanel transactions={transactions} isSyncing={false}
      onPaymentSelected={vi.fn()} exitEntries={[]} onExitSelected={vi.fn()} onRefresh={vi.fn()}/>);
    fireEvent.click(screen.getByRole('tab',{name:/History/}));
    fireEvent.change(screen.getByRole('searchbox',{name:'Search transactions'}), {target:{value:'wallet-in'}});
    expect(screen.getByText('1 of 2 wallet records')).toBeTruthy();
    expect(screen.getByTestId('full-history').textContent).toContain('SDK history: 1');
    fireEvent.change(screen.getByRole('searchbox',{name:'Search transactions'}), {target:{value:'not-here'}});
    expect(screen.getByText('No transactions match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));
    expect(screen.getByText('2 of 2 wallet records')).toBeTruthy();
  });

  it('loads and searches the complete ledger before exporting a filtered CSV', async () => {
    const transactions = Array.from({length: 275}, (_, index) => ({
      ...payment('ledger-' + index, 'completed', index % 2 ? 'receive' : 'send'), timestamp: 1_710_000_000 + index,
    }));
    wallet.sdk = {listPayments: vi.fn(async (request: ListPaymentsRequest) => ({
      payments: transactions.slice(request.offset ?? 0, (request.offset ?? 0) + request.limit!),
    }))} as unknown as BreezSdk;
    let exported: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:history-export'; });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<WalletActivityPanel view="history" transactions={transactions.slice(-100)} isSyncing={false}
      onPaymentSelected={vi.fn()} exitEntries={[]} onExitSelected={vi.fn()} onRefresh={vi.fn()}/>);
    expect(screen.getByRole('button', {name: /Export CSV/})).toBeDisabled();
    await waitFor(() => expect(screen.getByText('275 of 275 wallet records')).toBeTruthy());
    expect(screen.getByText(/Records: 275 · Updated/)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', {name: 'Search transactions'}), {target: {value: 'ledger-0'}});
    expect(screen.getByText('1 of 275 wallet records')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: /Export CSV/}));
    expect(exported).toBeDefined();
    const csv = await exported!.text();
    expect(csv).toContain('"ledger-0"');
    expect(csv.trim().split('\r\n')).toHaveLength(2);
  });

  it('blocks partial exports when a later page fails', async () => {
    const transactions = Array.from({length: 100}, (_, index) => payment('ledger-' + index, 'completed', 'receive'));
    wallet.sdk = {listPayments: vi.fn().mockResolvedValueOnce({payments: transactions}).mockRejectedValueOnce(new Error('offline'))} as unknown as BreezSdk;
    render(<WalletActivityPanel view="history" transactions={transactions} isSyncing={false}
      onPaymentSelected={vi.fn()} exitEntries={[]} onExitSelected={vi.fn()} onRefresh={vi.fn()}/>);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Complete history could not be loaded'));
    expect(screen.getByRole('button', {name: /Export CSV/})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Try again'})).toBeTruthy();
  });
});
