import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function workerHarness(windows = []) {
  const handlers = new Map();
  const shown = [];
  const opened = [];
  const self = {
    location: {origin: 'https://wallet.getyoursats.com'},
    addEventListener(name, handler) { handlers.set(name, handler); },
    registration: {showNotification(title, options) {
      shown.push({title, options});
      return Promise.resolve();
    }},
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => { opened.push(url); return null; },
    },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self, URL, Promise, Set, console,
  }, {filename: 'public/sw.js'});
  async function fire(name, event) {
    let pending;
    handlers.get(name)({...event, waitUntil(p) { pending = p; }});
    if (pending) await pending;
  }
  return {fire, shown, opened};
}

test('a received payment notification is private and contains no wallet metadata', async () => {
  const h = workerHarness();
  await h.fire('push', {data: {json: () => ({
    type: 'gys.payment.received', version: 1, id: 'evt_123',
    amount: 12000, sender: 'Someone', seed: 'NEVER SHOW THIS',
  })}});
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].title, 'Payment received ⚡');
  assert.match(h.shown[0].options.body, /Bitcoin received/);
  assert.equal(h.shown[0].options.tag, 'gys.payment.received:evt_123');
  assert.equal(h.shown[0].options.data.path, '/');
  assert.doesNotMatch(JSON.stringify(h.shown), /Someone|12000|NEVER SHOW/);
});

test('malformed or unexpected push always displays a non-transactional fallback', async () => {
  const h = workerHarness();
  await h.fire('push', {data: {json: () => {throw new Error('invalid payload');}}});
  await h.fire('push', {data: {json: () => ({type: 'arbitrary', id: 'malicious'})}});
  assert.equal(h.shown.length, 2);
  assert(h.shown.every(n => n.options.body.startsWith('Wallet activity')));
  assert(h.shown.every(n => !n.options.tag));
});

test('notification tap focuses an existing same-origin app instead of trusting payload links', async () => {
  let focusCount = 0;
  const h = workerHarness([
    {url: 'https://not-the-wallet.example/', focus: async () => {throw new Error('foreign app');}},
    {url: 'https://wallet.getyoursats.com/?ignored=1', focus: async () => {focusCount++;}},
  ]);
  let closed = false;
  await h.fire('notificationclick', {
    notification: {close() {closed = true;}, data: {url: 'https://phishing.example'}},
  });
  assert.equal(closed, true);
  assert.equal(focusCount, 1);
  assert.equal(h.opened.length, 0);
});

test('notification tap opens canonical home if wallet has no open window', async () => {
  const h = workerHarness();
  await h.fire('notificationclick', {notification: {close() {}}});
  assert.deepEqual(h.opened, ['https://wallet.getyoursats.com/']);
});

test('DCA and on-ramp events use approved private copy and no supplied text', async () => {
  const h = workerHarness();
  const expected = [
    ['gys.dca.purchase.settled', 'Your stack just grew'],
    ['gys.dca.purchase.failed', 'Scheduled purchase needs attention'],
    ['gys.onramp.purchase.processing', 'Bitcoin purchase processing'],
    ['gys.onramp.purchase.settled', 'Bitcoin purchase delivered'],
    ['gys.onramp.availability', 'More ways to stack sats'],
  ];
  for (const [type, title] of expected) {
    await h.fire('push', {data: {json: () => ({
      type, version: 1, id: 'safe_evt_1',
      title: 'PROMOTIONAL SPOOF', body: 'SECRET ACCOUNT', amount: 23100,
      navigate: 'https://wrong-website.example',
    })}});
    const actual = h.shown.at(-1);
    assert.equal(actual.title, title);
    assert(!JSON.stringify(actual).includes('SECRET ACCOUNT'));
    assert(!JSON.stringify(actual).includes('PROMOTIONAL SPOOF'));
    assert(!JSON.stringify(actual).includes('23100'));
    assert(!JSON.stringify(actual).includes('wrong-website.example'));
    assert.equal(actual.options.data.path, '/');
    assert.equal(actual.options.tag, type + ':safe_evt_1');
  }
});

test('unknown versions never impersonate payment completion', async () => {
  const h = workerHarness();
  await h.fire('push', {data: {json: () => ({
    type: 'gys.dca.purchase.settled', version: 999, id: 'untrusted',
  })}});
  assert.equal(h.shown[0].title, 'GetYourSats');
  assert.equal(h.shown[0].options.tag, undefined);
  assert.match(h.shown[0].options.body, /Wallet activity/);
});

test('private payload-free Lightning push displays confirmed incoming payment',async()=>{
  const h=workerHarness();
  await h.fire('push',{data:null});
  assert.equal(h.shown.length,1);
  assert.equal(h.shown[0].title,'Payment received ⚡');
  assert.equal(h.shown[0].options.body,'Bitcoin received. Open GetYourSats for details.');
  assert.equal(h.shown[0].options.tag,undefined);
});
