import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import type {Payment} from '@breeztech/breez-sdk-spark';
import WalletActivityPanel from './WalletActivityPanel';

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
    expect(screen.getByText('Received Bitcoin')).toBeTruthy();
    expect(screen.getByText('Outgoing payment')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/Received Bitcoin, Lightning, view payment details/i}));
    expect(onPaymentSelected).toHaveBeenCalledWith(transactions[0]);
    fireEvent.click(screen.getByRole('tab',{name:/Transaction history/}));
    expect(screen.getByTestId('full-history').textContent).toContain('SDK history: 2');
  });
  it('never invents transactions for an empty SDK history', () => {
    render(<WalletActivityPanel transactions={[]} isSyncing={false}
      onPaymentSelected={vi.fn()} exitEntries={[]}
      onExitSelected={vi.fn()} onRefresh={vi.fn()}/>);
    expect(screen.getByText('Your first transaction starts here.')).toBeTruthy();
    expect(screen.queryByTestId('full-history')).toBeNull();
  });
});
