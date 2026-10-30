import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, ECDH, generateKeyPairSync, sign} from 'node:crypto';
import {hashRampnowPayload, verifyRampnowWalletProof, createRampnowAuth} from '../server/rampnowAuth.mjs';
import {RAMPNOW_STORE_PREFIX} from '../server/rampnowStore.mjs';

const origin = 'https://wallet-preview.example.invalid';
const payloadHash = hashRampnowPayload({amount: '0.0001', currency: 'BTC'});
function wallet() {
  const {publicKey, privateKey} = generateKeyPairSync('ec', {namedCurve: 'secp256k1'});
  const raw = publicKey.export({format: 'der', type: 'spki'}).subarray(-65).toString('hex');
  return {pub: ECDH.convertKey(raw, 'secp256k1', 'hex', 'hex', 'compressed'),
    sign: message => sign('sha256', Buffer.from(message), {key: privateKey, dsaEncoding: 'ieee-p1363'}).toString('hex')};
}
function service(overrides = {}) {
  const records = new Map(); const rates = new Map(); const calls = []; let time = 1800000000000;
  const redis = async (...args) => {
    calls.push(args);
    if (args[0] === 'EVAL') {
      assert.equal(args[2], 2); const keys = args.slice(3, 5); const [limit, ttl] = args.slice(5);
      assert.equal(limit, 25); assert.equal(ttl, 3600);
      for (const key of keys) {
        assert.match(key, /^gys:rampnow:\{sandbox\}:v1:auth:rate:[a-f0-9]{64}$/);
        if ((rates.get(key) ?? 0) >= limit) return 0;
      }
      for (const key of keys) rates.set(key, (rates.get(key) ?? 0) + 1);
      return 1;
    }
    if (args[0] === 'SET') {
      assert.deepEqual(args.slice(3), ['EX', 300, 'NX']);
      if (records.has(args[1])) return null;
      records.set(args[1], args[2]); return 'OK';
    }
    if (args[0] === 'GETDEL') {const found = records.get(args[1]) ?? null; records.delete(args[1]); return found;}
    assert.fail('unexpected Redis command');
  };
  const options = {redis, secret: 'private-api-secret', origin, now: () => time, ...overrides};
  return {auth: createRampnowAuth(options), options, records, rates, calls, advance: ms => {time += ms;}};
}
const issue = (auth, owner, changes = {}) => auth.issue({walletPubkey: owner.pub, action: 'prepare',
  payloadHash, clientKey: '192.0.2.10', ...changes});
const consume = (auth, owner, challenge, changes = {}) => auth.consume({challengeId: challenge.challengeId,
  signature: owner.sign(challenge.message), action: 'prepare', payloadHash, ...changes});

