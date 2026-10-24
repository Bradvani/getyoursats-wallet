import BrandIntro from '../components/BrandIntro';
import GetYourSatsWordmark from '../components/GetYourSatsWordmark';
import {useId} from 'react';
import {ChevronRightIcon} from '../components/Icons';

type Props = {
  onRestoreWallet: () => void;
  onCreateNewWallet: () => void;
  onCreateManualWallet: () => void;
  onUsePasskey: () => void;
  onCreatePasskey: () => void;
  prfAvailable: boolean;
  setupIssue?: string | null;
};

export default function HomePage({
  onCreateNewWallet,
  onRestoreWallet,
  setupIssue,
}: Props) {
  const errorId = useId();

  return (
    <main className="gys-welcome">
      <BrandIntro />
      <div className="gys-welcome__atmosphere" aria-hidden="true"/>
      <header className="gys-welcome__header">
        <div className="gys-welcome__brand"><GetYourSatsWordmark landing /></div>
        <span className="gys-welcome__header-tag">BITCOIN · LIGHTNING</span>
      </header>

      <div className="gys-welcome__stage">
        <div className="gys-welcome__content">
          <div className="gys-welcome__eyebrow"><span aria-hidden="true"/> BUILT FOR BITCOIN OWNERSHIP</div>
          <h1>Own your Bitcoin. <em>Move at lightning speed.</em></h1>
          <p className="gys-welcome__subtitle">Send, receive and accept Bitcoin with Lightning. Simple by design, self-custodial by default.</p>

          <div className="gys-welcome__actions" aria-label="Wallet setup">
            <button className="gys-welcome__start" type="button" onClick={onCreateNewWallet}
              aria-describedby={setupIssue ? errorId : undefined}>
              <span>Start</span>
              <ChevronRightIcon size="lg" />
            </button>
            <button className="gys-welcome__restore" type="button" onClick={onRestoreWallet}
              aria-label="Restore existing wallet">
              Already have a wallet? <strong>Restore it <span aria-hidden="true">↗</span></strong>
            </button>
            <p className="gys-welcome__passkey-explainer">
              Start creates a wallet with a device passkey where supported. Your device may ask for Face ID, fingerprint or screen lock.
              An offline backup is available later in Settings.
            </p>
            {setupIssue && (
              <div id={errorId} role="alert" className="gys-welcome__error">{setupIssue}</div>
            )}
          </div>
        </div>
        <div className="gys-welcome__visual" aria-hidden="true">
          <div className="gys-welcome__halo">
            <div className="gys-welcome__halo-outer"/>
            <div className="gys-welcome__halo-inner"/>
            <div className="gys-welcome__coin">
              <img src="/assets/getyoursats-mark.jpg" width={240} height={240} alt=""/>
            </div>
            <span className="gys-welcome__orbit-dot gys-welcome__orbit-dot--one"/>
            <span className="gys-welcome__orbit-dot gys-welcome__orbit-dot--two"/>
          </div>
          <div className="gys-welcome__visual-caption">
            <span className="gys-welcome__caption-line"/>
            <span>Ownership in motion</span>
          </div>
        </div>
      </div>

      <footer className="gys-welcome__footer">
        <span>NO ACCOUNT TO GET STARTED</span>
        <span>YOUR WALLET. YOUR WAY.</span>
      </footer>
    </main>
  );
}
