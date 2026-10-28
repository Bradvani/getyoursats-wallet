import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => { await page.goto('/'); });

test('same-store reservations have one winner across independent connections', async ({page}) => {
  const result = await page.evaluate(async () => {
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const name = `gys-cas-${crypto.randomUUID()}`;
    const a = await new IndexedDBStorage(name).initialize();
    const b = await new IndexedDBStorage(name).initialize();
    try {
      // Negative control: both old read/then-write callers see absence.
      const reads = await Promise.all([a.getCachedItem('old'), b.getCachedItem('old')]);
      const oldWinners = await Promise.all([a, b].map(async (store, index) => {
        if (reads[index] !== null) return false;
        await store.setCachedItem('old', `owner-${index}`);
        return true;
      }));
      const winners = await Promise.all([
        a.compareAndSwapCachedItem('attempt', null, 'owner-a'),
        b.compareAndSwapCachedItem('attempt', null, 'owner-b'),
      ]);
      return {oldWinners, winners, current: await b.getCachedItem('attempt')};
    } finally { a.close(); b.close(); }
  });
  expect(result.oldWinners).toEqual([true, true]);
  expect(result.winners.filter(Boolean)).toHaveLength(1);
  expect(result.current).toBe(result.winners[0] ? 'owner-a' : 'owner-b');
});

test('competing phase updates preserve the single winning value', async ({page}) => {
  const result = await page.evaluate(async () => {
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const name = `gys-cas-${crypto.randomUUID()}`;
    const a = await new IndexedDBStorage(name).initialize();
    const b = await new IndexedDBStorage(name).initialize();
    try {
      await a.compareAndSwapCachedItem('attempt', null, 'original');
      const winners = await Promise.all([
        a.compareAndSwapCachedItem('attempt', 'original', 'receiving-a'),
        b.compareAndSwapCachedItem('attempt', 'original', 'receiving-b'),
      ]);
      const stale = await a.compareAndSwapCachedItem('attempt', 'original', 'late-provider-ack');
      const current = await b.getCachedItem('attempt');
      a.close(); b.close();
      const reopened = await new IndexedDBStorage(name).initialize();
      try { return {winners, stale, current, reopened: await reopened.getCachedItem('attempt')}; }
      finally { reopened.close(); }
    } finally { a.close(); b.close(); }
  });
  expect(result.winners.filter(Boolean)).toHaveLength(1);
  expect(result.stale).toBe(false);
  expect(result.current).toBe(result.winners[0] ? 'receiving-a' : 'receiving-b');
  expect(result.reopened).toBe(result.current);
});

test('request success cannot acknowledge an aborted transaction', async ({page}) => {
  const result = await page.evaluate(async () => {
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const storage = await new IndexedDBStorage(`gys-cas-${crypto.randomUUID()}`).initialize();
    try {
      await storage.compareAndSwapCachedItem('attempt', null, 'original');
      const original = storage.db.transaction.bind(storage.db);
      let requestSucceeded = false;
      storage.db.transaction = (...args: unknown[]) => {
        const transaction = original(...args);
        const objectStore = transaction.objectStore.bind(transaction);
        transaction.objectStore = (name: string) => {
          const store = objectStore(name);
          const put = store.put.bind(store);
          store.put = (value: unknown) => {
            const request = put(value);
            request.addEventListener('success', () => { requestSucceeded = true; transaction.abort(); });
            return request;
          };
          return store;
        };
        return transaction;
      };
      let rejected = false;
      try { await storage.compareAndSwapCachedItem('attempt', 'original', 'receiving'); }
      catch { rejected = true; }
      storage.db.transaction = original;
      return {requestSucceeded, rejected, current: await storage.getCachedItem('attempt')};
    } finally { storage.close(); }
  });
  expect(result).toEqual({requestSucceeded: true, rejected: true, current: 'original'});
});

test('acknowledgement follows transaction completion', async ({page}) => {
  const result = await page.evaluate(async () => {
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const storage = await new IndexedDBStorage(`gys-cas-${crypto.randomUUID()}`).initialize();
    const events: string[] = [];
    try {
      const original = storage.db.transaction.bind(storage.db);
      let settled = false;
      storage.db.transaction = (...args: unknown[]) => {
        const transaction = original(...args);
        transaction.addEventListener('complete', () => events.push('commit'));
        const objectStore = transaction.objectStore.bind(transaction);
        transaction.objectStore = (name: string) => {
          const store = objectStore(name);
          const put = store.put.bind(store);
          store.put = (value: unknown) => {
            const request = put(value);
            request.addEventListener('success', () => {
              events.push('request-success');
              queueMicrotask(() => events.push(settled ? 'premature-ack' : 'still-pending'));
            });
            return request;
          };
          return store;
        };
        return transaction;
      };
      const changed = await storage.compareAndSwapCachedItem('attempt', null, 'reserved').then((value: boolean) => {
        settled = true; events.push('ack'); return value;
      });
      return {changed, events};
    } finally { storage.close(); }
  });
  expect(result.changed).toBe(true);
  expect(result.events).toEqual(['request-success', 'still-pending', 'commit', 'ack']);
});

