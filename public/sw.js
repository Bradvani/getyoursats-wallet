const CACHE_PREFIX = 'getyoursats-static-';
const CACHE_NAME = CACHE_PREFIX + '__GETYOURSATS_RELEASE__';
const LEGACY_CACHES = new Set(['getyoursats-brand-v4', 'getyoursats-brand-v5']);
const MAX_ENTRIES = 192;
const STATIC_ASSETS = [
  '/', '/index.html', '/manifest.json', '/theme-bootstrap.js',
  '/brand/wordmark-stacked-dark.svg', '/brand/wordmark-horizontal-dark.svg',
  '/brand/wordmark-stacked-light.svg', '/brand/wordmark-horizontal-light.svg',
  '/brand/wordmark-top.svg', '/brand/wordmark-bottom.svg', '/brand/wordmark-coin.svg',
  '/brand/wordmark-top-light.svg', '/brand/wordmark-bottom-light.svg',
  '/brand/wordmark-3d-transparent.png', '/brand/app-icon.svg', '/brand/monogram.svg',
  '/brand/favicon-48.png', '/brand/app-icon-180.png', '/brand/app-icon-192.png', '/brand/app-icon-512.png',
];
const ownedCache = (name) => name.startsWith(CACHE_PREFIX) || LEGACY_CACHES.has(name);
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


/**
 * Web Push display layer only. The subscribing UI and authenticated delivery
 * endpoint must be shipped separately before this feature can be activated.
 * No balance, seed, invoice, contact information or payment proof belongs in
 * the notification. The wallet rechecks actual settlement after opening.
 */
self.addEventListener('push', (event) => {
  let message = null;
  try {
    message = event.data ? event.data.json() : null;
  } catch {
    // Always present a visible fallback: iOS Home Screen Web Push requires it.
  }
  // The backend must authorize the wallet, verify payment settlement and
  // enforce the independent marketing opt-in before sending a Web Push event.
  // This worker never trusts caller-supplied text, amount, destination or URL.
  const copyByType = {
    'gys.payment.received': {
      title: 'Payment received ⚡',
      body: 'Bitcoin received. Open GetYourSats for details.',
    },
    'gys.dca.purchase.settled': {
      title: 'Your stack just grew',
      body: 'Your scheduled Bitcoin purchase is complete. View your receipt.',
    },
    'gys.dca.purchase.failed': {
      title: 'Scheduled purchase needs attention',
      body: 'Your scheduled Bitcoin purchase did not complete. Review your plan.',
    },
    'gys.onramp.purchase.processing': {
      title: 'Bitcoin purchase processing',
      body: 'Your purchase is still processing. Check its current status.',
    },
    'gys.onramp.purchase.settled': {
      title: 'Bitcoin purchase delivered',
      body: 'Your Bitcoin has arrived. Open your wallet to verify the receipt.',
    },
    'gys.onramp.availability': {
      title: 'More ways to stack sats',
      body: 'Explore available Bitcoin purchase options and fees.',
    },
  };
  // PWA Lightning notifications are delivered as *empty encrypted-data-free*
  // pushes: the push service authenticates the VAPID sender while the server
  // validates the settled Lightning webhook. The empty payload prevents
  // sensitive wallet/payment identifiers entering any push relay.
  const type = !event.data ? 'gys.payment.received'
    : message && message.version === 1 && typeof message.type === 'string'
    && Object.prototype.hasOwnProperty.call(copyByType, message.type)
      ? message.type : null;
  const copy = type ? copyByType[type] : {
    title: 'GetYourSats',
    body: 'Wallet activity. Open GetYourSats to review.',
  };
  const id = type && message && typeof message.id === 'string'
    && /^[a-zA-Z0-9_-]{1,80}$/.test(message.id) ? message.id : null;
  const options = {
    body: copy.body,
    icon: '/brand/app-icon-192.png',
    badge: '/brand/app-icon-192.png',
    data: { path: '/' },
  };
  if (id) options.tag = type + ':' + id;
  event.waitUntil(self.registration.showNotification(copy.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Ignore all payload URLs; only the canonical wallet origin can be opened.
  event.waitUntil((async () => {
    const home = new URL('/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin
          && typeof client.focus === 'function';
      } catch {
        return false;
      }
    });
    if (existing) return existing.focus();
    if (typeof self.clients.openWindow === 'function') return self.clients.openWindow(home);
    return undefined;
  })());
});
