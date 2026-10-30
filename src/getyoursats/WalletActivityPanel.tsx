import {useFlowText} from '../hooks/useFlowText';
import {flowText} from '../locales/flowText';
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

function titleFor(payment: Payment, language: AppLanguage): string {
  const t=(value:string)=>flowText(language,value);
  if (payment.status === 'pending') return t(payment.paymentType === 'receive' ? 'Incoming payment' : 'Outgoing payment');
  if (payment.status === 'failed') return t('Payment failed');
  return payment.paymentType==='receive'?trustCopy(language).received:trustCopy(language).sent;
}

function methodFor(payment: Payment, language: AppLanguage): string {
  if (payment.method === 'lightning') return 'Lightning';
  if (payment.method === 'deposit') return flowText(language,'Bitcoin deposit');
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
  const t=useFlowText();
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

  return <section className="gys-activity" aria-label={text.history}>
    <div className="gys-activity__heading">
      <div>
        <div className="gys-activity__title-row">
          {view==='history'&&<button type="button" className="gys-activity__back" aria-label={BACK_TO_WALLET[language]} title={BACK_TO_WALLET[language]} onClick={()=>setTab('activity')} data-testid="history-back-to-wallet">
            <span aria-hidden="true"><BackIcon size="md"/></span>
          </button>}
          <h2>{tab==='history'?text.history:text.recent}</h2>
        </div>
      </div>
      <button className="gys-activity__refresh" type="button"
        onClick={() => { onRefresh(); setHistoryRevision(value => value + 1); }} aria-label={t('Sync wallet activity')}>↻</button>
    </div>
    {view===undefined&&<div className="gys-activity__tabs" role="tablist" aria-label={text.history}>
      <button type="button" role="tab" id="gys-tab-activity" aria-controls="gys-panel-activity"
        aria-selected={tab==='activity'} onClick={()=>setTab('activity')}>{t('Activity')}</button>
      <button type="button" role="tab" id="gys-tab-history" aria-controls="gys-panel-history"
        aria-selected={tab==='history'} onClick={()=>setTab('history')}>
        {text.history} {snapshot && <span>{snapshot.payments.length}</span>}
      </button>
    </div>}
    {tab==='activity'
      ? <div id="gys-panel-activity" role="tabpanel" aria-label={text.recent}>
        <div className="gys-activity__summary">
          <span>{isSyncing?t('Syncing…'):pending>0?`${t('Pending')} · ${pending}`:text.upToDate}</span>
        </div>
        {latest.length ? <ul className="gys-activity__feed">
          {latest.map((tx, index)=><li key={tx.id || `${tx.timestamp}-${index}`}>
            <button type="button" onClick={()=>onPaymentSelected(tx)}
              aria-label={`${titleFor(tx,language)}, ${displayPaymentAmount(tx)}, ${methodFor(tx,language)}, ${text.details}`}>
              <span className={`gys-activity__event-icon ${tx.paymentType==='receive'?'gys-activity__event-icon--in':'gys-activity__event-icon--out'}`} aria-hidden="true">
                {tx.paymentType==='receive'?'↙':'↗'}
              </span>
              <span className="gys-activity__event-text">
                <strong>{titleFor(tx,language)}</strong>
                <span className="gys-activity__amount">{tx.paymentType==='receive'?'+':'−'}{displayPaymentAmount(tx)}</span>
                <small>{methodFor(tx,language)} · {new Date(tx.timestamp*1000).toLocaleString(language, {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small>
              </span>
              <span className={`gys-activity__status ${tx.status==='pending'?'gys-activity__status--pending':''}`}>
                {t(tx.status==='pending'?'Pending':tx.status==='failed'?'Failed':'View')} <span aria-hidden="true">↗</span>
              </span>
            </button>
          </li>)}
        </ul> : <div className="gys-activity__empty">
          <span aria-hidden="true">↗</span>
          <strong>{t('Your first transaction starts here.')}</strong>
          <p>{isSyncing?t('Checking for payments…'):text.emptyPayments}</p>
        </div>}
        <button type="button" className="gys-activity__history-link" onClick={()=>setTab('history')}>
          {t('View full transaction history')} <span aria-hidden="true">↗</span>
        </button>
      </div>
      : <div id="gys-panel-history" role="tabpanel" aria-label={text.history}>
        {sdk && <p className="gys-history-note" role="status" aria-live="polite">
          {historyLoading || (!snapshot && !historyError)
            ? t('Loading wallet history…')
            : snapshot && t('{count} records · Updated {date}',{count:snapshot.payments.length,date:new Date(snapshot.throughTimestamp * 1_000).toLocaleString(language,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})})}
        </p>}
        {!sdk && <p className="gys-history-note" role="note">{t('Showing loaded records only. The export includes these loaded payment records.')}</p>}
        {!!historyError && <p className="gys-history-note" role="alert">{t(historyError)} <button type="button" onClick={() => setHistoryRevision(value => value + 1)}>{t('Try again')}</button></p>}
        {historyRecords.some(isUnclaimedDepositPayment) && <p className="gys-history-note" role="note">{t('Unclaimed deposits appear below. CSV exports contain wallet payment records.')}</p>}
        <div className="gys-history-controls">
          <label className="gys-history-controls__search">
            <span>{t('Search transactions')}</span>
            <input type="search" value={query} placeholder={t('Payment ID, network or status')}
              onChange={event => setQuery(event.target.value)} />
          </label>
          <div className="gys-history-controls__filters">
            <label><span>{t('Direction')}</span>
              <select value={direction} onChange={event => setDirection(event.target.value as HistoryDirection)}>
                <option value="all">{t('All directions')}</option>
                <option value="send">{t('Sent')}</option>
                <option value="receive">{t('Received')}</option>
              </select>
            </label>
            <label><span>{t('Status')}</span>
              <select value={status} onChange={event => setStatus(event.target.value as HistoryStatus)}>
                <option value="all">{t('All statuses')}</option>
                <option value="completed">{t('Completed')}</option>
                <option value="pending">{t('Pending')}</option>
                <option value="failed">{t('Failed')}</option>
              </select>
            </label>
          </div>
          <div className="gys-history-controls__footer">
            <span aria-live="polite">{t('{shown} of {total} wallet records',{shown:filteredHistory.length,total:historyRecords.length})}</span>
            <button type="button" disabled={!historyReady || !exportableHistory.length} onClick={exportCsv}>
              {t('Export CSV')} <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
        {filteredHistory.length || !historyRecords.length
          ? <TransactionList transactions={filteredHistory} isSyncing={isSyncing || historyLoading}
              onPaymentSelected={onPaymentSelected}
              exitEntries={query || direction !== 'all' || status !== 'all' ? [] : exitEntries}
              onExitSelected={onExitSelected}/>
          : <div className="gys-history-controls__empty">
              {t('No transactions match these filters.')}
              <button type="button" onClick={() => { setQuery(''); setDirection('all'); setStatus('all'); }}>
                {t('Clear filters')}
              </button>
            </div>}
      </div>}
  </section>;
}
