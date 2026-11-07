import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {CheckIcon, ChevronRightIcon, KeyIcon, LightningBoltIcon, QrCodeIcon, ShieldCheckIcon} from '../components/Icons';
import {usePresentation} from '../hooks/usePresentation';
import {bitcoinLearningCopy} from '../locales/bitcoinLearning';
import {
  BITCOIN_LEARNING_CHAPTERS, type BitcoinLearningChapter, type BitcoinLearningController,
} from './bitcoinLearningState';
import './bitcoinLearning.css';

interface BitcoinLearningJourneyProps {
  learning: BitcoinLearningController;
  onOpenWallet: () => void;
  onReviewRecovery: () => void;
  paused?: boolean;
}

/** Only decorative imagery: never render a live private key, mnemonic or real transaction. */
function ChapterVisual({chapter}: {chapter: BitcoinLearningChapter}) {
  return <div className={'gys-learn__scene gys-learn__scene--' + chapter} aria-hidden="true">
    {chapter === 'mission' && <div className="gys-learn__peer">
      <span className="gys-learn__peer-node">₿</span><i/><span className="gys-learn__peer-node">₿</span>
    </div>}
    {chapter === 'supply' && <div className="gys-learn__number"><strong>21,000,000</strong><span>BTC</span></div>}
    {chapter === 'sats' && <div className="gys-learn__number"><span>1 BTC</span><strong>100,000,000</strong><span>sats</span></div>}
    {chapter === 'halving' && <div className="gys-learn__halving" dir="ltr">
      {['50', '25', '12.5', '6.25', '3.125'].map((amount, index) =>
        <span key={amount} style={{opacity: .35 + (index * .15)}}><i>{amount}</i><small>{[2009,2012,2016,2020,2024][index]}</small></span>)}
    </div>}
    {chapter === 'lightning' && <div className="gys-learn__lightning">
      <span className="gys-learn__peer-node"><QrCodeIcon size="xl"/></span>
      <i/><LightningBoltIcon size="xl"/><i/>
      <span className="gys-learn__peer-node"><CheckIcon size="xl"/></span>
    </div>}
    {chapter === 'getyoursats' && <div className="gys-learn__app-scene">
      <img src="/brand/app-icon.svg" width="84" height="84" alt=""/>
      <div><QrCodeIcon/><LightningBoltIcon/><CheckIcon/></div>
    </div>}
    {chapter === 'keys' && <div className="gys-learn__key-scene">
      <span><KeyIcon size="lg"/></span><i/><span><ShieldCheckIcon size="lg"/></span><i/><span><QrCodeIcon size="lg"/></span>
    </div>}
    {chapter === 'recovery' && <div className="gys-learn__paper" aria-hidden="true">
      <KeyIcon size="lg"/><div>{Array.from({length:12},(_,index)=><i key={index}/>)}</div>
    </div>}
    {chapter === 'passkeys' && <div className="gys-learn__passkey"><ShieldCheckIcon size="xl"/><span>••••</span></div>}
    {chapter === 'payments' && <div className="gys-learn__payment"><span><LightningBoltIcon size="xl"/></span><i/><span><CheckIcon size="xl"/></span></div>}
  </div>;
}

