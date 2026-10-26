import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile, spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const redisServer = process.env.GYS_REDIS_SERVER || 'redis-server';
const redisCli = process.env.GYS_REDIS_CLI || 'redis-cli';
const redisEndpoint = 'https://contact-budget-disposable.invalid/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startRedis(t) {
  const directory = await mkdtemp(join(tmpdir(), 'gys-contact-budget-'));
  const socket = join(directory, 'redis.sock');
  const child = spawn(redisServer, ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '700',
    '--save', '', '--appendonly', 'no', '--dir', directory], {stdio: ['ignore', 'pipe', 'pipe']});
  let startupError;
  let log = '';
  child.on('error', error => { startupError = error; });
  child.stdout.on('data', chunk => { log = (log + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
  const closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      let deadline;
      await Promise.race([closed, new Promise(resolve => { deadline = setTimeout(resolve, 2000); })]);
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
    await rm(directory, {recursive: true, force: true});
  });
  const command = async (...args) => {
    const {stdout} = await execute(redisCli, ['-s', socket, '--json', ...args.map(String)], {timeout: 5000, maxBuffer: 2 * 1024 * 1024});
    const result = stdout.trim();
    if (result.startsWith('error:')) throw new Error(result);
    return JSON.parse(result);
  };
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (startupError) throw new Error(`Disposable Redis could not start: ${startupError.message}`);
    try { if (await command('PING') === 'PONG') return command; } catch { /* Wait for the private socket. */ }
    if (child.exitCode !== null) throw new Error(`Disposable Redis stopped: ${log}`);
    await pause(25);
  }
  throw new Error(`Disposable Redis did not become ready: ${log}`);
}

function response() {
  return {statusCode: 200, headers: new Map(), payload: null,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), String(value)); return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function request(patch = {}, ip = '192.0.2.1') {
  return {method: 'POST', headers: {origin: 'https://getyoursats.com', 'content-type': 'application/json', 'x-vercel-forwarded-for': ip},
    body: {name: 'Disposable contact QA', email: 'disposable@example.invalid', topic: 'support',
      message: 'Disposable integration test. No message may be delivered externally.', consent: true, website: '', ...patch},
  };
}

async function freshHandler() {
  return (await import(new URL(`../site/api/contact.js?disposable=${randomUUID()}`, import.meta.url))).default;
}

