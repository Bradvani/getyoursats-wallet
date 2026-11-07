import type {BreezSdk, FiatCurrency, Rate} from '@breeztech/breez-sdk-spark';

export type FiatRateSnapshot = {rates: Rate[]; fetchedAt: number};
export function boundedFiatRequest<T>(request: Promise<T>, milliseconds = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([request, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Fiat request timed out')), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

function checkedRates(value: unknown): Rate[] {
  if (!Array.isArray(value) || !value.length || value.length > 300) throw new Error('Invalid fiat rates');
  const seen = new Set<string>();
  for (const rate of value) {
    if (!rate || typeof rate.coin !== 'string' || !/^[A-Z]{3}$/.test(rate.coin) || seen.has(rate.coin)
      || typeof rate.value !== 'number' || !Number.isFinite(rate.value) || rate.value <= 0)
      throw new Error('Invalid fiat rates');
    seen.add(rate.coin);
  }
  return value;
}

export async function loadFiatRates(sdk: Pick<BreezSdk, 'listFiatRates'>): Promise<FiatRateSnapshot> {
  try {
    const result = await boundedFiatRequest(sdk.listFiatRates());
    return {rates: checkedRates(result.rates), fetchedAt: Date.now()};
  } catch { /* A separate public feed keeps indicative prices available. */ }
  const response = await fetch('/api/market-rates', {
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error('Fiat rates unavailable');
  const data = await response.json();
  const now = Date.now();
  if (data?.base !== 'BTC' || data.source !== 'coinbase' || !Number.isSafeInteger(data.fetchedAt)
    || data.fetchedAt > now + 30000 || now - data.fetchedAt > 120000)
    throw new Error('Stale fiat rates');
  return {rates: checkedRates(data.rates), fetchedAt: Math.min(now, data.fetchedAt)};
}

/** Fill display metadata locally when its independent SDK request is unavailable. */
export function currenciesForRates(rates: Rate[], known: FiatCurrency[]): FiatCurrency[] {
  const currencies = new Map(known.map(currency => [currency.id, currency]));
  const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], {type: 'currency'}) : null;
  for (const {coin} of rates) {
    if (currencies.has(coin)) continue;
    const formatter = new Intl.NumberFormat('en', {style: 'currency', currency: coin});
    currencies.set(coin, {id: coin, info: {
      name: names?.of(coin) ?? coin,
      fractionSize: formatter.resolvedOptions().maximumFractionDigits ?? 2,
      symbol: {grapheme: formatter.formatToParts(0).find(part => part.type === 'currency')?.value ?? coin},
      localizedName: [], localeOverrides: [],
    }});
  }
  return [...currencies.values()].sort((a, b) => a.id.localeCompare(b.id));
}
