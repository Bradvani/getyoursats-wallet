const CACHE_PREFIX = 'getyoursats-static-';
const CACHE_NAME = CACHE_PREFIX + '__GETYOURSATS_RELEASE__';
const LEGACY_CACHE = 'getyoursats-brand-v4';
const MAX_ENTRIES = 192;
const STATIC_ASSETS = [
  '/', '/index.html', '/manifest.json',
  '/brand/wordmark-stacked-dark.svg', '/brand/wordmark-horizontal-dark.svg',
  '/brand/favicon-48.png', '/brand/app-icon-192.png', '/brand/app-icon-512.png',
];
const ownedCache = (name) => name.startsWith(CACHE_PREFIX) || name === LEGACY_CACHE;
const isHashedAsset = (path) => /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|mjs|css|wasm|woff2?|ttf)$/.test(path);
const canCache = (response) => response.status === 200 && response.type !== 'opaque'
  && !/(?:^|,)\s*(?:no-store|private)(?:\s*(?:=|,|$))/i.test(response.headers.get('Cache-Control') || '');
let cacheWrites = Promise.resolve();

async function trim(cache) {
  const entries = await cache.keys();
  const removable = entries.filter((entry) => !STATIC_ASSETS.includes(new URL(entry.url).pathname));
  // Font churn must not evict the code needed to reopen the wallet offline.
  removable.sort((a, b) => Number(/\.(?:js|mjs|css|wasm)$/.test(new URL(a.url).pathname))
    - Number(/\.(?:js|mjs|css|wasm)$/.test(new URL(b.url).pathname)));
  const excess = Math.max(0, entries.length - MAX_ENTRIES);
  await Promise.all(removable.slice(0, excess).map((entry) => cache.delete(entry)));
}

function remember(request, response) {
  if (!canCache(response)) return Promise.resolve();
  cacheWrites = cacheWrites.catch(() => {}).then(async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
    await trim(cache);
  });
  return cacheWrites.catch(() => {});
}

async function cached(request) {
  const current = await caches.open(CACHE_NAME);
  const response = await current.match(request);
  if (response && canCache(response)) return response;
  const previous = (await caches.keys()).filter((name) => ownedCache(name) && name !== CACHE_NAME);
  for (const name of previous.reverse()) {
    const match = await (await caches.open(name)).match(request);
    if (match && canCache(match)) return match;
  }
  return undefined;
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all(STATIC_ASSETS.map(async (path) => {
    const response = await fetch(new URL(path, self.location.origin).href, { cache: 'reload' });
    if (!response.ok) throw new Error('Offline assets unavailable');
    await remember(new URL(path, self.location.origin).href, response);
  })));
  // A replacement waits until all tabs using the previous worker have closed.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = (await caches.keys()).filter(ownedCache);
    const previous = names.filter((name) => name !== CACHE_NAME).at(-1);
    await Promise.all(names.filter((name) => name !== CACHE_NAME && name !== previous)
      .map((name) => caches.delete(name)));
    for (const name of [CACHE_NAME, previous].filter(Boolean)) {
      const cache = await caches.open(name);
      for (const entry of await cache.keys()) {
        const url = new URL(entry.url);
        const response = await cache.match(entry);
        if (url.origin !== self.location.origin || url.search || !response || !canCache(response)
          || (!STATIC_ASSETS.includes(url.pathname) && !isHashedAsset(url.pathname))) {
          await cache.delete(entry);
        }
      }
      await trim(cache);
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.cache === 'no-store' || request.headers.has('Authorization')) return;
  if (/^\/(api|lnurlp|lnurlpay)(\/|$)/.test(url.pathname) || url.pathname.startsWith('/.well-known/')) return;

  const hashedAsset = isHashedAsset(url.pathname);
  const navigation = request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname);
  if (!hashedAsset && !navigation && !STATIC_ASSETS.includes(url.pathname)) return;
  if (url.search && !navigation) return;
  const cacheKey = new URL(navigation ? '/index.html' : url.pathname, self.location.origin).href;

  const result = (async () => {
    if (hashedAsset) {
      const response = await cached(cacheKey);
      if (response) return { response };
    }
    try {
      const response = await fetch(request);
      const cacheable = !url.search && canCache(response)
        && (!navigation || response.headers.get('Content-Type')?.includes('text/html'));
      return { response, copy: cacheable ? response.clone() : undefined };
    } catch {
      return { response: (await cached(cacheKey)) || new Response('Offline', { status: 503 }) };
    }
  })();
  event.respondWith(result.then(({ response }) => response));
  event.waitUntil(result.then(({ copy }) => copy ? remember(cacheKey, copy) : undefined));
});
