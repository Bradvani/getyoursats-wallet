/** Bitcoin price equivalents shown in the market widget only.
 * These are NOT wallet balance or payment-denomination inputs.
 * Each value represents an exact integer number of satoshis.
 */
export const MARKET_QUOTE_UNITS = [
  { id: 'btc', label: '1 BTC', satoshis: 100_000_000, fullLabel: '1 Bitcoin' },
  { id: '1k', label: '1K sats', satoshis: 1_000, fullLabel: '1,000 satoshis' },
  { id: '10k', label: '10K sats', satoshis: 10_000, fullLabel: '10,000 satoshis' },
  { id: '100k', label: '100K sats', satoshis: 100_000, fullLabel: '100,000 satoshis' },
  { id: '1m', label: '1M sats', satoshis: 1_000_000, fullLabel: '1,000,000 satoshis' },
  { id: '10m', label: '10M sats', satoshis: 10_000_000, fullLabel: '10,000,000 satoshis' },
] as const;

export type MarketQuoteUnitId = typeof MARKET_QUOTE_UNITS[number]['id'];

/** Rate is indicative fiat per whole BTC as supplied by the SDK. */
export function marketFiatValue(
  fiatPerBtc: number | null | undefined,
  satoshis: number,
): number | null {
  if (fiatPerBtc == null || !Number.isFinite(fiatPerBtc) || fiatPerBtc <= 0 ||
      !Number.isSafeInteger(satoshis) || satoshis <= 0) return null;
  return fiatPerBtc * (satoshis / 100_000_000);
}

export function formatMarketFiat(
  fiatPerBtc: number | null | undefined,
  currency: string,
  satoshis: number,
  locale?: string,
): string {
  const value = marketFiatValue(fiatPerBtc, satoshis);
  if (value === null) return 'Rate unavailable';
  try {
    const fraction = new Intl.NumberFormat(locale, { style: 'currency', currency })
      .resolvedOptions().minimumFractionDigits ?? 2;
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, minimumFractionDigits: fraction,
      maximumFractionDigits: Math.max(fraction, satoshis >= 100_000_000 ? 2 : 4),
    }).format(value);
  } catch {
    return currency + ' ' + value.toFixed(satoshis >= 100_000_000 ? 2 : 4);
  }
}
