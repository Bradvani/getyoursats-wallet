import {useId} from 'react';
type Props={onRestoreWallet:()=>void;onCreateNewWallet:()=>void;onUsePasskey:()=>void;onCreatePasskey:()=>void;prfAvailable:boolean;setupIssue?:string|null};
export default function HomePage({onCreateNewWallet,onRestoreWallet,setupIssue}:Props){
 const errorId=useId();
 return <main className="gys-welcome">
  <div className="gys-welcome__aura" aria-hidden="true"/>
  <header className="gys-welcome__header" aria-label="GetYourSats">
    <img src="/assets/getyoursats-mark.jpg" width="34" height="34" alt="" className="gys-welcome__mark"/>
    <span className="gys-welcome__wordmark">GETYOURSATS</span>
  </header>
  <div className="gys-welcome__main">
    <div className="gys-welcome__emblem" aria-hidden="true"><img src="/assets/getyoursats-mark.jpg" alt="" width="140" height="140"/></div>
    <p className="gys-welcome__eyebrow">YOUR BITCOIN. YOUR KEYS.</p>
    <h1>Bitcoin, made simple.</h1>
    <p className="gys-welcome__subtitle">Pay anyone. Accept payments. Keep control.</p>
  </div>
  <section className="gys-welcome__actions" aria-label="Get started">
    <button className="gys-welcome__start" type="button" onClick={onCreateNewWallet} aria-describedby={setupIssue?errorId:undefined}>Start <span aria-hidden="true">↗</span></button>
    <button className="gys-welcome__restore" type="button" onClick={onRestoreWallet}>Restore existing wallet</button>
    {setupIssue&&<p id={errorId} role="alert" className="gys-welcome__error">{setupIssue}</p>}
    <p className="gys-welcome__footer">Self-custody by design <span aria-hidden="true">·</span> Powered by Bitcoin</p>
  </section>
 </main>;
}