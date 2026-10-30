/** Explicit integration test using a disposable password-protected loopback Redis.
 * Run: node --test tests/rampnow-webhook.integration.mjs
 * Optional binaries: GYS_REDIS_SERVER, GYS_REDIS_CLI. No external API calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {createRampnowStore, RAMPNOW_STORE_PREFIX, COMMIT_SCRIPT, QUARANTINE_SCRIPT} from '../server/rampnowStore.mjs';

const execute = promisify(execFile);
const env = {VERCEL_ENV: 'preview', RAMPNOW_ENVIRONMENT: 'sandbox',
  RAMPNOW_REDIS_REST_URL: 'https://disposable-rampnow.invalid', RAMPNOW_REDIS_REST_TOKEN: 'disposable-token'};
const key = suffix => RAMPNOW_STORE_PREFIX + suffix;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function startRedis(t) {
  const directory = await mkdtemp(join(tmpdir(), 'gys-rampnow-webhook-'));
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const password = randomBytes(24).toString('hex');
  const child = spawn(process.env.GYS_REDIS_SERVER || 'redis-server', ['--port', String(port), '--bind', '127.0.0.1',
    '--requirepass', password, '--save', '', '--appendonly', 'no', '--dir', directory], {stdio: ['ignore', 'pipe', 'pipe']});
  let startupError; let log = '';
  child.on('error', error => { startupError = error; });
  child.stdout.on('data', chunk => { log = (log + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
  const closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  t.after(async () => {
    if (!startupError && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      let timer;
      await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
    await rm(directory, {recursive: true, force: true});
  });
  const command = async (...args) => {
    const {stdout} = await execute(process.env.GYS_REDIS_CLI || 'redis-cli', ['-h', '127.0.0.1', '-p', String(port),
      '--no-auth-warning', '-a', password, '--json', ...args.map(String)],
      {timeout: 5000, maxBuffer: 2 * 1024 * 1024});
    const result = stdout.trim();
    if (result.startsWith('error:')) throw new Error(result);
    return JSON.parse(result);
  };
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (startupError) throw new Error('Disposable Redis unavailable: ' + startupError.message);
    try { if (await command('PING') === 'PONG') return command; } catch { /* Private server startup. */ }
    if (child.exitCode !== null) throw new Error('Disposable Redis stopped: ' + log);
    await pause(25);
  }
  throw new Error('Disposable Redis startup timed out: ' + log);
}
function event(id, status = 'created', updateTime = '2026-10-28T12:00:00Z') {
  return {eventUid: id, eventType: 'ramp_order.status_change', payload: {
    orderUid: 'order-1', externalOrderUid: 'intent-1', orderType: 'buy', orderStatus: status,
    srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin',
    dstFillAmount: status === 'completed' ? '0.0001' : '0', updateTime,
    walletAddress: 'private-address', transactionHash: 'private-payout-reference', email: 'private@example.invalid',
  }};
}
const binding = {environment: 'sandbox', walletPubkey: '02' + 'a'.repeat(64),
  orderUid: 'order-1', externalOrderUid: 'intent-1', orderType: 'buy',
  srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin'};

test('durable RampNow ingestion uses real Redis atomic scripts', async t => {
  const redis = await startRedis(t);
  let time = Date.parse('2026-10-28T12:00:00Z');
  let intercept;
  const fetchImpl = async (url, options) => {
    assert.equal(url, env.RAMPNOW_REDIS_REST_URL + '/');
    assert.equal(options.headers.Authorization, 'Bearer ' + env.RAMPNOW_REDIS_REST_TOKEN);
    const command = JSON.parse(options.body);
    if (intercept) await intercept(command);
    try { return Response.json({result: await redis(...command)}); }
    catch { return Response.json({error: 'Redis command failed'}, {status: 400}); }
  };
  const store = () => createRampnowStore({env, fetchImpl, now: () => time});
  const reset = async () => { intercept = undefined; await redis('FLUSHDB'); };
  const bind = () => redis('SET', key('binding:intent-1'), JSON.stringify(binding));

  await t.test('unbound callbacks are durable, deduplicated and contain no private fields or wallet credit', async () => {
    await reset();
    const outcomes = await Promise.all(Array.from({length: 8}, () => store().ingest(event('unbound'))));
    assert.equal(outcomes.filter(x => x === 'QUARANTINED').length, 1);
    assert.equal(outcomes.filter(x => x === 'DUPLICATE').length, 7);
    assert.equal(await redis('HLEN', key('quarantine')), 1);
    const record = JSON.parse(await redis('HGET', key('quarantine'), 'unbound'));
    assert.equal(record.classification, 'unbound');
    assert.equal(JSON.stringify(record).includes('private'), false);
    assert.equal(await redis('GET', key('state:intent-1')), null);
    assert.ok(await redis('TTL', key('quarantine')) > 0);
  });

  await t.test('bound duplicates commit once, out-of-order events retain newest state and late payment completes', async () => {
    await reset(); await bind();
    const outcomes = await Promise.all(Array.from({length: 6}, () => store().ingest(event('created'))));
    assert.equal(outcomes.filter(x => x === 'ACCEPTED').length, 1);
    assert.equal(outcomes.filter(x => x === 'DUPLICATE').length, 5);
    await store().ingest(event('expired', 'expired', '2026-10-28T12:01:00Z'));
    await Promise.all([
      store().ingest(event('old', 'processing', '2026-10-28T12:00:30Z')),
      store().ingest(event('late', 'completed', '2026-10-28T12:02:00Z')),
    ]);
    const state = JSON.parse(await redis('GET', key('state:intent-1')));
    assert.equal(state.status, 'completed'); assert.equal(state.phase, 'provider_completed');
    assert.equal(state.dstFillAmount, '0.0001'); assert.equal(state.needsReconciliation, true);
    assert.equal(Object.hasOwn(state, 'walletCredited'), false);
    assert.equal(await redis('ZCARD', key('seen')), 4);
  });

  await t.test('CAS retries prevent a paused old worker from overwriting a concurrent new update', async () => {
    await reset(); await bind();
    let inserted = false;
    intercept = async command => {
      if (command[0] === 'EVAL' && command[1] === COMMIT_SCRIPT && !inserted) {
        inserted = true;
        await store().ingest(event('newer', 'completed', '2026-10-28T12:03:00Z'));
      }
    };
    assert.equal(await store().ingest(event('older')), 'ACCEPTED');
    const state = JSON.parse(await redis('GET', key('state:intent-1')));
    assert.equal(state.eventUid, 'newer'); assert.equal(state.status, 'completed');
    assert.equal(await redis('ZCARD', key('seen')), 2);
  });

  await t.test('binding created during quarantine race is re-read and validated before committing', async () => {
    await reset(); let inserted = false;
    intercept = async command => {
      if (command[0] === 'EVAL' && command[1] === QUARANTINE_SCRIPT && !inserted) { inserted = true; await bind(); }
    };
    assert.equal(await store().ingest(event('race')), 'ACCEPTED');
    assert.equal(await redis('HLEN', key('quarantine')), 0);
    assert.equal(JSON.parse(await redis('GET', key('state:intent-1'))).eventUid, 'race');
  });

  await t.test('order mismatch and corrupted Redis types do not write state or mark an event seen', async () => {
    await reset(); await bind();
    const wrong = event('mismatch'); wrong.payload.orderUid = 'different-provider-order';
    await assert.rejects(store().ingest(wrong), /ORDER_MISMATCH/);
    assert.equal(await redis('GET', key('state:intent-1')), null);
    assert.equal(await redis('EXISTS', key('seen')), 0);
    await redis('SET', key('quarantine'), 'wrong-type');
    await assert.rejects(store().ingest(event('bad-type')), /STORE_UNAVAILABLE/);
    assert.equal(await redis('GET', key('state:intent-1')), null);
    assert.equal(await redis('EXISTS', key('seen')), 0);
  });

  await t.test('quarantine capacity fails closed then prunes expired records under ongoing traffic', async () => {
    await reset();
    await redis('EVAL', "for i=1,1000 do redis.call('HSET',KEYS[1],'old-'..i,'{}');redis.call('ZADD',KEYS[2],ARGV[1],'old-'..i) end return 1",
      2, key('quarantine'), key('quarantine-time'), time / 1000);
    await assert.rejects(store().ingest(event('capacity')), /STORE_UNAVAILABLE/);
    assert.equal(await redis('HLEN', key('quarantine')), 1000);
    time += 7 * 86400 * 1000 + 1000;
    assert.equal(await store().ingest(event('after-retention')), 'QUARANTINED');
    assert.equal(await redis('HLEN', key('quarantine')), 1);
    assert.equal(await redis('ZCARD', key('quarantine-time')), 1);
  });

  await t.test('dedupe capacity preserves unacknowledged event and state, then accepts after retention', async () => {
    await reset(); await bind();
    await redis('EVAL', "for i=1,10000 do redis.call('ZADD',KEYS[1],ARGV[1],'seen-'..i) end return 1", 1, key('seen'), time / 1000);
    await assert.rejects(store().ingest(event('capacity')), /STORE_UNAVAILABLE/);
    assert.equal(await redis('GET', key('state:intent-1')), null);
    time += 7 * 86400 * 1000 + 1000;
    assert.equal(await store().ingest(event('after-retention')), 'ACCEPTED');
    assert.equal(await redis('ZCARD', key('seen')), 1);
  });
});
