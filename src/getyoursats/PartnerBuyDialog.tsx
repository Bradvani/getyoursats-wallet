import {useState} from 'react';
import type {Network} from '@breeztech/breez-sdk-spark';
import {openExternalUrl} from '../utils/externalLink';
import {onramperAvailable,onramperBuyUrl} from './onramperCheckout';

interface Props {
  onClose: () => void;
  network?: Network;
}

/** Honest third-party checkout disclosure: no misleading direct-to-wallet claim. */
export default function PartnerBuyDialog({onClose,network}:Props) {
  const [acknowledged,setAcknowledged] = useState(false);
  const key = import.meta.env.VITE_ONRAMPER_API_KEY;
  const ready = onramperAvailable(import.meta.env.VITE_GETYOURSATS_ONRAMPER_ENABLED,key,network);
  const checkout = ready ? onramperBuyUrl(key) : null;
  return <div role="dialog" aria-modal="true" aria-label="Buy Bitcoin through partner"
    className="gys-partner-buy-overlay">
    <section className="gys-partner-buy">
      <header className="gys-partner-buy__header">
        <div>
          <small>GETYOURSATS · THIRD-PARTY PARTNER</small>
          <h2>Buy Bitcoin</h2>
        </div>
        <button type="button" aria-label="Close buy Bitcoin" onClick={onClose}>✕</button>
      </header>
      <p className="gys-partner-buy__lead">
        Compare available payment options with Onramper. The payment provider,
        not GetYourSats, handles the purchase, identity checks, payment methods and fees.
      </p>
      {ready ? <>
        <div className="gys-partner-buy__safety">
          <strong>Check the destination before paying.</strong>
          <p>
            Our wallet uses Breez Spark. Onramper's Bitcoin checkout requires a
            compatible <b>Bitcoin on-chain receiving address</b> — a Lightning
            address or Lightning invoice is not a Bitcoin deposit address.
            Open Receive, confirm a current supported Bitcoin deposit address,
            its minimums and fees, then independently verify every detail at checkout.
          </p>
        </div>
        <label className="gys-partner-buy__check">
          <input type="checkbox" checked={acknowledged}
            onChange={e=>setAcknowledged(e.target.checked)}/>
          <span>I understand this is external checkout, and GetYourSats will not automatically fill or validate my destination.</span>
        </label>
        <button type="button" className="gys-partner-buy__primary" disabled={!acknowledged}
          onClick={() => { if(checkout) void openExternalUrl(checkout); }}>
          Continue to Onramper ↗
        </button>
      </> : <div className="gys-partner-buy__safety">
        <strong>Partner checkout isn't active yet.</strong>
        <p>
          We need an approved Onramper partner integration, verified BTC
          destination compatibility and country-specific purchase checks
          before enabling it. You can still send and receive Lightning payments now.
        </p>
      </div>}
      <p className="gys-partner-buy__disclaimer">
        No purchase is completed or recorded as paid in GetYourSats from opening this window.
        Partner availability and INR/UPI support vary by provider and location.
      </p>
    </section>
  </div>;
}
