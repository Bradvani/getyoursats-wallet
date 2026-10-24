import { useEffect, useState } from 'react';
import './premiumMotion.css';
import { BrandLightningIcon } from './Icons';

/** Decorative, nonblocking reveal. All layers share the production SVG geometry. */
export default function BrandIntro({ inline = false }: { inline?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDone(true), 2200);
    return () => window.clearTimeout(timer);
  }, []);
  if (done && !inline) return null;
  return <div className={inline ? 'gys-brand-reveal gys-brand-reveal--inline' : 'gys-brand-reveal'} aria-hidden="true">
    <div className="gys-brand-reveal__art">
      <img className="gys-brand-reveal__top" src="/brand/wordmark-top.svg" alt="" />
      <img className="gys-brand-reveal__sats" src="/brand/wordmark-bottom.svg" alt="" />
      <BrandLightningIcon />
      <img className="gys-brand-reveal__coin" src="/brand/wordmark-coin.svg" alt="" />
    </div>
  </div>;
}
