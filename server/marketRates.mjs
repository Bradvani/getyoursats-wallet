const SOURCE = 'https://api.coinbase.com/v2/exchange-rates?currency=BTC';
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const MAX_BYTES = 128 * 1024;

/** Public indicative rates only. No wallet, order or identity data is sent. */
export async function fetchMarketRates(fetchImpl = fetch, now = Date.now) {
  const response = await fetchImpl(SOURCE, {
    headers: {Accept: 'application/json'}, redirect: 'error',
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok || response.redirected || !response.body) throw new Error('Market feed unavailable');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {await reader.cancel(); throw new Error('Market feed too large');}
      chunks.push(Buffer.from(value));
    }
  } finally {reader.releaseLock();}
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.data;
  if (data?.currency !== 'BTC' || !data.rates || typeof data.rates !== 'object' || Array.isArray(data.rates))
    throw new Error('Invalid market feed');
  const rates = Object.entries(data.rates).flatMap(([coin, raw]) => {
    if (!CURRENCIES.has(coin) || typeof raw !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return [];
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 && value < Number.MAX_SAFE_INTEGER ? [{coin, value}] : [];
  }).sort((a, b) => a.coin.localeCompare(b.coin));
  if (!rates.some(rate => rate.coin === 'USD')) throw new Error('Invalid market feed');
  const fetchedAt = now();
  const age = response.headers.get('age');
  if (age !== null && (!/^\d+$/.test(age) || Number(age) > 90)) throw new Error('Stale market feed');
  // Preserve upstream cache age instead of stamping cached data as newly priced.
  return {base: 'BTC', source: 'coinbase', fetchedAt: fetchedAt - Number(age || 0) * 1000, rates};
}

export function createMarketRatesHandler({fetchImpl = fetch, now = Date.now} = {}) {
  let cached; let inFlight;
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET'); res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 405; res.end(JSON.stringify({error: 'Method not allowed'})); return;
    }
    try {
      if (!cached || now() < cached.fetchedAt || now() - cached.fetchedAt > 20000) {
        inFlight ??= fetchMarketRates(fetchImpl, now).then(result => {cached = result; return result;})
          .finally(() => {inFlight = undefined;});
        await inFlight;
      }
      res.statusCode = 200;
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
      res.end(JSON.stringify(cached));
    } catch {
      res.statusCode = 503; res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({error: 'Market rates temporarily unavailable'}));
    }
  };
}
