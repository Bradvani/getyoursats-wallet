import {useMemo, useState} from 'react';
import type {Payment} from '@breeztech/breez-sdk-spark';
import TransactionList from '../components/TransactionList';
import type {UnilateralExitEntry} from '../features/unilateral-exit/listEntries';

interface Props {
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
  return direction + ' Bitcoin';
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
  transactions, isSyncing, onPaymentSelected, exitEntries, onExitSelected, onRefresh,
}: Props) {
  const [tab, setTab] = useState<'activity'|'history'>('activity');
  const latest = useMemo(()=> [...transactions]
    .filter(tx => Number.isFinite(tx.timestamp) && tx.timestamp > 0)
    .sort((a,b)=>b.timestamp-a.timestamp).slice(0,8), [transactions]);
  const pending = transactions.filter(tx => tx.status === 'pending').length;

  return <section className="gys-activity" aria-label="Wallet activity and transaction history">
    <div className="gys-activity__heading">
      <div>
        <span className="gys-activity__eyebrow">YOUR WALLET · ON CHAIN & LIGHTNING</span>
        <h2>Money in motion<span aria-hidden="true">.</span></h2>
      </div>
      <button className="gys-activity__refresh" type="button"
        onClick={onRefresh} aria-label="Sync wallet activity">↻</button>
    </div>
    <div className="gys-activity__tabs" role="tablist" aria-label="Wallet records">
      <button type="button" role="tab" id="gys-tab-activity" aria-controls="gys-panel-activity"
        aria-selected={tab==='activity'} onClick={()=>setTab('activity')}>Activity</button>
      <button type="button" role="tab" id="gys-tab-history" aria-controls="gys-panel-history"
        aria-selected={tab==='history'} onClick={()=>setTab('history')}>
        Transaction history {transactions.length>0 && <span>{transactions.length}</span>}
      </button>
    </div>
    {tab==='activity'
      ? <div id="gys-panel-activity" role="tabpanel" aria-labelledby="gys-tab-activity">
        <div className="gys-activity__summary">
          <span><span className="gys-activity__online" aria-hidden="true"/> Wallet connected</span>
          <span>{isSyncing?'Syncing…':pending>0?`${pending} pending`:'SDK activity'}</span>
        </div>
        {latest.length ? <ul className="gys-activity__feed">
          {latest.map((tx, index)=><li key={tx.id || `${tx.timestamp}-${index}`}>
            <button type="button" onClick={()=>onPaymentSelected(tx)}
              aria-label={`${titleFor(tx)}, ${methodFor(tx)}, view payment details`}>
              <span className={`gys-activity__event-icon ${tx.paymentType==='receive'?'gys-activity__event-icon--in':'gys-activity__event-icon--out'}`} aria-hidden="true">
                {tx.paymentType==='receive'?'↙':'↗'}
              </span>
              <span className="gys-activity__event-text">
                <strong>{titleFor(tx)}</strong>
                <small>{methodFor(tx)} · {new Date(tx.timestamp*1000).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small>
              </span>
              <span className={`gys-activity__status ${tx.status==='pending'?'gys-activity__status--pending':''}`}>
                {tx.status==='pending'?'Pending':tx.status==='failed'?'Failed':'View'} <span aria-hidden="true">↗</span>
              </span>
            </button>
          </li>)}
        </ul> : <div className="gys-activity__empty">
          <span aria-hidden="true">↗</span>
          <strong>Your first transaction starts here.</strong>
          <p>{isSyncing?'Checking for wallet events…':'When you send or receive sats, actual SDK payment events appear here.'}</p>
        </div>}
        <button type="button" className="gys-activity__history-link" onClick={()=>setTab('history')}>
          View full transaction history <span aria-hidden="true">↗</span>
        </button>
      </div>
      : <div id="gys-panel-history" role="tabpanel" aria-labelledby="gys-tab-history">
        <TransactionList transactions={transactions} isSyncing={isSyncing}
          onPaymentSelected={onPaymentSelected} exitEntries={exitEntries} onExitSelected={onExitSelected}/>
      </div>}
  </section>;
}
