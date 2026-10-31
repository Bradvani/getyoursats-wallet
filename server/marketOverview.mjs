const SUPPLY_URL = 'https://api.blockchain.info/stats';
const SENTIMENT_URL = 'https://api.alternative.me/fng/?limit=1';
const MAX_BYTES = 64 * 1024;
export const SUPPLY_MAX_AGE = 6 * 60 * 60 * 1000;
export const SENTIMENT_MAX_AGE = 48 * 60 * 60 * 1000;

async function readJson(url, fetchImpl) {
  const response = await fetchImpl(url, {headers: {Accept: 'application/json'},
    redirect: 'error', signal: AbortSignal.timeout(6000)});
  if (!response.ok || response.redirected || !response.body) throw new Error('Feed unavailable');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {await reader.cancel(); throw new Error('Feed too large');}
      chunks.push(Buffer.from(value));
    }
  } finally {reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function recent(timestamp, maxAge, now) {
  return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= now + 60000 && now - timestamp <= maxAge;
}

export function parseSupply(data, now) {
  if (!Number.isSafeInteger(data?.totalbc) || data.totalbc <= 0 || data.totalbc > 21e14 ||
    !recent(data.timestamp, SUPPLY_MAX_AGE, now)) throw new Error('Invalid supply');
  return {btc: data.totalbc / 1e8, updatedAt: data.timestamp, source: 'blockchain.com'};
}

const CLASSIFICATIONS = new Set(['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed']);
export function parseSentiment(data, now) {
  const point = data?.data?.[0];
  if (data?.metadata?.error || !point || typeof point.value !== 'string' || !/^\d{1,3}$/.test(point.value) ||
    typeof point.timestamp !== 'string' || !/^\d{10}$/.test(point.timestamp) ||
    !CLASSIFICATIONS.has(point.value_classification)) throw new Error('Invalid sentiment');
  const value = Number(point.value); const updatedAt = Number(point.timestamp) * 1000;
  if (value > 100 || !recent(updatedAt, SENTIMENT_MAX_AGE, now)) throw new Error('Invalid sentiment');
  return {value, classification: point.value_classification, updatedAt, source: 'alternative.me'};
}

/** Public market context only. No wallet identifiers or user-selected currency leave the app. */
export function createMarketOverviewHandler({fetchImpl = fetch, now = Date.now} = {}) {
  let cached; let cachedAt = 0; let inFlight;
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET'); res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 405; res.end(JSON.stringify({error: 'Method not allowed'})); return;
    }
    if (!cached || now() < cachedAt || now() - cachedAt > 300000) {
      inFlight ??= (async () => {
        const [supply, sentiment] = await Promise.allSettled([
          readJson(SUPPLY_URL, fetchImpl).then(data => parseSupply(data, now())),
          readJson(SENTIMENT_URL, fetchImpl).then(data => parseSentiment(data, now())),
        ]);
        cached = {supply: supply.status === 'fulfilled' ? supply.value : null,
          sentiment: sentiment.status === 'fulfilled' ? sentiment.value : null};
        cachedAt = now();
      })().finally(() => {inFlight = undefined;});
      await inFlight;
    }
    // Independent failures do not suppress the other feed or interfere with payment rates.
    const result = {
      supply: cached.supply && recent(cached.supply.updatedAt, SUPPLY_MAX_AGE, now()) ? cached.supply : null,
      sentiment: cached.sentiment && recent(cached.sentiment.updatedAt, SENTIMENT_MAX_AGE, now()) ? cached.sentiment : null,
    };
    const available = result.supply || result.sentiment;
    res.statusCode = available ? 200 : 503;
    res.setHeader('Cache-Control', available ? 'public, max-age=0, s-maxage=300' : 'no-store');
    res.end(JSON.stringify(result));
  };
}
