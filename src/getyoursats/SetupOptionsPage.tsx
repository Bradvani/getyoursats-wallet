type Props = {
  stableOrigin: boolean;
  onBack: () => void;
  onOfflineSetup: () => void;
};
/** No keys are generated and no seed words are revealed on this screen. */
export default function SetupOptionsPage({stableOrigin,onBack,onOfflineSetup}:Props){
  return <main className="gys-setup">
    <button type="button" className="gys-setup__back" onClick={onBack}>← Back</button>
    <section className="gys-setup__body">
      <img className="gys-setup__mark" src="/assets/getyoursats-mark.jpg" alt="" />
      <span className="gys-setup__eyebrow">SECURE WALLET SETUP</span>
      <h1>{stableOrigin?'Choose your recovery method.':'Continue on our secure wallet domain.'}</h1>
      <p>{stableOrigin
        ?'This browser cannot create a recoverable passkey wallet on this device. You can still choose a handwritten, offline recovery backup.'
        :'This deployment link changes with each build. For a wallet that can be recovered later, use our permanent beta address instead.'}</p>
      <div className="gys-setup__actions">
        {!stableOrigin && <a className="gys-setup__primary" href="https://beta.getyoursats.com">Open GetYourSats beta ↗</a>}
        <button type="button" className="gys-setup__secondary" onClick={onOfflineSetup}>
          Set up with offline recovery
        </button>
      </div>
    </section>
  </main>;
}