test('malformed inputs and malformed stored values remain blocked and preserved', async ({page}) => {
  const result = await page.evaluate(async () => {
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const storage = await new IndexedDBStorage(`gys-cas-${crypto.randomUUID()}`).initialize();
    try {
      const invalid = [
        ['', null, 'next'], [false, null, 'next'], ['attempt', undefined, 'next'],
        ['attempt', 0, 'next'], ['attempt', false, 'next'], ['attempt', {}, 'next'],
        ['attempt', null, undefined], ['attempt', null, 0], ['attempt', null, {}],
      ];
      let rejected = 0;
      for (const args of invalid) {
        try { await storage.compareAndSwapCachedItem(...args); } catch { rejected++; }
      }
      await new Promise<void>((resolve, reject) => {
        const transaction = storage.db.transaction('settings', 'readwrite');
        transaction.objectStore('settings').put({key: 'malformed', value: null});
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
      let malformedRejected = false;
      try { await storage.compareAndSwapCachedItem('malformed', null, 'replacement'); }
      catch { malformedRejected = true; }
      const raw = await new Promise<unknown>((resolve, reject) => {
        const request = storage.db.transaction('settings').objectStore('settings').get('malformed');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return {rejected, malformedRejected, raw, untouched: await storage.getCachedItem('attempt')};
    } finally { storage.close(); }
  });
  expect(result).toEqual({rejected: 9, malformedRejected: true, raw: {key: 'malformed', value: null}, untouched: null});
});

test('unsupported strict durability aborts before the read or write', async ({page}) => {
  const result = await page.evaluate(async () => {
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const storage = await new IndexedDBStorage(`gys-cas-${crypto.randomUUID()}`).initialize();
    try {
      const original = storage.db.transaction.bind(storage.db);
      let accessed = false;
      storage.db.transaction = (...args: unknown[]) => {
        const transaction = original(...args);
        Object.defineProperty(transaction, 'durability', {value: 'default'});
        transaction.objectStore = () => { accessed = true; throw new Error('Must not access the store'); };
        return transaction;
      };
      let rejected = false;
      try { await storage.compareAndSwapCachedItem('attempt', null, 'reserved'); } catch { rejected = true; }
      storage.db.transaction = original;
      return {rejected, accessed, current: await storage.getCachedItem('attempt')};
    } finally { storage.close(); }
  });
  expect(result).toEqual({rejected: true, accessed: false, current: null});
});

test('exact strings are compared without normalization or coercion', async ({page}) => {
  const result = await page.evaluate(async () => {
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const storage = await new IndexedDBStorage(`gys-cas-${crypto.randomUUID()}`).initialize();
    try {
      const original = '{"phase":"intent","label":"\u00e9"}';
      await storage.compareAndSwapCachedItem('attempt', null, original);
      const differentSpacing = await storage.compareAndSwapCachedItem('attempt', original + ' ', 'replacement');
      const differentUnicode = await storage.compareAndSwapCachedItem('attempt', original.replace('\u00e9', 'e\u0301'), 'replacement');
      return {differentSpacing, differentUnicode, original, current: await storage.getCachedItem('attempt')};
    } finally { storage.close(); }
  });
  expect(result.differentSpacing).toBe(false);
  expect(result.differentUnicode).toBe(false);
  expect(result.current).toBe(result.original);
});

test('two tabs sharing one database cannot both reserve the same attempt', async ({page, context}) => {
  const other = await context.newPage();
  await other.goto('/');
  const name = `gys-tabs-${Date.now()}-${Math.random()}`;
  const reserve = (tab: typeof page, value: string) => tab.evaluate(async ({name, value}) => {
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const storage = await new IndexedDBStorage(name).initialize();
    try { return await storage.compareAndSwapCachedItem('attempt', null, value); }
    finally { storage.close(); }
  }, {name, value});
  const results = await Promise.all([reserve(page, 'tab-a'), reserve(other, 'tab-b')]);
  expect(results.filter(Boolean)).toHaveLength(1);
  await other.close();
});

test('the tested adapter is identified and closed storage rejects access', async ({page}) => {
  const result = await page.evaluate(async () => {
    const identity = await fetch('/identity.json').then(response => response.json());
    const path = '/adapter.js';
    const {IndexedDBStorage} = await import(path);
    const storage = await new IndexedDBStorage(`gys-cas-${crypto.randomUUID()}`).initialize();
    storage.close();
    let rejected = false;
    try { await storage.compareAndSwapCachedItem('attempt', null, 'reserved'); } catch { rejected = true; }
    return {identity, rejected};
  });
  expect(result.rejected).toBe(true);
  expect(result.identity.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(result.identity.bytes).toBeGreaterThan(0);
  expect(result.identity.source).toBe(process.env.GYS_SDK_STORAGE_ADAPTER ? 'explicit-source-override' : 'installed-sdk');
  await test.info().attach('adapter-identity', {body: JSON.stringify(result.identity), contentType: 'application/json'});
});
