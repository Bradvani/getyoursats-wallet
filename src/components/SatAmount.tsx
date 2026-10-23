import React from 'react';
import { formatWithSpaces } from '../utils/formatNumber';

/**
 * A sat amount: space-grouped thousands with the correct satoshi unit.
 *
 * Owns the mono font together with the `word-spacing` that corrects it. Mono
 * gives a space a full character cell, and -0.4em is calibrated against that,
 * so a caller must never be able to set one without the other. Inherits its
 * size, so wrap it to scale.
 *
 * The wallet balance header handles the BTC symbol only for actual BTC units.
 */
export const SatAmount: React.FC<{
  sats: number | bigint;
  className?: string;
  /**
   * Marks an estimate with "~". It hangs outside the box,
   * so a centred amount stays centred on its digits.
   */
  approximate?: boolean;
}> = ({ sats, className = '', approximate = false }) => (
  <span className={`inline-flex items-center font-mono [word-spacing:-0.4em] ${approximate ? 'relative' : ''} ${className}`}>
    {approximate && <span className="absolute right-full opacity-70">~</span>}
    {formatWithSpaces(sats)}
    <span className="text-[0.8em] opacity-70 ml-1">{' '}sats</span>
  </span>
);

export default SatAmount;
