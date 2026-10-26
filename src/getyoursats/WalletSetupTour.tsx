import {useId, useSyncExternalStore} from 'react';
import {motion} from 'motion/react';
import {
  ArrowDownIcon, CheckIcon, ChevronRightIcon, EditPencilIcon, KeyIcon,
  LightningBoltIcon, QrCodeIcon, ShieldCheckIcon, WalletIcon,
} from '../components/Icons';
import LanguageSelect from '../components/LanguageSelect';
import {PrimaryButton} from '../components/ui/buttons';
import {usePresentation} from '../hooks/usePresentation';
import {walletSetupCopy, type WalletSetupCopy} from '../locales/walletSetup';
import {APP_LANGUAGES, type AppLanguage} from '../services/presentationPreferences';
import {getDisplayFiatCurrency} from '../services/settings';
import {WALLET_TOUR_STEPS, type WalletTourStep, type WalletRecoveryMethod, type WalletRecoveryStatus} from './walletSetupState';
import './walletSetup.css';

export type {WalletTourStep} from './walletSetupState';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

const getServerReducedMotion = () => false;

interface WalletSetupTourProps {
  step: WalletTourStep;
  recoveryMethod: WalletRecoveryMethod;
  recoveryStatus: WalletRecoveryStatus;
  hasNativeAddress: boolean;
  paused?: boolean;
  onNext: () => void;
  onSkip: () => void;
  onReviewRecovery: () => void;
  onPersonalize: () => void;
  onOpenReceive: () => void;
  onOpenPos: () => void;
}

function FeaturePreview({step, language, text, verified, named}: {
  step: WalletTourStep; language: AppLanguage; text: WalletSetupCopy; verified: boolean; named: boolean;
}) {
  return (
    <div className={`gys-wallet-guide__visual gys-wallet-guide__visual--${step}`} aria-hidden="true" data-guide-visual={step}>
      <span className="gys-wallet-guide__preview-label">{text.preview}</span>
      {step === 'language' && (
        <div className="gys-wallet-guide__language-scene">
          <span className="gys-wallet-guide__language-tile gys-wallet-guide__language-tile--back" lang="es">es</span>
          <span className="gys-wallet-guide__language-tile gys-wallet-guide__language-tile--front" lang="pt">pt</span>
          <div className="gys-wallet-guide__language-main">
            <span className="gys-wallet-guide__language-glyph">Aa</span>
            <strong lang={language}>{APP_LANGUAGES.find(item => item.code === language)?.name}</strong>
          </div>
        </div>
      )}
      {step === 'protect' && (
        <div className="gys-wallet-guide__recovery-scene" data-verified={verified}>
          <span className="gys-wallet-guide__paper-shadow" />
          <div className="gys-wallet-guide__paper">
            <div className="gys-wallet-guide__paper-title"><KeyIcon size="sm"/><span>{text.stepNames.protect}</span></div>
            <div className="gys-wallet-guide__paper-lines"><i/><i/><i/><i/></div>
            <span className="gys-wallet-guide__paper-mark">{verified ? <CheckIcon/> : <EditPencilIcon/>}</span>
          </div>
          <div className="gys-wallet-guide__recovery-caption">
            <span><span>01</span>{text.recoveryChecklist[0]}</span>
            <span><span>02</span>{text.recoveryChecklist[1]}</span>
          </div>
        </div>
      )}
      {step === 'balance' && (
        <div className="gys-wallet-guide__balance-scene">
          <div className="gys-wallet-guide__balance-mark"><WalletIcon size="xl"/></div>
          <div className="gys-wallet-guide__balance-units" dir="ltr">
            <span>sats</span><span>BTC</span><span>{getDisplayFiatCurrency()}</span>
          </div>
          <div className="gys-wallet-guide__balance-rule"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
        </div>
      )}
      {step === 'receive' && (
        <div className="gys-wallet-guide__receive-scene">
          <div className="gys-wallet-guide__receive-orbit"/>
          <div className="gys-wallet-guide__receive-card">
            <QrCodeIcon size="xl" className="gys-wallet-guide__qr-symbol"/>
            <span><LightningBoltIcon size="xs"/>Lightning</span>
          </div>
          <span className="gys-wallet-guide__receive-token"><ArrowDownIcon size="lg"/></span>
        </div>
      )}
      {step === 'pos' && (
        <div className="gys-wallet-guide__pos-scene">
          <div className="gys-wallet-guide__pos-device">
            <span className="gys-wallet-guide__pos-screen"><QrCodeIcon size="xl"/></span>
            <div className="gys-wallet-guide__pos-keys"><i/><i/><i/><i/><i/><i/></div>
          </div>
          <div className="gys-wallet-guide__pos-stages">
            {text.posStages.map((label, index) => <span key={label}><i>{index + 1}</i>{label}</span>)}
          </div>
        </div>
      )}
      {step === 'identity' && (
        <div className="gys-wallet-guide__identity-scene">
          <span className="gys-wallet-guide__identity-at">@</span>
          <div className="gys-wallet-guide__identity-card">
            <strong>{text.stepNames.identity}</strong>
            <span dir="ltr">@getyoursats.com</span>
          </div>
          {named && <span className="gys-wallet-guide__identity-check"><CheckIcon/></span>}
        </div>
      )}
    </div>
  );
}

