import test from 'node:test';
import assert from 'node:assert/strict';
import {ECDH, generateKeyPairSync, sign} from 'node:crypto';
import {Readable} from 'node:stream';
import {createRampnowCheckoutHandler} from '../api/rampnow/checkout.js';
import {RampnowError} from '../server/rampnow.mjs';

const ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const env = {VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: 'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa',
  VERCEL_GIT_COMMIT_REF: 'feat/rampnow-integration-20261028', RAMPNOW_ENVIRONMENT: 'sandbox',
  RAMPNOW_API_KEY: 'private-api-key', RAMPNOW_API_SECRET: 'private-api-secret', RAMPNOW_CHECKOUT_ENABLED: 'true'};
const UNAVAILABLE = {available: false, reason: 'unavailable', network: null, environment: 'sandbox', buyOnly: true};
function wallet() {
  const {publicKey, privateKey} = generateKeyPairSync('ec', {namedCurve: 'secp256k1'});
  return {pub: ECDH.convertKey(publicKey.export({type: 'spki', format: 'der'}).subarray(-65).toString('hex'),
    'secp256k1', 'hex', 'hex', 'compressed'), sign: message => sign('sha256', Buffer.from(message),
    {key: privateKey, dsaEncoding: 'ieee-p1363'}).toString('hex')};
}
function request(body, {method = 'POST', headers = {}, raw} = {}) {
  const bytes = raw ?? Buffer.from(JSON.stringify(body)); const req = Readable.from([bytes]);
  req.method = method;
  req.headers = {origin: ORIGIN, 'content-type': 'application/json', 'content-length': String(bytes.length),
    'x-vercel-forwarded-for': '192.0.2.20', ...headers};
  Object.defineProperty(req, 'body', {get() {assert.fail('must not touch lazy JSON body getter');}});
  return req;
}
async function call(handler, body, options) {
  const res = {statusCode: 0, headers: {}, setHeader(name, value) {this.headers[name] = value;}, end(value) {this.body = JSON.parse(value);}};
  await handler(request(body, options), res); return res;
}
function setup(overrides = {}) {
  const settings = {...env, ...overrides.env}; const records = new Map(); const serviceCalls = []; const factoryCalls = [];
  const redisCalls = []; const redis = async (...args) => {
    redisCalls.push(args);
    if (args[0] === 'EVAL') return 1;
    if (args[0] === 'SET') {if (records.has(args[1])) return null; records.set(args[1], args[2]); return 'OK';}
    if (args[0] === 'GETDEL') {const value = records.get(args[1]) ?? null; records.delete(args[1]); return value;}
    assert.fail('unexpected auth storage call');
  };
  const storeFactory = options => {factoryCalls.push(['store', options]); return {redis};};
  const serviceFactory = options => {
    factoryCalls.push(['service', options]);
    const method = name => async (...args) => {serviceCalls.push([name, ...args]); return {action: name, accepted: true};};
    return {availability: async () => ({available: true, reason: 'ready', network: 'testnet', environment: 'sandbox', buyOnly: true}),
      prepare: method('prepare'), submit: method('submit'), status: method('status'), reconcile: method('reconcile')};
  };
  return {settings, records, serviceCalls, factoryCalls, redisCalls,
    handler: createRampnowCheckoutHandler({env: settings, now: () => 1800000000000, storeFactory, serviceFactory,
      ...overrides, env: settings})};
}
const input = {srcAmount: '1000', destination: 'test-destination'};
const id = '22222222-2222-4222-8222-222222222222';
async function challenge(s, owner, purpose, payload) {
  const result = await call(s.handler, {action: 'challenge', purpose, walletPubkey: owner.pub, payload});
  assert.equal(result.statusCode, 200); return result.body;
}
function authorized(owner, proof, action, payload) {
  return {action, payload, challengeId: proof.challengeId, signature: owner.sign(proof.message)};
}

