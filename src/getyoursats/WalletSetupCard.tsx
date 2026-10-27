import {ChevronRightIcon, CloseIcon} from '../components/Icons';
import type {WalletSetupController} from '../hooks/useWalletSetup';
import {usePresentation} from '../hooks/usePresentation';
import {walletSetupCopy} from '../locales/walletSetup';

interface Props {
  setup: WalletSetupController;
  onReviewRecovery: () => void;
  onStartTour: () => void;
  paused?: boolean;
}

export default function WalletSetupCard({setup, onReviewRecovery, onStartTour, paused = false}: Props) {
  const {language} = usePresentation();
  const copy = walletSetupCopy(language);
  const {progress} = setup;
  const recoveryDone = progress.recoveryStatus === 'phrase-verified';
  const tourDone = progress.tourStatus === 'completed';
  if (!setup.scope || progress.cardDismissed || recoveryDone) return null;
  const completed = Number(recoveryDone) + Number(tourDone);
  return (
    <section aria-label={copy.cardTitle} data-testid="wallet-setup-card" inert={paused} aria-hidden={paused || undefined}
      className="gys-wallet-setup-card mx-5 mb-4 rounded-2xl border border-spark-border bg-spark-dark p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-spark-text-primary">{copy.cardTitle}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs tabular-nums text-spark-text-muted" aria-label={copy.progressLabel}>{completed}/2</span>
          <button type="button" onClick={setup.dismissCard} aria-label={copy.dismiss} title={copy.dismiss}
            data-testid="wallet-setup-dismiss"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-spark-text-secondary hover:bg-white/5 hover:text-spark-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spark-primary">
            <CloseIcon size="sm"/>
          </button>
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <button type="button" onClick={onReviewRecovery} data-testid="wallet-setup-backup"
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-start text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spark-primary">
          <span className="min-w-0 flex-1 text-spark-text-primary">
            <span className="block font-semibold">{copy.backupPending}</span>
            <span className="mt-1 block text-xs leading-relaxed text-spark-text-secondary">
              {progress.recoveryStatus === 'passkey-reviewed' ? copy.backupReviewed : copy.cardBody}
            </span>
          </span>
          <ChevronRightIcon size="sm" className="shrink-0 text-spark-text-muted"/>
        </button>
        {!tourDone && <button type="button" onClick={onStartTour} data-testid="wallet-setup-start"
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-start text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spark-primary">
          <span className="min-w-0 flex-1 text-spark-text-primary">
            {progress.tourStatus === 'skipped' ? copy.resume : copy.start}
          </span>
          <ChevronRightIcon size="sm" className="shrink-0 text-spark-text-muted"/>
        </button>}
      </div>
    </section>
  );
}
