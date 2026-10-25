import {displayPaymentAmount} from './paymentDisplay';
import {trustCopy} from './trustCopy';
import {usePresentation} from '../hooks/usePresentation';
import {useMemo, useState} from 'react';
import type {Payment} from '@breeztech/breez-sdk-spark';
import TransactionList from '../components/TransactionList';
import type {UnilateralExitEntry} from '../features/unilateral-exit/listEntries';
import {historyToCsv, selectHistory, type HistoryDirection, type HistoryStatus} from './historyRecords';

interface Props {
  view?: 'activity'|'history';
  onViewChange?: (view:'activity'|'history')=>void;
  transactions: Payment[];
  isSyncing: boolean;
  onPaymentSelected: (payment: Payment) => void;
  exitEntries: UnilateralExitEntry[];
  onExitSelected: (entry: UnilateralExitEntry) => void;
  onRefresh: () => void;
}

function titleFor(payment: Payment): string {
  const direction = payment.paymentType === 'receive' ? 'Received' : 'Sent';
  if (payment.status === 'pending') return payment.paymentType === 'receive' ? 'Incoming payment' : 'Outgoing payment';
  if (payment.status === 'failed') return direction + ' payment failed';
  return payment.paymentType==='receive'?trustCopy().received:trustCopy().sent;
}

function methodFor(payment: Payment): string {
  if (payment.method === 'lightning') return 'Lightning';
  if (payment.method === 'deposit') return 'Bitcoin deposit';
  if (payment.method === 'spark') return 'Spark';
  return 'Bitcoin';
}

/**
 * Activity is reconstructed from actual wallet SDK payments on every render.
 * Nothing here is an invented transaction, a fake payment acknowledgement,
 * or a separate (and possibly inconsistent) settlement record.
 */
