import React from 'react';
import {usePresentation} from '../../hooks/usePresentation';
import {PAYMENT_EXPERIENCE} from '../../locales/paymentExperience';
import { ChainLinkIcon, LightningBoltIcon } from '../../components/Icons';

export type BtcMode = 'lightning' | 'bitcoin';

const LABEL: Record<BtcMode, string> = { lightning: 'Lightning', bitcoin: 'Bitcoin' };
const other = (mode: BtcMode): BtcMode => (mode === 'lightning' ? 'bitcoin' : 'lightning');

/**
 * Lightning / on-chain switch docked left of the receive QR. Each half of
 * the 44 x 90 dock is a 44 px target; the gold thumb slides between them.
 * The test ids keep the old tab ids so e2e flows still pick a format.
 */
export const SideDock: React.FC<{ mode: BtcMode; onChange: (mode: BtcMode) => void }> = ({ mode, onChange }) => (
  <div className="relative h-[90px] w-[44px] rounded-[22px] border border-spark-border bg-spark-dark/50">
    <div
      aria-hidden="true"
      className={`absolute left-[3px] top-[4px] size-[36px] rounded-full bg-spark-primary shadow-[0_0_16px_var(--glow-primary)] transition-transform duration-[320ms] ease-m3-emphasized motion-reduce:transition-none ${mode === 'bitcoin' ? 'translate-y-[44px]' : ''}`}
    />
    {(['lightning', 'bitcoin'] as const).map((m) => (
      <button
        key={m}
        type="button"
        onClick={() => onChange(m)}
        aria-label={LABEL[m]}
        aria-pressed={mode === m}
        data-testid={m === 'lightning' ? 'lightning-tab' : 'bitcoin-tab'}
        className={`relative flex h-[44px] w-full [&>svg]:size-[20px] items-center justify-center rounded-[22px] outline-none transition-colors duration-[320ms] focus-visible:ring-2 focus-visible:ring-spark-primary/60 ${mode === m ? 'text-black' : 'text-spark-text-muted'}`}
      >
        {m === 'lightning' ? <LightningBoltIcon size="sm" /> : <ChainLinkIcon size="sm" />}
      </button>
    ))}
  </div>
);

/**
 * Names the code on screen. The margin switches too, with no visual cue:
 * the dock stays the one visible control. The negative end margin cancels the
 * trailing letter-spacing, so the middle letter sits level with the dock's middle.
 */
export const SideCaption: React.FC<{ shown: BtcMode; mode: BtcMode; onChange: (mode: BtcMode) => void }> = ({ shown, mode, onChange }) => {
  const {language} = usePresentation();
  const text = PAYMENT_EXPERIENCE[language];
  return (
  <button
    type="button"
    onClick={() => onChange(other(mode))}
    aria-label={other(mode) === 'bitcoin' ? text.switchBitcoin : text.switchLightning}
    className="gys-receive-side-caption flex w-11 items-center justify-center self-stretch rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-spark-primary/60"
  >
    <span className="-mb-[0.1em] text-spark-text-muted text-xs font-display font-medium tracking-widest uppercase [writing-mode:vertical-rl]">
      {LABEL[shown]}
    </span>
  </button>
);
};
