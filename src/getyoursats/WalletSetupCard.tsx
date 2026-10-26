import {ChevronRightIcon, CheckIcon} from '../components/Icons';
import type {WalletSetupController} from '../hooks/useWalletSetup';

interface Props {
  setup: WalletSetupController;
  onReviewRecovery: () => void;
  onStartTour: () => void;
}

export default function WalletSetupCard({setup, onReviewRecovery, onStartTour}: Props) {
  const {progress} = setup;
  const recoveryDone = progress.recoveryStatus !== 'pending';
  const tourDone = progress.tourStatus === 'completed';
  if (!setup.scope || (recoveryDone && tourDone)) return null;
  const completed = Number(recoveryDone) + Number(tourDone);
  return (
    <section aria-label="Wallet setup" className="gys-wallet-setup-card mx-5 mb-4 rounded-2xl border border-spark-border bg-spark-dark p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-spark-text-primary">Finish your wallet setup</h2>
        <span className="shrink-0 text-xs text-spark-text-muted">{completed} of 2</span>
      </div>
      <div className="mt-3 space-y-1">
        <button type="button" onClick={onReviewRecovery} data-wallet-tour="protect"
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-start text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spark-primary">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-spark-border text-xs text-spark-text-secondary" aria-hidden="true">
            {recoveryDone ? <CheckIcon size="sm"/> : '1'}
          </span>
          <span className="min-w-0 flex-1 text-spark-text-primary">
            {progress.recoveryStatus === 'phrase-verified' ? 'Offline backup confirmed' :
              progress.recoveryStatus === 'passkey-reviewed' ? 'Passkey recovery reviewed' : 'Review your recovery'}
          </span>
          <ChevronRightIcon size="sm" className="shrink-0 text-spark-text-muted"/>
        </button>
        <button type="button" onClick={onStartTour}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-start text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spark-primary">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-spark-border text-xs text-spark-text-secondary" aria-hidden="true">
            {tourDone ? <CheckIcon size="sm"/> : '2'}
          </span>
          <span className="min-w-0 flex-1 text-spark-text-primary">
            {tourDone ? 'Wallet tour completed' : progress.tourStatus === 'skipped' ? 'Continue your wallet tour' : 'Explore your wallet'}
          </span>
          <ChevronRightIcon size="sm" className="shrink-0 text-spark-text-muted"/>
        </button>
      </div>
    </section>
  );
}
