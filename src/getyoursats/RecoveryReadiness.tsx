import type {AppLanguage} from '../services/presentationPreferences';
import {bitcoinLearningCopy} from '../locales/bitcoinLearning';

/**
 * Private-recovery preparation is a real comprehension choice plus two
 * physical readiness actions. There is deliberately no "I read this"
 * checkbox and no persisted credit: it resets on each sensitive reveal.
 */
export interface RecoveryReadinessProps {
  language: AppLanguage;
  choice: number | null;
  onChoice: (choice: number) => void;
  privateReady: boolean;
  onPrivateReady: (value: boolean) => void;
  offlineReady: boolean;
  onOfflineReady: (value: boolean) => void;
  privateLabel: string;
  offlineLabel: string;
  title?: string;
  explanation?: string;
}

export function RecoveryReadiness({
  language, choice, onChoice, privateReady, onPrivateReady, offlineReady, onOfflineReady,
  privateLabel, offlineLabel, title, explanation,
}: RecoveryReadinessProps) {
  const copy = bitcoinLearningCopy(language);
  return <section className="space-y-4" data-testid="recovery-readiness">
    {title && <h3 className="font-display font-semibold text-spark-text-primary">{title}</h3>}
    {explanation && <p className="text-sm leading-relaxed text-spark-text-secondary">{explanation}</p>}
    <div className="space-y-2">
      <p className="text-sm font-semibold leading-relaxed text-spark-text-primary">{copy.quizQuestion}</p>
      <div className="grid gap-2" role="group" aria-label={copy.quizQuestion}>
        {copy.quizOptions.map((label, index) => <button key={index} type="button"
          aria-pressed={choice === index} onClick={() => onChoice(index)}
          className={"flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border p-3 text-start text-sm transition-colors " +
            (choice === index ? 'border-spark-primary bg-spark-surface text-spark-text-primary' :
              'border-spark-border bg-spark-dark text-spark-text-secondary hover:border-spark-primary/50')}>
          <span>{label}</span><span aria-hidden="true">{choice === index ? (index === 0 ? '✓' : '×') : '○'}</span>
        </button>)}
      </div>
      {choice !== null && <p className="text-xs leading-relaxed text-spark-text-secondary" role="status">
        {choice === 0 ? copy.quizRight : copy.quizWrong}
      </p>}
    </div>
    {choice === 0 && <div className="space-y-2" data-testid="recovery-private-preparation">
      <p className="text-xs text-spark-text-muted">{copy.chapters.recovery.body}</p>
      <button type="button" aria-pressed={privateReady} onClick={() => onPrivateReady(!privateReady)}
        className={"flex min-h-12 w-full items-center gap-3 rounded-xl border p-3 text-start text-sm " +
          (privateReady ? 'border-spark-primary/65 bg-spark-surface text-spark-text-primary' :
            'border-spark-border bg-spark-dark text-spark-text-secondary')}>
        <span aria-hidden="true" className="text-spark-primary">{privateReady ? '✓' : '01'}</span><span>{privateLabel}</span>
      </button>
      <button type="button" aria-pressed={offlineReady} onClick={() => onOfflineReady(!offlineReady)}
        className={"flex min-h-12 w-full items-center gap-3 rounded-xl border p-3 text-start text-sm " +
          (offlineReady ? 'border-spark-primary/65 bg-spark-surface text-spark-text-primary' :
            'border-spark-border bg-spark-dark text-spark-text-secondary')}>
        <span aria-hidden="true" className="text-spark-primary">{offlineReady ? '✓' : '02'}</span><span>{offlineLabel}</span>
      </button>
    </div>}
  </section>;
}
