import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const origin = 'https://wallet.example.test';
const template = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const currentCache = 'getyoursats-static-policy-test';
const address = key => typeof key === 'string' ? new URL(key, origin).href : key.url;

function harness() {
  const stores = new Map();
  const listeners = new Map();
  const calls = {skipWaiting: 0, claim: 0, deleteDatabase: 0, fetch: []};
  let fetchResponse = request => Promise.resolve(new Response(address(request).endsWith('/index.html') ? '<html>Wallet</html>' : 'public asset', {
    headers: {'Content-Type': address(request).endsWith('/index.html') ? 'text/html' : 'application/javascript'},
  }));
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const items = stores.get(name);
      return {
        async put(key, response) { items.set(address(key), response.clone()); },
        async match(key) { return items.get(address(key))?.clone(); },
        async delete(key) { return items.delete(address(key)); },
        async keys() { return [...items.keys()].map(url => new Request(url)); },
        async addAll(paths) {
          for (const path of paths) items.set(address(path), new Response(path === '/index.html' || path === '/' ? '<html>Wallet</html>' : 'static', {
            headers: {'Content-Type': path === '/index.html' || path === '/' ? 'text/html' : 'image/svg+xml'},
          }));
        },
      };
    },
  };
  const context = vm.createContext({
    self: {
      location: {origin},
      addEventListener(name, callback) { listeners.set(name, callback); },
      skipWaiting() { calls.skipWaiting++; },
      clients: {claim() { calls.claim++; }},
    },
    caches, URL, Request, Response, Headers,
    indexedDB: {deleteDatabase() { calls.deleteDatabase++; }},
    fetch(request) { calls.fetch.push(request); return fetchResponse(request); },
  });
  vm.runInContext(template.replace('__GETYOURSATS_RELEASE__', 'policy-test'), context);
  return {
    stores, caches, calls,
    network(implementation) { fetchResponse = implementation; },
    async lifecycle(name) {
      const pending = [];
      listeners.get(name)({waitUntil(promise) { pending.push(promise); }});
      await Promise.all(pending);
    },
    async request(path, options = {}) {
      const pending = [];
      let response;
      const request = {url: address(path), method: 'GET', mode: 'cors', cache: 'default', headers: new Headers(), ...options};
      listeners.get('fetch')({request,
        respondWith(promise) { response = promise; },
        waitUntil(promise) { pending.push(promise); },
      });
      const resolved = await response;
      await Promise.all(pending);
      return resolved;
    },
  };
}

test('replacement waits for existing clients and retains only two owned release caches', async () => {
  const worker = harness();
  for (const name of ['unrelated-store', 'getyoursats-brand-v4', 'getyoursats-brand-v5', 'getyoursats-static-old-a', 'getyoursats-static-old-b']) {
    await (await worker.caches.open(name)).put('/assets/app-old12345.js', new Response(name));
  }
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  assert.equal(worker.calls.skipWaiting, 0);
  assert.equal(worker.calls.claim, 0);
  assert.equal(worker.calls.deleteDatabase, 0);
  assert.deepEqual(await worker.caches.keys(), ['unrelated-store', 'getyoursats-static-old-b', currentCache]);
  assert.equal(await (await worker.caches.open('unrelated-store')).match('/assets/app-old12345.js').then(r => r.text()), 'unrelated-store');
});

test('activation purges API and query keys only from owned caches', async () => {
  const worker = harness();
  const old = await worker.caches.open('getyoursats-static-old');
  await old.put('/api/private', new Response('private fixture'));
  await old.put('/brand/app-icon-192.png?session=disposable', new Response('query fixture'));
  await old.put('/assets/previous-12345678.js', new Response('previous public asset'));
  await old.put('https://other.example.test/assets/foreign-12345678.js', new Response('foreign fixture'));
  await old.put('/assets/private-12345678.js', new Response('private fixture', {headers: {'Cache-Control': 'private'}}));
  const unrelated = await worker.caches.open('unrelated-store');
  await unrelated.put('/api/private', new Response('unrelated fixture'));
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  assert.equal(await old.match('/api/private'), undefined);
  assert.equal(await old.match('/brand/app-icon-192.png?session=disposable'), undefined);
  assert.equal(await old.match('https://other.example.test/assets/foreign-12345678.js'), undefined);
  assert.equal(await old.match('/assets/private-12345678.js'), undefined);
  assert.equal(await (await old.match('/assets/previous-12345678.js')).text(), 'previous public asset');
  assert.equal(await (await unrelated.match('/api/private')).text(), 'unrelated fixture');
});

