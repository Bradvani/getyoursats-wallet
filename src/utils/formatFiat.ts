const formatters = new Map<string, Intl.NumberFormat>();
const locales = new Map<string, string>();

/** Currency region controls grouping; shared currencies retain a suitable language variant. */
export function fiatLocale(currency: string, language = 'en'): string {
  const base = language.split('-')[0];
  const key = `${currency}:${base}`;
  const cached = locales.get(key);
  if (cached) return cached;
  const shared: Record<string, string> = {
    INR: 'en-IN', USD: 'en-US',
    EUR: ({en: 'en-IE', es: 'es-ES', pt: 'pt-PT', fr: 'fr-FR', it: 'it-IT', nl: 'nl-NL'} as Record<string, string>)[base] ?? 'de-DE',
    CHF: base === 'fr' ? 'fr-CH' : base === 'it' ? 'it-CH' : 'de-CH',
    CAD: base === 'fr' ? 'fr-CA' : 'en-CA',
    XAF: 'fr-CM', XOF: 'fr-SN', XPF: 'fr-PF', XCD: 'en-AG', XCG: 'nl-CW', ANG: 'nl-CW',
  };
  let locale = shared[currency];
  if (!locale) {
    try {
      const region = currency.slice(0, 2);
      const knownRegion = new Intl.DisplayNames('en', {type: 'region', fallback: 'none'}).of(region);
      locale = knownRegion ? new Intl.Locale(`und-${region}`).maximize().toString() : 'en-US';
    } catch { locale = 'en-US'; }
  }
  if (locales.size >= 256) locales.clear();
  locales.set(key, locale);
  return locale;
}

/** INR uses lakh/crore grouping across device locales. These are display values only. */
export function formatFiat(value: number, currency: string, language = 'en', options: {
  numberOnly?: boolean;
  maximumFractionDigits?: number;
} = {}): string {
  if (!Number.isFinite(value)) return '';
  const locale = fiatLocale(currency, language);
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