export default function BitcoinLearningJourney({
  learning, onOpenWallet, onReviewRecovery, paused = false,
}: BitcoinLearningJourneyProps) {
  const {language} = usePresentation();
  const text = bitcoinLearningCopy(language);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [keyAnswer, setKeyAnswer] = useState<{chapter: BitcoinLearningChapter; choice: number} | null>(null);
  const {status, chapter} = learning.progress;
  const keyChoice = keyAnswer?.chapter === chapter ? keyAnswer.choice : null;
  const index = BITCOIN_LEARNING_CHAPTERS.indexOf(chapter);
  const lesson = text.chapters[chapter];
  const last = index === BITCOIN_LEARNING_CHAPTERS.length - 1;
  const isOffered = status === 'offered';
  const openWallet = () => { learning.skip(); onOpenWallet(); };
  const start = () => { learning.start(); onOpenWallet(); };
  const next = () => {
    if (chapter === 'keys' && keyChoice !== 0) return;
    learning.next();
  };

  useEffect(() => {
    if (paused || (status !== 'offered' && status !== 'active')) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    titleRef.current?.focus();
    return () => { document.body.style.overflow = previous; };
  }, [paused, chapter, status]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); openWallet(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter(item => item.getAttribute('aria-hidden') !== 'true');
    if (!items.length) return;
    const first = items[0], lastItem = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastItem.focus(); }
    if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); first.focus(); }
  };

  if (paused || (status !== 'offered' && status !== 'active')) return null;

  return <section className="gys-learn" role="dialog" aria-modal="true"
    aria-labelledby="gys-learn-title" data-testid="bitcoin-learning-journey" data-learning-status={status}
    data-learning-chapter={chapter} dir={language === 'ar' ? 'rtl' : 'ltr'}
    ref={dialogRef} onKeyDown={onKeyDown}>
    <div className="gys-learn__panel">
      <header className="gys-learn__header">
        <img src="/brand/wordmark-stacked-light.svg" width="103" height="55" alt="GetYourSats"/>
        <button type="button" className="gys-learn__skip" onClick={openWallet} data-testid="bitcoin-learning-skip">{text.skip}</button>
      </header>
      {isOffered ? <div className="gys-learn__offer">
        <div className="gys-learn__offer-orbit" aria-hidden="true"><span>₿</span><i/><i/></div>
        <p className="gys-learn__eyebrow">{text.walletReady}</p>
        <h1 id="gys-learn-title" tabIndex={-1} ref={titleRef}>{text.welcome}</h1>
        <p className="gys-learn__body">{text.subtitle}</p>
        <p className="gys-learn__estimated">{text.estimated}</p>
        <div className="gys-learn__buttons">
          <button type="button" className="gys-learn__primary" onClick={start} data-testid="bitcoin-learning-start">
            {text.novice}<ChevronRightIcon size="sm"/>
          </button>
          <button type="button" className="gys-learn__secondary" onClick={openWallet} data-testid="bitcoin-learning-experienced">
            {text.experienced}
          </button>
        </div>
      </div> : <div className="gys-learn__lesson">
        <div className="gys-learn__progress-line">
          <div className="gys-learn__progress" role="progressbar" aria-label={text.lessonProgress}
            aria-valuemin={1} aria-valuemax={BITCOIN_LEARNING_CHAPTERS.length}
            aria-valuenow={index + 1} aria-valuetext={(index + 1) + '/' + BITCOIN_LEARNING_CHAPTERS.length}>
            {BITCOIN_LEARNING_CHAPTERS.map((item, position) =>
              <span key={item} data-active={position <= index}/>)}
          </div>
          <span className="gys-learn__count" dir="ltr">{index + 1} / {BITCOIN_LEARNING_CHAPTERS.length}</span>
        </div>
        <ChapterVisual key={chapter} chapter={chapter}/>
        <div className="gys-learn__words" key={chapter}>
          <p className="gys-learn__eyebrow">{lesson.label}</p>
          <h1 id="gys-learn-title" tabIndex={-1} ref={titleRef} key={chapter}>{lesson.title}</h1>
          <p className="gys-learn__body">{lesson.body}</p>
          <p className="gys-learn__detail">{lesson.detail}</p>
          {chapter === 'keys' && <fieldset className="gys-learn__quiz" data-testid="bitcoin-keys-quiz">
            <legend>{text.quizQuestion}</legend>
            {text.quizOptions.map((option, choice) => <button key={choice} type="button"
              aria-pressed={keyChoice === choice} data-correct={keyChoice === choice && choice === 0}
              className="gys-learn__quiz-option" onClick={() => setKeyAnswer({chapter, choice})}>
              <span>{option}</span><span aria-hidden="true">{keyChoice === choice ? (choice === 0 ? '✓' : '×') : '○'}</span>
            </button>)}
            <p className="gys-learn__quiz-feedback" aria-live="polite">
              {keyChoice === null ? '\u00a0' : keyChoice === 0 ? text.quizRight : text.quizWrong}
            </p>
          </fieldset>}
          {(chapter === 'recovery' || chapter === 'passkeys') && <div className="gys-learn__recovery">
            <p>{text.recoveryNote}</p>
            <button type="button" onClick={onReviewRecovery} data-testid="bitcoin-learning-review-backup">
              <KeyIcon size="sm"/>{text.reviewBackup}
            </button>
          </div>}
          {chapter === 'mission' && <a className="gys-learn__source" href="https://bitcoin.org/bitcoin.pdf" target="_blank" rel="noopener noreferrer">
            {text.learnMore}<span aria-hidden="true">↗</span>
          </a>}
        </div>
        <footer className="gys-learn__lesson-actions">
          <button type="button" className="gys-learn__back" onClick={learning.previous} disabled={index === 0}>
            {text.back}
          </button>
          <button type="button" className="gys-learn__primary" data-testid="bitcoin-learning-next"
            disabled={chapter === 'keys' && keyChoice !== 0}
            onClick={last ? () => { learning.next(); onOpenWallet(); } : next}>
            {last ? text.finish : text.next}<ChevronRightIcon size="sm"/>
          </button>
        </footer>
        <p className="gys-learn__disclaimer">{text.disclaimer}</p>
      </div>}
    </div>
  </section>;
}