export default function WalletSetupTour({
  step, recoveryMethod, recoveryStatus, hasNativeAddress, paused = false,
  onNext, onSkip, onReviewRecovery, onPersonalize, onOpenReceive, onOpenPos,
}: WalletSetupTourProps) {
  const {language} = usePresentation();
  const text = walletSetupCopy(language);
  // Motion's hook snapshots the preference at mount. Subscribe here so a device
  // preference change also stops previews and chapter movement already on screen.
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getServerReducedMotion);
  const titleId = useId();
  const index = WALLET_TOUR_STEPS.indexOf(step);
  const verified = recoveryStatus === 'phrase-verified';
  const content = step === 'protect' && verified ? text.verified
    : step === 'identity' && hasNativeAddress ? text.named : text.steps[step];
  const detail = step === 'protect' && !verified
    ? recoveryMethod === 'passkey' ? text.passkeyDetail
      : recoveryMethod === 'device' ? text.deviceDetail : content.detail
    : content.detail;
  const action = step === 'protect' && !verified ? {label: text.backupAction, run: onReviewRecovery}
    : step === 'receive' ? {label: text.receiveAction, run: onOpenReceive}
    : step === 'pos' ? {label: text.posAction, run: onOpenPos}
    : step === 'identity' && !hasNativeAddress ? {label: text.nameAction, run: onPersonalize}
    : null;

  return (
    <section className="gys-wallet-guide" aria-label={text.guideLabel} dir={language === 'ar' ? 'rtl' : 'ltr'}
      inert={paused || undefined} aria-hidden={paused || undefined} data-testid="wallet-setup-guide" data-wallet-tour-step={step}
      data-paused={paused} data-motion={reducedMotion ? 'reduced' : 'full'}>
      <header className="gys-wallet-guide__header">
        <div className="gys-wallet-guide__label"><span className="gys-wallet-guide__brand-tick"/>{text.guideLabel}</div>
        <button type="button" className="gys-wallet-guide__skip" onClick={onSkip} data-testid="wallet-setup-skip">{text.skip}</button>
      </header>
      <div className="gys-wallet-guide__progress-row">
        <div className="gys-wallet-guide__progress" role="progressbar" aria-label={text.progressLabel}
          aria-valuemin={1} aria-valuemax={WALLET_TOUR_STEPS.length} aria-valuenow={index + 1}
          aria-valuetext={`${index + 1}/${WALLET_TOUR_STEPS.length}: ${text.stepNames[step]}`}>
          {WALLET_TOUR_STEPS.map((item, position) => <span key={item} data-passed={position <= index}/>) }
        </div>
        <span className="gys-wallet-guide__count" aria-hidden="true">{index + 1}<span>/ {WALLET_TOUR_STEPS.length}</span></span>
      </div>
      <motion.div key={step} className="gys-wallet-guide__chapter"
        initial={reducedMotion || paused ? false : {opacity: 0, y: 10}}
        animate={{opacity: 1, y: 0}}
        transition={{duration: reducedMotion || paused ? 0 : .24, ease: [.22, 1, .36, 1]}}>
        <FeaturePreview step={step} language={language} text={text} verified={verified} named={hasNativeAddress}/>
        <div className="gys-wallet-guide__copy">
          <div className="gys-wallet-guide__heading">
            <p className="gys-wallet-guide__chapter-label">{text.stepNames[step]}</p>
            <h2 id={titleId}>{content.title}</h2>
          </div>
          <p className="gys-wallet-guide__description">{content.body}</p>
          {step === 'language' && <div className="gys-wallet-guide__language-choice"><LanguageSelect/></div>}
          {step !== 'language' && <p className="gys-wallet-guide__detail">
            {step === 'protect' && verified && <ShieldCheckIcon size="sm"/>}{detail}
          </p>}
        </div>
      </motion.div>
      <footer className="gys-wallet-guide__actions">
        {action && <PrimaryButton key="context" className="gys-wallet-guide__action" data-testid="wallet-setup-action" onClick={action.run}>{action.label}</PrimaryButton>}
        <PrimaryButton key="next" className="gys-wallet-guide__next" data-secondary={Boolean(action)}
          data-testid="wallet-setup-next" onClick={onNext}>
          <span>{step === WALLET_TOUR_STEPS[WALLET_TOUR_STEPS.length - 1] ? text.finish : text.next}</span>
          <ChevronRightIcon size="sm" className="rtl:rotate-180"/>
        </PrimaryButton>
      </footer>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{index + 1}/{WALLET_TOUR_STEPS.length}: {content.title}</p>
    </section>
  );
}