export default function WalletActivityPanel({
  transactions, isSyncing, onPaymentSelected, exitEntries, onExitSelected, onRefresh, view,onViewChange,
}: Props) {
  const {language}=usePresentation();const text=trustCopy(language);
  const [localTab, setLocalTab] = useState<'activity'|'history'>('activity');
  const tab=view??localTab;
  const setTab=(next:'activity'|'history')=>{setLocalTab(next);onViewChange?.(next);};
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<HistoryDirection>('all');
  const [status, setStatus] = useState<HistoryStatus>('all');
  const filteredHistory = useMemo(
    () => selectHistory(transactions, query, direction, status),
    [transactions, query, direction, status],
  );
  const exportCsv = () => {
    if (!filteredHistory.length) return;
    // The file is created entirely on device from current wallet SDK results.
    const csv = historyToCsv(filteredHistory);
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'getyoursats-transactions.csv';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const latest = useMemo(()=> [...transactions]
    .filter(tx => Number.isFinite(tx.timestamp) && tx.timestamp > 0)
    .sort((a,b)=>b.timestamp-a.timestamp).slice(0,8), [transactions]);
  const pending = transactions.filter(tx => tx.status === 'pending').length;

  return <section className="gys-activity" aria-label="Wallet activity and transaction history">
    <div className="gys-activity__heading">
      <div>
        <span className="gys-activity__eyebrow">YOUR WALLET · ON CHAIN & LIGHTNING</span>
        <h2>{tab==='history'?text.history:text.recent}</h2>
        {view==='history'&&<button type="button" className="min-h-11 text-spark-primary" onClick={()=>setTab('activity')}>{text.wallet}</button>}
      </div>
      <button className="gys-activity__refresh" type="button"
        onClick={onRefresh} aria-label="Sync wallet activity">↻</button>
    </div>
    {view===undefined&&<div className="gys-activity__tabs" role="tablist" aria-label="Wallet records">
      <button type="button" role="tab" id="gys-tab-activity" aria-controls="gys-panel-activity"
        aria-selected={tab==='activity'} onClick={()=>setTab('activity')}>Activity</button>
      <button type="button" role="tab" id="gys-tab-history" aria-controls="gys-panel-history"
        aria-selected={tab==='history'} onClick={()=>setTab('history')}>
        Transaction history {transactions.length>0 && <span>{transactions.length}</span>}
      </button>
    </div>}
    {tab==='activity'
      ? <div id="gys-panel-activity" role="tabpanel" aria-label={text.recent}>
        <div className="gys-activity__summary">
          <span><span className="gys-activity__online" aria-hidden="true"/> Wallet connected</span>
          <span>{isSyncing?'Syncing…':pending>0?`${pending} pending`:text.upToDate}</span>
        </div>
        {latest.length ? <ul className="gys-activity__feed">
          {latest.map((tx, index)=><li key={tx.id || `${tx.timestamp}-${index}`}>
            <button type="button" onClick={()=>onPaymentSelected(tx)}
              aria-label={`${titleFor(tx)}, ${displayPaymentAmount(tx)}, ${methodFor(tx)}, ${text.details}`}>
              <span className={`gys-activity__event-icon ${tx.paymentType==='receive'?'gys-activity__event-icon--in':'gys-activity__event-icon--out'}`} aria-hidden="true">
                {tx.paymentType==='receive'?'↙':'↗'}
              </span>
              <span className="gys-activity__event-text">
                <strong>{titleFor(tx)}</strong>
                <span className="gys-activity__amount">{tx.paymentType==='receive'?'+':'−'}{displayPaymentAmount(tx)}</span>
                <small>{methodFor(tx)} · {new Date(tx.timestamp*1000).toLocaleString(language, {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small>
              </span>
              <span className={`gys-activity__status ${tx.status==='pending'?'gys-activity__status--pending':''}`}>
                {tx.status==='pending'?'Pending':tx.status==='failed'?'Failed':'View'} <span aria-hidden="true">↗</span>
              </span>
            </button>
          </li>)}
        </ul> : <div className="gys-activity__empty">
          <span aria-hidden="true">↗</span>
          <strong>Your first transaction starts here.</strong>
          <p>{isSyncing?'Checking for wallet events…':text.emptyPayments}</p>
        </div>}
        <button type="button" className="gys-activity__history-link" onClick={()=>setTab('history')}>
          View full transaction history <span aria-hidden="true">↗</span>
        </button>
      </div>
      : <div id="gys-panel-history" role="tabpanel" aria-label={text.history}>
        <div className="gys-history-controls">
          <label className="gys-history-controls__search">
            <span>Search transactions</span>
            <input type="search" value={query} placeholder="Payment ID, network or status"
              onChange={event => setQuery(event.target.value)} />
          </label>
          <div className="gys-history-controls__filters">
            <label><span>Direction</span>
              <select value={direction} onChange={event => setDirection(event.target.value as HistoryDirection)}>
                <option value="all">All directions</option>
                <option value="send">Sent</option>
                <option value="receive">Received</option>
              </select>
            </label>
            <label><span>Status</span>
              <select value={status} onChange={event => setStatus(event.target.value as HistoryStatus)}>
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </label>
          </div>
          <div className="gys-history-controls__footer">
            <span aria-live="polite">{filteredHistory.length} of {transactions.length} wallet records</span>
            <button type="button" disabled={!filteredHistory.length} onClick={exportCsv}>
              Export CSV ↗
            </button>
          </div>
        </div>
        {filteredHistory.length || !transactions.length
          ? <TransactionList transactions={filteredHistory} isSyncing={isSyncing}
              onPaymentSelected={onPaymentSelected}
              exitEntries={query || direction !== 'all' || status !== 'all' ? [] : exitEntries}
              onExitSelected={onExitSelected}/>
          : <div className="gys-history-controls__empty">
              No transactions match these filters.
              <button type="button" onClick={() => { setQuery(''); setDirection('all'); setStatus('all'); }}>
                Clear filters
              </button>
            </div>}
      </div>}
  </section>;
}
