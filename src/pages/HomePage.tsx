import {useId} from 'react';
type Props={onRestoreWallet:()=>void;onCreateNewWallet:()=>void;onCreateManualWallet:()=>void;onUsePasskey:()=>void;onCreatePasskey:()=>void;prfAvailable:boolean;setupIssue?:string|null};
export default function HomePage({onCreateNewWallet,onCreateManualWallet,onRestoreWallet,setupIssue}:Props){
 const errorId=useId();
 return <main className="gys-welcome">
  <div className="gys-welcome__aura" aria-hidden="true"/>
  <header className="gys-welcome__header" aria-label="GetYourSats">
    <img src="/assets/getyoursats-mark.jpg" width="36" height="36" alt="" className="gys-welcome__mark"/>
    <span className="gys-welcome__wordmark">GETYOURSATS</span>
    <span className="gys-welcome__header-note">BITCOIN WALLET</span>
  </header>
  <div className="gys-welcome__main">
    <div className="gys-welcome__halo" aria-hidden="true">
      <img src="/assets/getyoursats-mark.jpg" alt="" width="196" height="196"/>
    </div>
    <p className="gys-welcome__eyebrow">YOUR KEYS. YOUR BITCOIN.</p>
    <h1>Money, on your terms<span>.</span></h1>
    <p className="gys-welcome__subtitle">Pay in seconds. Save in Bitcoin.<br/>Keep control of what’s yours.</p>
    <div className="gys-welcome__rail" aria-label="Bitcoin and Lightning supported">
      <span><span className="gys-welcome__rail-dot"/> Lightning</span>
      <span className="gys-welcome__rail-divider" aria-hidden="true"/>
      <span>₿ Bitcoin</span>
    </div>
  </div>
  <section className="gys-welcome__actions" aria-label="Wallet setup">
    <button className="gys-welcome__start" type="button" onClick={onCreateNewWallet} aria-describedby={setupIssue?errorId:undefined}>
      <span>Start</span><span className="gys-welcome__start-arrow" aria-hidden="true">↗</span>
    </button>
    <button className="gys-welcome__restore" type="button" onClick={onRestoreWallet}>Already have a wallet? <strong>Restore</strong></button>
    {setupIssue&&<p id={errorId} role="alert" className="gys-welcome__error">{setupIssue}</p>}
    <div className="gys-welcome__subnav">
      <button type="button" onClick={onCreateManualWallet}>Advanced recovery setup</button>
      <span className="gys-welcome__subnav-dot" aria-hidden="true">·</span>
      <span>Private by design</span>
    </div>
  </section>
 </main>;
}
