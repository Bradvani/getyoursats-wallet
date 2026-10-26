import {displayPaymentAmount} from './paymentDisplay';
import {trustCopy} from './trustCopy';
import {usePresentation} from '../hooks/usePresentation';
import type {AppLanguage} from '../services/presentationPreferences';
import {useEffect, useMemo, useState} from 'react';
import type {BreezSdk, Payment} from '@breeztech/breez-sdk-spark';
import TransactionList from '../components/TransactionList';
import {BackIcon} from '../components/Icons';
import {useWalletConnection} from '../contexts/WalletContext';
import {readPaymentHistory, type PaymentHistorySnapshot} from '../services/paymentHistory';
import {isUnclaimedDepositPayment} from '../utils/depositHelpers';
import type {UnilateralExitEntry} from '../features/unilateral-exit/listEntries';
import {historyToCsv, selectHistory, type HistoryDirection, type HistoryStatus} from './historyRecords';

/** Explicit navigation affordance, localized independently of the Wallet nav label. */
const BACK_TO_WALLET:Record<AppLanguage,string> = {
  en: 'Back to Wallet',
  hi: 'वॉलेट पर वापस जाएँ',
  es: 'Volver a la cartera',
  pt: 'Voltar à carteira',
  ja: 'ウォレットに戻る',
  th: 'กลับไปที่กระเป๋า',
  vi: 'Quay lại ví',
  ta: 'வாலட்டிற்குத் திரும்பு',
  ar: 'العودة إلى المحفظة',
  'zh-CN': '返回钱包',
};

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
  const {sdk}=useWalletConnection();
  const [localTab, setLocalTab] = useState<'activity'|'history'>('activity');
  const tab=view??localTab;
  const setTab=(next:'activity'|'history')=>{setLocalTab(next);onViewChange?.(next);};
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<HistoryDirection>('all');
  const [status, setStatus] = useState<HistoryStatus>('all');
  const [historyRead, setHistoryRead] = useState<{
    sdk: BreezSdk; revision: number; snapshot: PaymentHistorySnapshot | null; error: string;
  } | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const currentRead = historyRead?.sdk === sdk && historyRead.revision === historyRevision ? historyRead : null;
  const historyLoading = tab === 'history' && !!sdk && !currentRead;
  const historyError = currentRead?.error ?? '';
  useEffect(() => {
    if (tab !== 'history' || !sdk || currentRead) return;
    const controller = new AbortController();
    void readPaymentHistory(sdk, {signal: controller.signal}).then(snapshot => {
      if (!controller.signal.aborted) setHistoryRead({sdk, revision: historyRevision, snapshot, error: ''});
    }).catch(() => {
      if (!controller.signal.aborted) setHistoryRead(previous => ({sdk, revision: historyRevision,
        snapshot: previous?.sdk === sdk ? previous.snapshot : null,
        error: 'Complete history could not be loaded. Retry before exporting.'}));
    });
    return () => controller.abort();
  }, [tab, sdk, historyRevision, currentRead]);
  const snapshot = historyRead?.sdk === sdk ? historyRead.snapshot : null;
  const historyRecords = useMemo(() => snapshot
    ? [...transactions.filter(isUnclaimedDepositPayment), ...snapshot.payments]
    : transactions, [snapshot, transactions]);
  const filteredHistory = useMemo(
    () => selectHistory(historyRecords, query, direction, status),
    [historyRecords, query, direction, status],
  );
  const exportableHistory = useMemo(() => selectHistory(
    (snapshot?.payments ?? transactions).filter(payment => !isUnclaimedDepositPayment(payment)), query, direction, status,
  ), [snapshot, transactions, query, direction, status]);
  const historyReady = !sdk || (!!snapshot && !historyLoading && !historyError);
  const exportCsv = () => {
    if (!historyReady || !exportableHistory.length) return;
    // The file is created entirely on device from current wallet SDK results.
    const csv = historyToCsv(exportableHistory);
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
        <div className="gys-activity__title-row">
          {view==='history'&&<button type="button" className="gys-activity__back" aria-label={BACK_TO_WALLET[language]} title={BACK_TO_WALLET[language]} onClick={()=>setTab('activity')} data-testid="history-back-to-wallet">
            <span aria-hidden="true"><BackIcon size="md"/></span>
          </button>}
          <h2>{tab==='history'?text.history:text.recent}</h2>
        </div>
      </div>
      <button className="gys-activity__refresh" type="button"
        onClick={() => { onRefresh(); setHistoryRevision(value => value + 1); }} aria-label="Sync wallet activity">↻</button>
    </div>
    {view===undefined&&<div className="gys-activity__tabs" role="tablist" aria-label="Wallet records">
      <button type="button" role="tab" id="gys-tab-activity" aria-controls="gys-panel-activity"
        aria-selected={tab==='activity'} onClick={()=>setTab('activity')}>Activity</button>
      <button type="button" role="tab" id="gys-tab-history" aria-controls="gys-panel-history"
        aria-selected={tab==='history'} onClick={()=>setTab('history')}>
        Transaction history {snapshot && <span>{snapshot.payments.length}</span>}
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
        {sdk && <p role="status" aria-live="polite">
          {historyLoading || (!snapshot && !historyError)
            ? 'Loading wallet history…'
            : snapshot && `Loaded ${snapshot.payments.length} payment records through ${new Date(snapshot.throughTimestamp * 1_000).toLocaleString(language)}. Refresh after syncing for updated records.`}
        </p>}
        {!sdk && <p role="note">Showing loaded records only. The export includes these loaded payment records.</p>}
        {!!historyError && <p role="alert">{historyError} <button type="button" onClick={() => setHistoryRevision(value => value + 1)}>Retry history</button></p>}
        {historyRecords.some(isUnclaimedDepositPayment) && <p role="note">Unclaimed deposits appear below. CSV exports contain wallet payment records.</p>}
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
            <span aria-live="polite">{filteredHistory.length} of {historyRecords.length} wallet records</span>
            <button type="button" disabled={!historyReady || !exportableHistory.length} onClick={exportCsv}>
              Export CSV ↗
            </button>
          </div>
        </div>
        {filteredHistory.length || !historyRecords.length
          ? <TransactionList transactions={filteredHistory} isSyncing={isSyncing || historyLoading}
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
