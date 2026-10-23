import {useId, useState} from 'react';
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
  onCreateManualWallet,
  onRestoreWallet,
  setupIssue,
}: Props) {
  const errorId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <main className="gys-welcome">
      <div className="gys-welcome__atmosphere" aria-hidden="true"/>
      <header className="gys-welcome__header">
        <div className="gys-welcome__brand" aria-label="GetYourSats">
          <img src="/assets/getyoursats-mark.jpg" alt="" width={37} height={37}/>
          <span>GETYOURSATS</span>
        </div>
        <span className="gys-welcome__header-tag">BITCOIN · LIGHTNING</span>
      </header>

      <div className="gys-welcome__stage">
        <div className="gys-welcome__content">
          <div className="gys-welcome__eyebrow"><span aria-hidden="true"/> YOUR BITCOIN. YOUR CALL.</div>
          <h1>Bitcoin, <em>on your terms.</em></h1>
          <p className="gys-welcome__subtitle">One place to send, receive and accept Bitcoin with Lightning.</p>

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
            <div className="gys-welcome__secondary">
              <button type="button" aria-expanded={advancedOpen}
                aria-label="More recovery options" aria-controls="gys-welcome-advanced"
                onClick={() => setAdvancedOpen(!advancedOpen)}>
                More recovery options
                <span className={advancedOpen ? 'gys-welcome__chevron gys-welcome__chevron--up' : 'gys-welcome__chevron'} aria-hidden="true">⌄</span>
              </button>
              {advancedOpen && (
                <div id="gys-welcome-advanced">
                  <button type="button" className="gys-welcome__manual" onClick={onCreateManualWallet}>
                    Set up with an offline recovery phrase
                  </button>
                </div>
              )}
            </div>
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
            <span>Built for ownership</span>
          </div>
        </div>
      </div>

      <footer className="gys-welcome__footer">
        <span>NO ACCOUNT TO GET STARTED</span>
        <span>BITCOIN FIRST. ALWAYS.</span>
      </footer>
    </main>
  );
}
