import { useEffect, useState } from 'react';
import './premiumMotion.css';

/** Decorative, non-blocking intro. Never gates wallet access or onboarding. */
export default function BrandIntro() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setDone(true); return; }
    const timer = window.setTimeout(() => setDone(true), 2350);
    return () => window.clearTimeout(timer);
  }, []);
  if (done) return null;
  return <div className="gys-cinematic-intro" aria-hidden="true">
    <div className="gys-cinematic-intro__lockup">
      <div className="gys-cinematic-intro__top"><span className="gys-cinematic-intro__typed">gety<span className="gys-cinematic-intro__coin">₿</span>ur</span></div>
      <div className="gys-cinematic-intro__bottom">sats</div>
      <div className="gys-cinematic-intro__stroke"/>
    </div>
    <div className="gys-cinematic-intro__flash"/>
  </div>;
}