test('GET availability is coarse and outside-scope requests instantiate no clients', async () => {
  const s = setup();
  assert.deepEqual((await call(s.handler, {}, {method: 'GET'})).body,
    {available: true, reason: 'ready', network: 'testnet', environment: 'sandbox', buyOnly: true});
  for (const patch of [{VERCEL_ENV: 'production'}, {VERCEL_PROJECT_ID: 'other'}, {VERCEL_GIT_COMMIT_REF: 'main'},
    {RAMPNOW_ENVIRONMENT: 'production'}, {RAMPNOW_API_KEY: ''}, {RAMPNOW_API_SECRET: ''}]) {
    const scoped = setup({env: patch});
    assert.deepEqual((await call(scoped.handler, {}, {method: 'GET'})).body, UNAVAILABLE);
    assert.equal((await call(scoped.handler, {})).statusCode, 503);
    assert.equal(scoped.factoryCalls.length, 0);
  }
});
test('exact origin and JSON content type are required before constructing clients', async () => {
  for (const headers of [{origin: undefined}, {origin: ORIGIN + '/'}, {origin: 'https://attacker.invalid'},
    {origin: ORIGIN + '.attacker.invalid'}, {origin: [ORIGIN]}, {'content-type': 'text/plain'},
    {'content-type': undefined}, {'content-type': ['application/json']}]) {
    const s = setup(); const response = await call(s.handler, {}, {headers});
    assert.equal(response.statusCode, Object.hasOwn(headers, 'origin') ? 403 : 400);
    assert.equal(s.factoryCalls.length, 0); assert.equal(response.headers['Access-Control-Allow-Origin'], undefined);
  }
});
test('API enforces method, declared/streamed byte limits, UTF-8 and untouched raw stream', async () => {
  const s = setup();
  const unsupported = await call(s.handler, {}, {method: 'OPTIONS'});
  assert.equal(unsupported.statusCode, 405); assert.equal(unsupported.headers.Allow, 'GET, POST');
  for (const options of [{headers: {'content-length': '16385'}}, {headers: {'content-length': 'bad'}},
    {raw: Buffer.alloc(16385, 32), headers: {'content-length': undefined}},
    {raw: Buffer.alloc(16385, 32), headers: {'content-length': '1'}}]) {
    assert.equal((await call(s.handler, {}, options)).statusCode, 413);
  }
  for (const raw of [Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(0)]) {
    assert.equal((await call(s.handler, {}, {raw})).statusCode, 400);
  }
  assert.equal(s.factoryCalls.length, 0);
});
test('extra body fields, payload fields and unsupported actions are rejected', async () => {
  const owner = wallet();
  const base = {action: 'challenge', purpose: 'prepare', walletPubkey: owner.pub, payload: {input}};
  for (const body of [null, [], {...base, clientKey: 'spoofed'}, {...base, purpose: 'pay'},
    {...base, payload: {input, extra: true}}, {...base, payload: {input: []}},
    {...base, purpose: 'status', payload: {externalOrderUid: id, input}},
    {...base, purpose: 'submit', payload: {externalOrderUid: id, input, quoteHash: 'bad'}},
    {action: 'status', payload: {externalOrderUid: id}, challengeId: 'a'.repeat(36), signature: 'a'.repeat(128), walletPubkey: owner.pub}]) {
    const s = setup(); assert.equal((await call(s.handler, body)).statusCode, 400); assert.equal(s.factoryCalls.length, 0);
  }
});
test('challenge client key must be a single Vercel-asserted IP address', async () => {
  const owner = wallet();
  for (const ip of [undefined, ['192.0.2.1'], '192.0.2.1,192.0.2.2', ' 192.0.2.1', 'spoofed']) {
    const s = setup(); const response = await call(s.handler,
      {action: 'challenge', purpose: 'prepare', walletPubkey: owner.pub, payload: {input}},
      {headers: {'x-vercel-forwarded-for': ip}});
    assert.equal(response.statusCode, 400); assert.equal(s.factoryCalls.length, 0);
  }
});
test('all actions dispatch with the pinned wallet from a real one-time signed proof', async () => {
  const s = setup(); const owner = wallet();
  for (const [action, payload, args] of [['prepare', {input}, [input]],
    ['submit', {externalOrderUid: id, input, quoteHash: 'a'.repeat(64)}, [{externalOrderUid: id, input, quoteHash: 'a'.repeat(64)}]],
    ['status', {externalOrderUid: id}, [id]], ['reconcile', {externalOrderUid: id}, [id]]]) {
    const proof = await challenge(s, owner, action, payload);
    const response = await call(s.handler, authorized(owner, proof, action, payload));
    assert.equal(response.statusCode, 200); assert.deepEqual(s.serviceCalls.at(-1), [action, owner.pub, ...args]);
    assert.equal((await call(s.handler, authorized(owner, proof, action, payload))).statusCode, 401);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['Vercel-CDN-Cache-Control'], 'no-store');
  }
  assert.equal(s.serviceCalls.length, 4);
});
test('tampered payload, purpose or signing wallet burns proof without invoking the service', async () => {
  for (const mode of ['payload', 'action', 'wallet']) {
    const s = setup(); const owner = wallet(); const payload = {externalOrderUid: id};
    const proof = await challenge(s, owner, 'status', payload);
    const body = authorized(mode === 'wallet' ? wallet() : owner, proof, mode === 'action' ? 'reconcile' : 'status',
      mode === 'payload' ? {externalOrderUid: 'different-id'} : payload);
    assert.equal((await call(s.handler, body)).statusCode, 401);
    assert.equal((await call(s.handler, authorized(owner, proof, 'status', payload))).statusCode, 401);
    assert.equal(s.serviceCalls.length, 0);
    assert.equal(s.factoryCalls.filter(([name]) => name === 'service').length, 0);
  }
});
test('kill switch blocks prepare/submit but preserves authenticated status and reconciliation', async () => {
  const s = setup({env: {RAMPNOW_CHECKOUT_ENABLED: 'false'}}); const owner = wallet();
  for (const [purpose, payload] of [['prepare', {input}], ['submit', {externalOrderUid: id, input, quoteHash: 'a'.repeat(64)}]]) {
    assert.equal((await call(s.handler, {action: 'challenge', purpose, walletPubkey: owner.pub, payload})).statusCode, 503);
    assert.equal((await call(s.handler, {action: purpose, payload, challengeId: 'a'.repeat(36), signature: 'a'.repeat(128)})).statusCode, 503);
  }
  assert.equal(s.factoryCalls.length, 0);
  for (const action of ['status', 'reconcile']) {
    const payload = {externalOrderUid: id}; const proof = await challenge(s, owner, action, payload);
    assert.equal((await call(s.handler, authorized(owner, proof, action, payload))).statusCode, 200);
  }
});
test('switch disabled after proof issuance prevents subsequent submission', async () => {
  const s = setup(); const owner = wallet(); const payload = {input};
  const proof = await challenge(s, owner, 'prepare', payload); s.settings.RAMPNOW_CHECKOUT_ENABLED = 'false';
  assert.equal((await call(s.handler, authorized(owner, proof, 'prepare', payload))).statusCode, 503);
  assert.equal(s.serviceCalls.length, 0);
});
test('errors expose fixed codes only, preserving auth/rate/conflict distinctions', async () => {
  for (const [error, status, expected] of [[new Error('private-api-secret profile@example.invalid'), 503, 'RAMPNOW_UNAVAILABLE'],
    [new RampnowError('private-api-secret'), 503, 'RAMPNOW_UNAVAILABLE'],
    [new RampnowError('RAMPNOW_AUTH_INVALID'), 401, 'RAMPNOW_AUTH_INVALID'],
    [new RampnowError('RAMPNOW_AUTH_RATE_LIMITED'), 429, 'RAMPNOW_AUTH_RATE_LIMITED'],
    [new RampnowError('RAMPNOW_INTENT_CONFLICT'), 409, 'RAMPNOW_INTENT_CONFLICT'],
    [new RampnowError('RAMPNOW_CHECKOUT_PROFILE_INVALID'), 400, 'RAMPNOW_CHECKOUT_PROFILE_INVALID']]) {
    const s = setup({authFactory: () => ({consume: async () => {throw error;}})});
    const response = await call(s.handler, {action: 'status', payload: {externalOrderUid: id},
      challengeId: 'a'.repeat(36), signature: 'a'.repeat(128)});
    assert.equal(response.statusCode, status); assert.deepEqual(response.body, {error: expected});
    assert.doesNotMatch(JSON.stringify(response.body), /private|profile@/);
  }
  const s = setup({storeFactory: () => {throw new Error('private-storage-token');}});
  assert.deepEqual((await call(s.handler, {}, {method: 'GET'})).body, UNAVAILABLE);
});
