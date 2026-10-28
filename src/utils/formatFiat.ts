const LOCALES: Record<string, string> = {
  en: 'en-US', hi: 'hi-IN', es: 'es-ES', pt: 'pt-PT', ja: 'ja-JP',
  th: 'th-TH', vi: 'vi-VN', ta: 'ta-IN', ar: 'ar', 'zh-CN': 'zh-CN',
};
const formatters = new Map<string, Intl.NumberFormat>();

/** INR uses lakh/crore grouping across device locales. These are display values only. */
export function formatFiat(value: number, currency: string, language = 'en', options: {
  numberOnly?: boolean;
  maximumFractionDigits?: number;
} = {}): string {
  if (!Number.isFinite(value)) return '';
  const locale = currency === 'INR' ? 'en-IN' : LOCALES[language] ?? language;
  try {
    const key = JSON.stringify([locale, currency, !!options.numberOnly, options.maximumFractionDigits]);
    let formatter = formatters.get(key);
    if (!formatter) {
      const minimumFractionDigits = new Intl.NumberFormat('en', {style: 'currency', currency})
        .resolvedOptions().minimumFractionDigits ?? 2;
      formatter = new Intl.NumberFormat(locale, {
        style: options.numberOnly ? 'decimal' : 'currency', currency,
        numberingSystem: 'latn', minimumFractionDigits,
        maximumFractionDigits: Math.max(minimumFractionDigits, options.maximumFractionDigits ?? minimumFractionDigits),
      });
      if (formatters.size >= 48) formatters.delete(formatters.keys().next().value!);
      formatters.set(key, formatter);
    }
    return formatter.format(value);
  } catch {
    return `${options.numberOnly ? '' : currency + ' '}${value.toFixed(2)}`;
  }
}

export const FIAT_ESTIMATE_MAX_AGE_MS = 120_000;

export function fiatEstimateValue(sats: number | bigint, rate: number | undefined,
  fetchedAt: number | undefined, now: number): {value: number | null; stale: boolean} {
  const amount = Number(sats);
  if (!Number.isSafeInteger(amount) || amount < 0 || !rate || !Number.isFinite(rate) || rate <= 0 ||
    !fetchedAt || !Number.isFinite(fetchedAt)) return {value: null, stale: false};
  if (now - fetchedAt > FIAT_ESTIMATE_MAX_AGE_MS || now < fetchedAt) return {value: null, stale: true};
  const value = amount / 100_000_000 * rate;
  return {value: Number.isFinite(value) ? value : null, stale: false};
}