test('canonical payload hashing sorts nested keys, preserves array order and JSON numeric semantics', () => {
  const expected = createHash('sha256').update('{"a":[true,null,0],"z":{"a":"x","b":2}}').digest('hex');
  assert.equal(hashRampnowPayload({z: {b: 2, a: 'x'}, a: [true, null, -0]}), expected);
  assert.equal(hashRampnowPayload({a: [true, null, 0], z: {a: 'x', b: 2}}), expected);
  assert.notEqual(hashRampnowPayload([1, 2]), hashRampnowPayload([2, 1]));
  assert.notEqual(hashRampnowPayload({amount: 1}), hashRampnowPayload({amount: '1'}));
});
test('canonical hash rejects unsupported objects, accessors, hidden fields, holes and cycles without invoking hooks', () => {
  let getterCalled = false; const getter = Object.defineProperty({}, 'x', {enumerable: true, get() {getterCalled = true; return 1;}});
  const hidden = Object.defineProperty({}, 'x', {value: 1});
  const cyclic = {}; cyclic.self = cyclic;
  const extraArray = [1]; extraArray.other = 2;
  const symbol = {}; symbol[Symbol('x')] = 1;
  const inherited = Object.create({inherited: true}); inherited.x = 1;
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol('x'),
    new Date(), new Map(), Buffer.from('x'), Object.create(null), getter, hidden, cyclic, extraArray,
    symbol, inherited, new Array(1), {x: undefined}, {toJSON() {assert.fail('must not call');}}]) {
    assert.throws(() => hashRampnowPayload(value), {code: 'RAMPNOW_PAYLOAD_INVALID'});
  }
  assert.equal(getterCalled, false);
});
test('canonical payload bounds use serialized UTF-8 bytes, depth and node count', () => {
  assert.match(hashRampnowPayload('a'.repeat(16382)), /^[a-f0-9]{64}$/);
  for (const value of ['a'.repeat(16383), '€'.repeat(5500), '\n'.repeat(8192), Array(4096).fill(null)]) {
    assert.throws(() => hashRampnowPayload(value), {code: 'RAMPNOW_PAYLOAD_INVALID'});
  }
  let deep = null; for (let index = 0; index < 34; index++) deep = {deep};
  assert.throws(() => hashRampnowPayload(deep), {code: 'RAMPNOW_PAYLOAD_INVALID'});
});
test('valid compact proof binds wallet, sandbox, origin, action, payload and random challenge', async () => {
  const s = service(); const owner = wallet(); const challenge = await issue(s.auth, owner);
  assert.match(challenge.challengeId, /^[a-f0-9]{36}$/); assert.equal(challenge.expiresIn, 300);
  assert.deepEqual(JSON.parse(challenge.message.slice('gys-rampnow-v1:'.length)),
    ['sandbox', origin, 'prepare', payloadHash, challenge.challengeId, owner.pub]);
  assert.equal(verifyRampnowWalletProof(challenge.message, owner.pub, owner.sign(challenge.message)), true);
  assert.deepEqual(await consume(s.auth, owner, challenge), {walletPubkey: owner.pub, action: 'prepare', payloadHash});
  await assert.rejects(consume(s.auth, owner, challenge), {code: 'RAMPNOW_AUTH_CHALLENGE_EXPIRED'});
});
test('all four actions issue purpose-specific proofs', async () => {
  const s = service(); const owner = wallet();
  for (const action of ['prepare', 'submit', 'status', 'reconcile']) {
    const challenge = await issue(s.auth, owner, {action});
    assert.equal((await consume(s.auth, owner, challenge, {action})).action, action);
  }
});
test('signature verifier rejects other purposes, networks, origins, payloads, wallets and noncompact signatures', async () => {
  const s = service(); const owner = wallet(); const other = wallet(); const c = await issue(s.auth, owner);
  const signature = owner.sign(c.message);
  for (const message of [c.message.replace('gys-rampnow-v1:', 'gys-email-v1:'), c.message.replace('sandbox', 'production'),
    c.message.replace(origin, 'https://other.invalid'), c.message.replace('prepare', 'submit'),
    c.message.replace(payloadHash, 'a'.repeat(64)), c.message + ' ', c.message.replace(owner.pub, other.pub)]) {
    assert.equal(verifyRampnowWalletProof(message, owner.pub, signature), false);
  }
  assert.equal(verifyRampnowWalletProof(c.message, other.pub, signature), false);
  assert.equal(verifyRampnowWalletProof(c.message, '03' + '0'.repeat(64), signature), false);
  for (const bad of ['0'.repeat(128), signature.slice(2), signature + '00', undefined]) {
    assert.equal(verifyRampnowWalletProof(c.message, owner.pub, bad), false);
  }
});
test('invalid action, payload or signature consumes challenge before validation', async () => {
  const owner = wallet();
  for (const changes of [{action: 'submit'}, {action: 'unknown'}, {payloadHash: 'a'.repeat(64)}, {signature: '0'.repeat(128)}]) {
    const s = service(); const c = await issue(s.auth, owner);
    await assert.rejects(consume(s.auth, owner, c, changes), {code: 'RAMPNOW_AUTH_INVALID'});
    await assert.rejects(consume(s.auth, owner, c), {code: 'RAMPNOW_AUTH_CHALLENGE_EXPIRED'});
  }
});
test('concurrent consumption grants exactly one caller', async () => {
  const s = service(); const owner = wallet(); const c = await issue(s.auth, owner);
  const results = await Promise.allSettled(Array.from({length: 8}, () => consume(s.auth, owner, c)));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected' && x.reason.code === 'RAMPNOW_AUTH_CHALLENGE_EXPIRED').length, 7);
});
test('expiry, future timestamp and cross-origin stored challenges fail closed', async () => {
  for (const elapsed of [300000, 300001, -1]) {
    const s = service(); const owner = wallet(); const c = await issue(s.auth, owner); s.advance(elapsed);
    await assert.rejects(consume(s.auth, owner, c), {code: 'RAMPNOW_AUTH_INVALID'});
  }
  const s = service(); const owner = wallet(); const c = await issue(s.auth, owner);
  const other = createRampnowAuth({...s.options, origin: 'https://different.invalid'});
  await assert.rejects(consume(other, owner, c), {code: 'RAMPNOW_AUTH_INVALID'});
});
test('stored wallet cannot be replaced with a caller-supplied wallet', async () => {
  const s = service(); const owner = wallet(); const attacker = wallet(); const c = await issue(s.auth, owner);
  await assert.rejects(consume(s.auth, attacker, c, {walletPubkey: attacker.pub}), {code: 'RAMPNOW_AUTH_INVALID'});
});
test('rate limits both client and wallet using hashed identifiers and a bounded atomic command', async () => {
  const owner = wallet();
  for (const mode of ['client', 'wallet']) {
    const s = service();
    for (let index = 0; index < 25; index++) await issue(s.auth, mode === 'wallet' ? owner : wallet(),
      {clientKey: mode === 'client' ? '192.0.2.10' : '192.0.2.' + (index + 1)});
    await assert.rejects(issue(s.auth, mode === 'wallet' ? owner : wallet()), {code: 'RAMPNOW_AUTH_RATE_LIMITED'});
    const serializedRates = JSON.stringify(s.calls.filter(args => args[0] === 'EVAL'));
    assert.doesNotMatch(serializedRates, /192\.0\.2|private-api-secret/);
    assert.equal(serializedRates.includes(owner.pub), false);
    for (const [key, value] of s.records) {
      assert.ok(key.startsWith(RAMPNOW_STORE_PREFIX + 'auth:challenge:'));
      assert.doesNotMatch(value, /192\.0\.2|private-api-secret/);
    }
  }
});
test('bad configuration and inputs fail before any storage call', async () => {
  for (const config of [{origin: 'http://wallet.invalid'}, {origin: origin + '/'}, {origin: origin + '/path'},
    {origin: 'https://user:password@wallet.invalid'}, {secret: ''}, {redis: null}]) {
    assert.throws(() => service(config), {code: 'RAMPNOW_AUTH_CONFIGURATION_INVALID'});
  }
  const s = service(); const owner = wallet();
  for (const patch of [{action: 'buy'}, {payloadHash: undefined}, {clientKey: ' '}, {walletPubkey: 'bad'},
    {walletPubkey: '03' + '0'.repeat(64)}]) await assert.rejects(issue(s.auth, owner, patch));
  assert.equal(s.calls.length, 0);
});
test('store exceptions, corrupted records and reservation failure are sanitized', async () => {
  const owner = wallet();
  const broken = service({redis: async () => {throw Error('private-token https://private-storage.invalid');}});
  await assert.rejects(issue(broken.auth, owner), error => error.code === 'RAMPNOW_AUTH_UNAVAILABLE'
    && error.message === error.code && !error.cause);
  const failedReservation = service({redis: async op => op === 'EVAL' ? 1 : null});
  await assert.rejects(issue(failedReservation.auth, owner), {code: 'RAMPNOW_AUTH_UNAVAILABLE'});
  for (const raw of ['not-json', 'x'.repeat(2049), '{}', 'null', '[]']) {
    const s = service(); const c = await issue(s.auth, owner);
    s.records.set(RAMPNOW_STORE_PREFIX + 'auth:challenge:' + c.challengeId, raw);
    await assert.rejects(consume(s.auth, owner, c), error => error.code === 'RAMPNOW_AUTH_INVALID'
      && error.message === error.code && !error.cause);
    assert.equal(s.records.size, 0);
  }
});