test('support submission budgets use atomic disposable Redis state', async t => {
  const redis = await startRedis(t);
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const config = {
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
    KV_REST_API_URL: redisEndpoint,
    KV_REST_API_TOKEN: 'disposable-budget-token',
    RESEND_API_KEY: 'disposable-resend-key',
    GETYOURSATS_SUPPORT_FROM: 'disposable@example.invalid',
    GETYOURSATS_SUPPORT_TO: 'sink@example.invalid',
  };
  const originalConfig = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    for (const [key, value] of Object.entries(originalConfig)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let providerMode = 'ok';
  let storageMode = 'ok';
  const providerCalls = [];
  const storageCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === redisEndpoint) {
      assert.equal(options.headers.Authorization, 'Bearer disposable-budget-token');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      const command = JSON.parse(options.body);
      storageCalls.push(command);
      if (storageMode === 'offline') throw new Error('Disposable storage outage');
      if (storageMode === 'http-error') return new Response('{}', {status: 503});
      if (storageMode !== 'ok') return new Response(JSON.stringify(storageMode), {headers: {'Content-Type': 'application/json'}});
      try {
        return new Response(JSON.stringify({result: await redis(...command)}), {headers: {'Content-Type': 'application/json'}});
      } catch (error) {
        return new Response(JSON.stringify({error: error.message}), {headers: {'Content-Type': 'application/json'}});
      }
    }
    if (String(url) === 'https://api.resend.com/emails') {
      assert.equal(options.headers.Authorization, 'Bearer disposable-resend-key');
      assert.equal(options.redirect, 'error');
      providerCalls.push({headers: {...options.headers}, body: JSON.parse(options.body)});
      if (providerMode === 'timeout') throw new DOMException('Disposable provider timeout', 'TimeoutError');
      return new Response(JSON.stringify({id: 'disposable-provider-acceptance'}), {status: providerMode === 'ok' ? 200 : 503});
    }
    throw new Error('Unexpected network call in disposable contact test');
  };
  const reset = async () => {
    await redis('FLUSHDB');
    providerCalls.length = 0; storageCalls.length = 0;
    providerMode = 'ok'; storageMode = 'ok'; Date.now = originalNow;
  };
  const submit = async (handler, req = request()) => {
    const res = response(); await handler(req, res); return res;
  };
  const counters = command => redis('MGET', ...command.slice(4, 7));

  await t.test('distinct submissions in one millisecond have distinct references', async () => {
    await reset();
    const sameInstant = originalNow();
    Date.now = () => sameInstant;
    const first = await submit(await freshHandler(), request({message: 'Disposable first same-millisecond enquiry.'}));
    const second = await submit(await freshHandler(), request({message: 'Disposable second same-millisecond enquiry.'}));
    assert.equal(first.statusCode, 202); assert.equal(second.statusCode, 202);
    assert.match(first.payload.reference, /^GYS-[A-F0-9-]{36}$/);
    assert.notEqual(first.payload.reference, second.payload.reference);
    assert.notEqual(providerCalls[0].headers['Idempotency-Key'], providerCalls[1].headers['Idempotency-Key']);
    assert.deepEqual(await counters(storageCalls[0]), ['2', '2', '2']);
  });

  await t.test('same payload retries preserve reference, provider idempotency and one budget reservation', async () => {
    await reset();
    const submissionId = randomUUID();
    const req = request({submissionId});
    const first = await submit(await freshHandler(), req);
    const second = await submit(await freshHandler(), req);
    assert.equal(first.statusCode, 202); assert.equal(second.statusCode, 202);
    assert.equal(first.payload.reference, second.payload.reference);
    assert.equal(providerCalls[0].headers['Idempotency-Key'], providerCalls[1].headers['Idempotency-Key']);
    assert.deepEqual(providerCalls[0].body, providerCalls[1].body);
    assert.deepEqual(await counters(storageCalls[0]), ['1', '1', '1']);
    const changed = await submit(await freshHandler(), request({submissionId, message: 'A different disposable body must not reuse the reference.'}));
    assert.equal(changed.statusCode, 409);
    assert.equal(providerCalls.length, 2);
    assert.deepEqual(await counters(storageCalls[0]), ['1', '1', '1']);
    assert.equal((await submit(await freshHandler(), req)).statusCode, 202);
    assert.equal((await submit(await freshHandler(), req)).statusCode, 202);
    const fifth = await submit(await freshHandler(), req);
    assert.equal(fifth.statusCode, 429);
    assert.equal(fifth.payload.reference, first.payload.reference);
    assert.equal(providerCalls.length, 4);
  });

  await t.test('daily budget TTL remains valid across a request clock second boundary', async () => {
    await reset();
    const firstInstant = Math.floor(originalNow() / 1000) * 1000 + 999;
    Date.now = () => firstInstant;
    assert.equal((await submit(await freshHandler(), request({submissionId: randomUUID()}))).statusCode, 202);
    assert.equal(await redis('EXPIRETIME', storageCalls[0][4]), (Math.floor(firstInstant / 86_400_000) + 1) * 86_400);
    Date.now = () => firstInstant + 2;
    assert.equal((await submit(await freshHandler(), request({submissionId: randomUUID()}))).statusCode, 202);
    assert.equal(providerCalls.length, 2);
  });

  await t.test('a 20-send daily limit holds across concurrent fresh handler instances', async () => {
    await reset();
    const outcomes = await Promise.all(Array.from({length: 28}, async (_, index) => submit(await freshHandler(),
      request({submissionId: randomUUID(), email: `global-${index}@example.invalid`}, `192.0.2.${index + 1}`))));
    assert.equal(outcomes.filter(res => res.statusCode === 202).length, 20);
    assert.equal(outcomes.filter(res => res.statusCode === 429).length, 8);
    assert.equal(providerCalls.length, 20);
    for (const result of outcomes.filter(res => res.statusCode === 429)) {
      assert.match(result.payload.error, /daily reset/);
      assert.ok(Number(result.headers.get('retry-after')) > 0);
    }
    const dayKey = storageCalls[0][4];
    assert.equal(await redis('GET', dayKey), '20');
  });

  await t.test('a four-per-IP hourly limit holds across concurrent instances with different emails', async () => {
    await reset();
    const outcomes = await Promise.all(Array.from({length: 12}, async (_, index) => submit(await freshHandler(),
      request({submissionId: randomUUID(), email: `ip-${index}@example.invalid`}, '198.51.100.20'))));
    assert.equal(outcomes.filter(res => res.statusCode === 202).length, 4);
    assert.equal(outcomes.filter(res => res.statusCode === 429).length, 8);
    assert.equal(providerCalls.length, 4);
    const ipKey = storageCalls[0][5];
    assert.equal(await redis('GET', ipKey), '4');
    assert.ok(await redis('TTL', ipKey) <= 3600);
    assert.equal(await redis('GET', storageCalls[0][4]), '4');
  });

  await t.test('a four-per-email daily limit holds across concurrent instances with different IPs', async () => {
    await reset();
    const outcomes = await Promise.all(Array.from({length: 12}, async (_, index) => submit(await freshHandler(),
      request({submissionId: randomUUID(), email: index % 2 ? 'Person@Example.invalid' : 'person@example.invalid'}, `203.0.113.${index + 1}`))));
    assert.equal(outcomes.filter(res => res.statusCode === 202).length, 4);
    assert.equal(outcomes.filter(res => res.statusCode === 429).length, 8);
    assert.equal(providerCalls.length, 4);
    const emailKey = storageCalls[0][6];
    assert.equal(await redis('GET', emailKey), '4');
    assert.ok(await redis('TTL', emailKey) <= 86400);
    assert.equal(await redis('GET', storageCalls[0][4]), '4');
  });

  await t.test('provider timeouts retain reservations while safe retries reuse the same delivery key', async () => {
    await reset();
    providerMode = 'timeout';
    const submissionId = randomUUID();
    const first = await submit(await freshHandler(), request({submissionId}));
    const retry = await submit(await freshHandler(), request({submissionId}));
    assert.equal(first.statusCode, 502); assert.equal(retry.statusCode, 502);
    assert.equal(first.payload.reference, retry.payload.reference);
    assert.equal(providerCalls[0].headers['Idempotency-Key'], providerCalls[1].headers['Idempotency-Key']);
    assert.deepEqual(await counters(storageCalls[0]), ['1', '1', '1']);
    const ttl = await redis('TTL', storageCalls[0][3]);
    assert.ok(ttl > 0 && ttl <= 86400);
    for (let index = 0; index < 3; index++) assert.equal((await submit(await freshHandler(), request({submissionId: randomUUID()}))).statusCode, 502);
    assert.equal((await submit(await freshHandler(), request({submissionId: randomUUID()}))).statusCode, 429);
    assert.equal(providerCalls.length, 5);
    assert.deepEqual(await counters(storageCalls[0]), ['4', '4', '4']);
  });

  await t.test('storage outages and malformed reservation responses fail closed before mail delivery', async () => {
    await reset();
    for (const malformed of ['offline', 'http-error', {error: 'invalid'}, {result: [0, 1]},
      {result: [3, 0]}, {result: ['0', 0]}, {result: [6, 60]}, {result: [0, 0, 0]}]) {
      storageMode = malformed;
      const result = await submit(await freshHandler(), request({submissionId: randomUUID()}));
      assert.equal(result.statusCode, 503);
      assert.equal(providerCalls.length, 0);
    }
  });

  await t.test('missing, excessive and corrupt TTL/count states fail closed in the real Lua script', async () => {
    for (const [keyIndex, mutate, retry] of [
      [4, key => redis('PERSIST', key), false],
      [5, key => redis('EXPIRE', key, 7200), false],
      [6, key => redis('SET', key, 'invalid', 'EX', 1000), false],
      [3, key => redis('PERSIST', key), true],
      [3, key => redis('EXPIRE', key, 90000), true],
    ]) {
      await reset();
      const submissionId = randomUUID();
      assert.equal((await submit(await freshHandler(), request({submissionId}))).statusCode, 202);
      await mutate(storageCalls[0][keyIndex]);
      providerCalls.length = 0;
      const result = await submit(await freshHandler(), request({submissionId: retry ? submissionId : randomUUID()}));
      assert.equal(result.statusCode, 503);
      assert.equal(providerCalls.length, 0);
    }
  });

  await t.test('oversized bodies, unsupported origins and spoof-only IPs never reserve or send', async () => {
    await reset();
    const oversized = request({message: 'x'.repeat(13000)});
    assert.equal((await submit(await freshHandler(), oversized)).statusCode, 413);
    const declaredOversized = request(); declaredOversized.headers['content-length'] = '13000';
    assert.equal((await submit(await freshHandler(), declaredOversized)).statusCode, 413);
    const unsupported = request(); unsupported.headers.origin = 'https://untrusted.example.invalid';
    assert.equal((await submit(await freshHandler(), unsupported)).statusCode, 403);
    const spoofOnly = request(); delete spoofOnly.headers['x-vercel-forwarded-for']; spoofOnly.headers['x-forwarded-for'] = '192.0.2.10';
    assert.equal((await submit(await freshHandler(), spoofOnly)).statusCode, 503);
    assert.equal(storageCalls.length, 0); assert.equal(providerCalls.length, 0);
  });
});