test('API, LNURL, other origins and non-GET requests bypass the worker', async () => {
  const worker = harness();
  for (const [path, options] of [
    ['/api/account', {}], ['/.well-known/lnurlp/example', {}], ['/lnurlpay/example', {}],
    ['/lnurlp/example', {}], ['https://other.example.test/assets/app-12345678.js', {}],
    ['/index.html', {method: 'POST'}], ['/recovery', {mode: 'navigate'}],
  ]) assert.equal(await worker.request(path, options), undefined);
  assert.equal(worker.calls.fetch.length, 0);
  assert.equal(worker.stores.size, 0);
});

test('never stores private, no-store or error responses as public assets', async () => {
  const worker = harness();
  for (const cacheControl of ['private', 'no-store', 'public, max-age=0, no-store']) {
    worker.network(() => Promise.resolve(new Response('disposable private response', {headers: {'Cache-Control': cacheControl}})));
    await worker.request('/assets/private-12345678.js');
    assert.equal(await (await worker.caches.open(currentCache)).match('/assets/private-12345678.js'), undefined);
  }
  worker.network(() => Promise.resolve(new Response('error', {status: 503})));
  await worker.request('/assets/error-12345678.js');
  assert.equal(await (await worker.caches.open(currentCache)).match('/assets/error-12345678.js'), undefined);
});

test('authorized, no-store and query asset requests cannot populate a public cache key', async () => {
  const worker = harness();
  for (const [path, options] of [
    ['/assets/authorized-12345678.js', {headers: new Headers({Authorization: 'Bearer disposable-marker'})}],
    ['/assets/no-store-12345678.js', {cache: 'no-store'}],
    ['/assets/query-12345678.js?token=disposable-marker', {}],
  ]) {
    await worker.request(path, options);
    const publicPath = new URL(path, origin).pathname;
    assert.equal(await (await worker.caches.open(currentCache)).match(publicPath), undefined);
    assert.equal(await (await worker.caches.open(currentCache)).match(path), undefined);
  }
});

test('entry count remains bounded and fixed shell assets survive a long font session', async () => {
  const worker = harness();
  await worker.lifecycle('install');
  const bootAssets = ['/assets/entry-12345678.js', '/assets/styles-12345678.css', '/assets/signer-12345678.wasm'];
  for (const path of bootAssets) await worker.request(path);
  for (let index = 0; index < 220; index++) {
    await worker.request(`/assets/font-${String(index).padStart(8, '0')}.woff2`);
  }
  const cache = await worker.caches.open(currentCache);
  assert.ok((await cache.keys()).length <= 192);
  assert.ok(await cache.match('/index.html'));
  assert.ok(await cache.match('/brand/app-icon-192.png'));
  for (const path of bootAssets) assert.ok(await cache.match(path), `Boot asset evicted: ${path}`);
});

test('previous private responses cannot be served by the offline fallback', async () => {
  const worker = harness();
  const old = await worker.caches.open('getyoursats-static-previous');
  await old.put('/assets/private-12345678.js', new Response('private fixture', {headers: {'Cache-Control': 'no-store'}}));
  worker.network(() => Promise.reject(new Error('offline')));
  const response = await worker.request('/assets/private-12345678.js');
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Offline');
});

test('offline shell and previous immutable chunks remain usable without forced activation', async () => {
  const worker = harness();
  await (await worker.caches.open('getyoursats-static-previous')).put('/assets/previous-12345678.js', new Response('previous chunk'));
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  worker.network(() => Promise.reject(new Error('offline')));
  assert.equal(await (await worker.request('/assets/previous-12345678.js')).text(), 'previous chunk');
  assert.match(await (await worker.request('/', {mode: 'navigate'})).text(), /Wallet/);
  assert.equal((await worker.request('/assets/unavailable-12345678.js')).status, 503);
  assert.equal(worker.calls.skipWaiting + worker.calls.claim, 0);
});

test('offline onboarding and wallet branding survive legacy-cache cleanup', async () => {
  const worker = harness();
  const brandAssets = [
    'wordmark-top.svg', 'wordmark-bottom.svg', 'wordmark-top-light.svg', 'wordmark-bottom-light.svg',
    'wordmark-coin.svg', 'wordmark-3d-transparent.png',
    'wordmark-stacked-light.svg', 'wordmark-horizontal-light.svg', 'app-icon.svg', 'monogram.svg',
  ];
  const old = await worker.caches.open('getyoursats-brand-v5');
  for (const name of brandAssets) await old.put(`/brand/${name}`, new Response('previous public brand asset'));
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  worker.network(() => Promise.reject(new Error('offline')));
  assert.equal((await worker.request('/theme-bootstrap.js'))?.status, 200, 'Missing offline theme bootstrap');
  for (const name of brandAssets) {
    const response = await worker.request(`/brand/${name}`);
    assert.equal(response?.status, 200, `Missing offline brand asset: ${name}`);
    assert.ok((await response.text()).length > 0);
  }
});
