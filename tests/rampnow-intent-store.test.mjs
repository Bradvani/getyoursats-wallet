import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {randomBytes, randomUUID} from 'node:crypto';
import {spawn, spawnSync, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {createRampnowIntentStore} from '../server/rampnowIntentStore.mjs';

const env = {VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/rampnow-integration-20261028',
  RAMPNOW_ENVIRONMENT: 'sandbox', RAMPNOW_STORAGE_SOURCE: 'upstash_sandbox',
  UPSTASH_REDIS_REST_URL: 'https://intent-storage.invalid', UPSTASH_REDIS_REST_TOKEN: 'private-intent-test-token'};
const wallet = '02' + '1'.repeat(64);
const otherWallet = '03' + '2'.repeat(64);
const checkout = {orderUid: 'sandbox_order_1', checkoutUrl: 'https://app.sandbox.rampnow.io/checkout/sandbox_order_1?mode=test'};
const retentionMs = 30 * 86400 * 1000;
const input = (time = Date.now(), changes = {}) => ({externalOrderUid: randomUUID(), walletPubkey: wallet,
  requestHash: 'a'.repeat(64), sourceAmount: '100.00', orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat',
  dstCurrency: 'BTC', dstChain: 'bitcoin', network: 'testnet', destinationHash: 'b'.repeat(64), quoteHash: 'c'.repeat(64),
  createdAt: time, expiresAt: time + 60000, ...changes});
const errorCode = code => error => error?.code === code && error.message === code && !error.cause;

test('intent ledger refuses all environments except the exact sandbox wallet preview branch', () => {
  for (const change of [{VERCEL_ENV: 'production'}, {VERCEL_ENV: 'development'}, {RAMPNOW_ENVIRONMENT: 'production'},
    {VERCEL_GIT_COMMIT_REF: 'main'}, {VERCEL_GIT_COMMIT_REF: ''},
    {VERCEL_ENV: 'production', RAMPNOW_DEPLOYMENT_ROLE: 'sandbox_webhook_receiver', VERCEL_PROJECT_ID: 'prj_A4rcsAjtYNd6RgdyJoo8zrTLFa1P'}]) {
    assert.throws(() => createRampnowIntentStore({env: {...env, ...change}, fetchImpl: () => assert.fail('network forbidden')}),
      errorCode('RAMPNOW_SANDBOX_ONLY'));
  }
});

test('intent preparation rejects malformed or overbroad records before storage access', async () => {
  const time = Date.now(); const store = createRampnowIntentStore({env, now: () => time, fetchImpl: () => assert.fail('network forbidden')});
  for (const change of [{externalOrderUid: 'browser-chosen-id'}, {walletPubkey: 'invalid'}, {requestHash: 'A'.repeat(64)},
    {destinationHash: 'raw-bitcoin-address'}, {quoteHash: ''}, {sourceAmount: '0'}, {sourceAmount: '-1'},
    {sourceAmount: '1e3'}, {orderType: 'sell'}, {srcCurrency: 'USD'}, {dstChain: 'ethereum'}, {network: 'mainnet'},
    {createdAt: NaN}, {expiresAt: time}, {email: 'private@example.invalid'}, {destinationAddress: 'raw-bitcoin-address'}]) {
    await assert.rejects(store.prepare(input(time, change)), errorCode('RAMPNOW_INTENT_INVALID'));
  }
});

test('REST errors, redirects and oversized payloads are sanitized', async () => {
  for (const fetchImpl of [
    async () => {throw Error('private-intent-test-token https://intent-storage.invalid');},
    async () => Response.json({error: 'private-intent-test-token'}),
    async () => new Response('private error', {status: 401}),
    async () => new Response('not-json'),
    async () => Response.json({unrecognized: 'private data'}),
    async () => new Response('x'.repeat(65537)),
    async () => {const response = Response.json({result: null}); Object.defineProperty(response, 'redirected', {value: true}); return response;},
  ]) {
    const store = createRampnowIntentStore({env, fetchImpl});
    await assert.rejects(store.redis('GET', 'sandbox-test'), errorCode('RAMPNOW_STORE_UNAVAILABLE'));
  }
});

test('Redis transport uses bounded authenticated requests without following redirects', async () => {
  const store = createRampnowIntentStore({env, fetchImpl: async (url, options) => {
    assert.equal(url, env.UPSTASH_REDIS_REST_URL + '/'); assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer private-intent-test-token'); assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), ['GET', 'sandbox-test']);
    return Response.json({result: null});
  }});
  assert.equal(await store.redis('GET', 'sandbox-test'), null);
});

const redisRoot = '/tmp/gys-rampnow-redis/extracted';
function redisEnvironment(executable, additions = {}) {
  return {...process.env, ...(executable.startsWith(redisRoot + '/')
    ? {LD_LIBRARY_PATH: redisRoot + '/usr/lib/x86_64-linux-gnu'} : {}), ...additions};
}
function findRedisExecutable(name, configured) {
  const extracted = redisRoot + '/usr/bin/' + name;
  const candidates = [configured, existsSync(extracted) ? extracted : undefined, name].filter(Boolean);
  return candidates.find(executable => spawnSync(executable, ['--version'],
    {env: redisEnvironment(executable), stdio: 'ignore', timeout: 5000}).status === 0);
}
const redisServer = findRedisExecutable('redis-server', process.env.GYS_REDIS_SERVER);
const redisCli = findRedisExecutable('redis-cli', process.env.GYS_REDIS_CLI);
const redisAvailable = Boolean(redisServer && redisCli);

test('durable intent ledger against isolated Redis', {skip: !redisAvailable && process.env.GYS_REQUIRE_REDIS !== '1'}, async t => {
  assert.ok(redisAvailable, 'Redis integration is required: install redis-server and redis-cli or configure GYS_REDIS_SERVER/GYS_REDIS_CLI');
  const exec = promisify(execFile);
  const portReservation = createServer();
  await new Promise(resolve => portReservation.listen(0, '127.0.0.1', resolve));
  const port = portReservation.address().port;
  await new Promise(resolve => portReservation.close(resolve));
  const password = randomBytes(24).toString('hex');
  const serverEnv = redisEnvironment(redisServer, {REDISCLI_AUTH: password});
  const cliEnv = redisEnvironment(redisCli, {REDISCLI_AUTH: password});
  const child = spawn(redisServer, ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no',
    '--requirepass', password], {env: serverEnv, stdio: 'ignore'});
  const closed = new Promise(resolve => child.once('exit', resolve));
  async function redis(...args) {
    const {stdout} = await exec(redisCli, ['-h', '127.0.0.1', '-p', String(port), '--no-auth-warning', '--json', ...args.map(String)], {env: cliEnv});
    try {return JSON.parse(stdout);} catch {throw Error('ISOLATED_REDIS_COMMAND_FAILED');}
  }
  async function fixture({afterCommand = () => {}} = {}) {
    await redis('FLUSHDB'); // This test owns the authenticated, disposable server.
    let time = Date.now(); const commands = [];
    const fetchImpl = async (url, options) => {
      assert.equal(url, env.UPSTASH_REDIS_REST_URL + '/'); assert.equal(options.redirect, 'error');
      const args = JSON.parse(options.body); commands.push(args);
      try {
        const result = await redis(...args); await afterCommand(args, result);
        return Response.json({result});
      } catch {return Response.json({error: 'ISOLATED_REDIS_COMMAND_FAILED'});}
    };
    return {store: createRampnowIntentStore({env, fetchImpl, now: () => time}), commands,
      record: changes => input(time, changes), advance: duration => {time += duration;}};
  }
  const evalKeys = args => args.slice(3, 3 + Number(args[2]));
  async function preparedKeys(fixture, record) {
    await fixture.store.prepare(record);
    const keys = evalKeys(fixture.commands.find(args => args[0] === 'EVAL'));
    const types = await Promise.all(keys.map(key => redis('TYPE', key)));
    return {intent: keys[types.indexOf('string')], index: keys[types.indexOf('zset')],
      binding: keys[types.indexOf('none')], keys};
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {if (await redis('PING') === 'PONG') break;} catch {}
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(await redis('PING'), 'PONG');

    await t.test('prepare is durable, private to its wallet, idempotent and limited to the minimal record', async () => {
      const f = await fixture(); const record = f.record();
      const first = await f.store.prepare(record); assert.equal(first.phase, 'prepared');
      for (const [key, value] of Object.entries(record)) assert.equal(first[key], value);
      assert.ok(Number.isSafeInteger(first.updatedAt));
      assert.deepEqual(await f.store.prepare(record), first);
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), first);
      assert.equal(await f.store.get(record.externalOrderUid, otherWallet), null);
      assert.equal(await f.store.get(randomUUID(), wallet), null);
      await assert.rejects(f.store.prepare({...record, sourceAmount: '200'}), errorCode('RAMPNOW_INTENT_CONFLICT'));
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), first);
      const allKeys = await redis('KEYS', '*'); assert.ok(allKeys.every(key => key.includes('{sandbox}')));
      for (const key of allKeys) if (await redis('TYPE', key) === 'string') {
        assert.doesNotMatch(await redis('GET', key), /email|destinationAddress|bankAccount|private@example/);
      }
    });

    await t.test('concurrent reservations have one winner and no later call authorizes another submission', async () => {
      const f = await fixture(); const record = f.record(); await f.store.prepare(record);
      const attempts = await Promise.all(Array.from({length: 12}, () => f.store.reserve(record.externalOrderUid, wallet, record.requestHash)));
      assert.equal(attempts.filter(result => result.reserved).length, 1);
      assert.ok(attempts.every(result => result.intent.phase === 'submitting'));
      assert.equal((await f.store.reserve(record.externalOrderUid, wallet, record.requestHash)).reserved, false);
      await assert.rejects(f.store.reserve(record.externalOrderUid, wallet, 'd'.repeat(64)), errorCode('RAMPNOW_INTENT_CONFLICT'));
      await assert.rejects(f.store.reserve(record.externalOrderUid, otherWallet, record.requestHash), errorCode('RAMPNOW_INTENT_NOT_FOUND'));
      assert.equal((await f.store.get(record.externalOrderUid, wallet)).phase, 'submitting');
    });

    await t.test('an ambiguous reserve response cannot authorize a second provider submission', async () => {
      let loseResponse = true;
      const f = await fixture({afterCommand(args, result) {
        if (loseResponse && args[0] === 'EVAL' && result === 'UPDATED') {loseResponse = false; throw Error('lost response after durable write');}
      }});
      const record = f.record(); await f.store.prepare(record);
      await assert.rejects(f.store.markUncertain(record.externalOrderUid, wallet, record.requestHash), errorCode('RAMPNOW_INTENT_CONFLICT'));
      await assert.rejects(f.store.reserve(record.externalOrderUid, wallet, record.requestHash), errorCode('RAMPNOW_STORE_UNAVAILABLE'));
      assert.equal((await f.store.get(record.externalOrderUid, wallet)).phase, 'submitting');
      assert.equal((await f.store.reserve(record.externalOrderUid, wallet, record.requestHash)).reserved, false);
      assert.equal((await f.store.markUncertain(record.externalOrderUid, wallet, record.requestHash)).phase, 'uncertain');
      assert.equal((await f.store.reserve(record.externalOrderUid, wallet, record.requestHash)).reserved, false);
    });

    await t.test('Redis checks the reservation deadline even when the caller clock is still before expiry', async () => {
      const f = await fixture(); const realTime = Date.now(); f.advance(-2000);
      const record = f.record({expiresAt: realTime - 1000});
      await f.store.prepare(record);
      await assert.rejects(f.store.reserve(record.externalOrderUid, wallet, record.requestHash), errorCode('RAMPNOW_INTENT_EXPIRED'));
      assert.equal((await f.store.get(record.externalOrderUid, wallet)).phase, 'prepared');
    });

    await t.test('prepared expiry rejects a new submission while uncertain and bound states remain non-resubmittable', async () => {
      const f = await fixture(); const expiring = f.record({expiresAt: Date.now() + 1000}); await f.store.prepare(expiring);
      const pending = f.record(); await f.store.prepare(pending);
      await f.store.reserve(pending.externalOrderUid, wallet, pending.requestHash);
      const uncertain = await f.store.markUncertain(pending.externalOrderUid, wallet, pending.requestHash);
      assert.equal(uncertain.phase, 'uncertain'); assert.deepEqual(await f.store.markUncertain(pending.externalOrderUid, wallet, pending.requestHash), uncertain);
      f.advance(70000);
      await assert.rejects(f.store.reserve(expiring.externalOrderUid, wallet, expiring.requestHash), errorCode('RAMPNOW_INTENT_EXPIRED'));
      assert.equal((await f.store.reserve(pending.externalOrderUid, wallet, pending.requestHash)).reserved, false);
      assert.equal((await f.store.bind(pending.externalOrderUid, wallet, pending.requestHash, checkout)).phase, 'bound');
      assert.equal((await f.store.reserve(pending.externalOrderUid, wallet, pending.requestHash)).reserved, false);
      assert.equal((await f.store.markUncertain(pending.externalOrderUid, wallet, pending.requestHash)).phase, 'bound');
    });

    await t.test('bind commits the webhook binding atomically and rejects conflicting provider orders', async () => {
      const f = await fixture(); const record = f.record(); await f.store.prepare(record);
      await assert.rejects(f.store.bind(record.externalOrderUid, wallet, record.requestHash, checkout), errorCode('RAMPNOW_INTENT_CONFLICT'));
      await f.store.reserve(record.externalOrderUid, wallet, record.requestHash);
      const bound = await f.store.bind(record.externalOrderUid, wallet, record.requestHash, checkout);
      assert.equal(bound.phase, 'bound'); assert.equal(bound.orderUid, checkout.orderUid); assert.equal(bound.checkoutUrl, checkout.checkoutUrl);
      assert.deepEqual(await f.store.bind(record.externalOrderUid, wallet, record.requestHash, checkout), bound);
      assert.deepEqual(await f.store.prepare(record), bound);
      await assert.rejects(f.store.bind(record.externalOrderUid, wallet, record.requestHash, {...checkout, orderUid: 'different_order'}), errorCode('RAMPNOW_INTENT_CONFLICT'));
      const binding = JSON.parse(await redis('GET', 'gys:rampnow:{sandbox}:v1:binding:' + record.externalOrderUid));
      assert.deepEqual(binding, {environment: 'sandbox', externalOrderUid: record.externalOrderUid, walletPubkey: wallet,
        orderUid: checkout.orderUid, orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin'});
      const second = f.record(); await f.store.prepare(second); await f.store.reserve(second.externalOrderUid, wallet, second.requestHash);
      await assert.rejects(f.store.bind(second.externalOrderUid, wallet, second.requestHash, checkout), errorCode('RAMPNOW_INTENT_CONFLICT'));
      assert.equal((await f.store.get(second.externalOrderUid, wallet)).phase, 'submitting');
      assert.equal(await redis('GET', 'gys:rampnow:{sandbox}:v1:binding:' + second.externalOrderUid), null);
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), bound);
    });

    await t.test('an 8192-character hosted redirect survives durable binding and later reads', async () => {
      const f = await fixture(); const record = f.record(); const keys = await preparedKeys(f, record);
      await f.store.reserve(record.externalOrderUid, wallet, record.requestHash);
      const prefix = 'https://app.sandbox.rampnow.io/checkout?token=';
      const longCheckout = {...checkout, checkoutUrl: prefix + 'x'.repeat(8192 - prefix.length)};
      assert.equal(longCheckout.checkoutUrl.length, 8192);
      const bound = await f.store.bind(record.externalOrderUid, wallet, record.requestHash, longCheckout);
      assert.equal(bound.checkoutUrl, longCheckout.checkoutUrl);
      const raw = await redis('GET', keys.intent);
      assert.ok(Buffer.byteLength(raw) > 8192 && Buffer.byteLength(raw) <= 16 * 1024);
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), bound);
      assert.deepEqual(await f.store.bind(record.externalOrderUid, wallet, record.requestHash, longCheckout), bound);
      await assert.rejects(f.store.bind(record.externalOrderUid, wallet, record.requestHash,
        {...longCheckout, checkoutUrl: longCheckout.checkoutUrl + 'x'}), errorCode('RAMPNOW_INTENT_INVALID'));
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), bound);
    });

    await t.test('reconciliation can bind without a redirect, recover it later and never erase a recovered URL', async () => {
      const f = await fixture(); const record = f.record(); await f.store.prepare(record);
      await f.store.reserve(record.externalOrderUid, wallet, record.requestHash);
      await f.store.markUncertain(record.externalOrderUid, wallet, record.requestHash);
      const withoutUrl = {...checkout, checkoutUrl: null};
      const bound = await f.store.bind(record.externalOrderUid, wallet, record.requestHash, withoutUrl);
      assert.equal(bound.phase, 'bound'); assert.equal(bound.checkoutUrl, null);
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), bound);
      assert.deepEqual(await f.store.bind(record.externalOrderUid, wallet, record.requestHash, withoutUrl), bound);
      const recovered = await f.store.bind(record.externalOrderUid, wallet, record.requestHash, checkout);
      assert.equal(recovered.checkoutUrl, checkout.checkoutUrl);
      assert.deepEqual(await f.store.bind(record.externalOrderUid, wallet, record.requestHash, withoutUrl), recovered);
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), recovered);
      await assert.rejects(f.store.bind(record.externalOrderUid, wallet, record.requestHash,
        {...checkout, checkoutUrl: 'https://app.sandbox.rampnow.io/different-checkout'}), errorCode('RAMPNOW_INTENT_CONFLICT'));
      assert.equal((await f.store.reserve(record.externalOrderUid, wallet, record.requestHash)).reserved, false);
    });

    await t.test('binding validates the URL and owner before any writes', async () => {
      const f = await fixture(); const record = f.record(); await f.store.prepare(record); await f.store.reserve(record.externalOrderUid, wallet, record.requestHash);
      const previous = await f.store.get(record.externalOrderUid, wallet);
      for (const checkoutUrl of ['http://app.sandbox.rampnow.io/order', 'https://app.rampnow.io/order',
        'https://app.sandbox.rampnow.io.evil.invalid/order', 'https://user:pass@app.sandbox.rampnow.io/order',
        'https://app.sandbox.rampnow.io:8443/order', 'https://app.sandbox.rampnow.io/order#fragment',
        'https://app.sandbox.rampnow.io/' + 'x'.repeat(8192)]) {
        await assert.rejects(f.store.bind(record.externalOrderUid, wallet, record.requestHash, {...checkout, checkoutUrl}), errorCode('RAMPNOW_INTENT_INVALID'));
      }
      await assert.rejects(f.store.bind(record.externalOrderUid, otherWallet, record.requestHash, checkout), errorCode('RAMPNOW_INTENT_NOT_FOUND'));
      await assert.rejects(f.store.bind(record.externalOrderUid, wallet, 'd'.repeat(64), checkout), errorCode('RAMPNOW_INTENT_CONFLICT'));
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), previous);
    });

    await t.test('30-day retention is independent of quote expiry and the shared index is capped', async () => {
      const f = await fixture(); const record = f.record(); const keys = await preparedKeys(f, record);
      assert.ok(keys.intent && keys.index);
      const ttl = await redis('PTTL', keys.intent); const indexTtl = await redis('PTTL', keys.index);
      assert.ok(ttl > retentionMs - 60000 && ttl <= retentionMs); assert.ok(indexTtl > retentionMs - 60000 && indexTtl <= retentionMs);
      await redis('DEL', keys.intent); await redis('DEL', keys.index);
      const future = Date.now() + retentionMs;
      const members = Array.from({length: 1000}, (_, i) => [future, 'existing-' + i]).flat();
      await redis('ZADD', keys.index, ...members);
      await assert.rejects(f.store.prepare(record), errorCode('RAMPNOW_INTENT_CAPACITY'));
      assert.equal(await redis('EXISTS', keys.intent), 0); assert.equal(await redis('ZCARD', keys.index), 1000);
      await redis('ZADD', keys.index, record.createdAt - 1, 'existing-0');
      assert.equal((await f.store.prepare(record)).phase, 'prepared'); assert.equal(await redis('ZCARD', keys.index), 1000);
    });

    await t.test('malformed stored records and wrong Redis types fail without partial mutations', async () => {
      const f = await fixture(); const record = f.record(); const keys = await preparedKeys(f, record);
      const original = await redis('GET', keys.intent);
      await redis('SET', keys.intent, '{}');
      await assert.rejects(f.store.get(record.externalOrderUid, wallet), errorCode('RAMPNOW_STORE_UNAVAILABLE'));
      await assert.rejects(f.store.reserve(record.externalOrderUid, wallet, record.requestHash), errorCode('RAMPNOW_STORE_UNAVAILABLE'));
      await redis('SET', keys.intent, original);
      await redis('DEL', keys.intent); await redis('DEL', keys.index); await redis('SET', keys.index, 'wrong-index-type');
      await assert.rejects(f.store.prepare(record), errorCode('RAMPNOW_STORE_UNAVAILABLE'));
      assert.equal(await redis('GET', keys.index), 'wrong-index-type'); assert.equal(await redis('EXISTS', keys.intent), 0);
      await redis('DEL', keys.index); await f.store.prepare(record); await f.store.reserve(record.externalOrderUid, wallet, record.requestHash);
      const before = await f.store.get(record.externalOrderUid, wallet);
      const bindingKey = 'gys:rampnow:{sandbox}:v1:binding:' + record.externalOrderUid;
      await redis('SADD', bindingKey, 'wrong-binding-type');
      await assert.rejects(f.store.bind(record.externalOrderUid, wallet, record.requestHash, checkout), errorCode('RAMPNOW_STORE_UNAVAILABLE'));
      assert.deepEqual(await f.store.get(record.externalOrderUid, wallet), before);
      assert.deepEqual(await redis('SMEMBERS', bindingKey), ['wrong-binding-type']);
      const lastKeys = evalKeys(f.commands.findLast(args => args[0] === 'EVAL'));
      for (const key of lastKeys) if (key !== keys.intent && key !== bindingKey) assert.equal(await redis('EXISTS', key), 0);
    });
  } finally {
    child.kill('SIGTERM'); await closed;
  }
});
