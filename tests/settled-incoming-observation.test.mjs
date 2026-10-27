import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {OBSERVATION_PLAN, EXPECTED_PATCH, verifyCompletedObservation, observationSigners,
  assertObservationConfig, readExactSettledTransfers, decodeProtoFields, validateAuthenticationChallenge} from '../e2e/fixtures/settled-incoming-contract.ts';
import {classifyRequest, createTransportPolicy, GRAPHQL_DOCUMENT_SHA256} from '../scripts/security/settled-observation-transport.mjs';
import {inventory, copyOriginStores, digest} from '../scripts/security/settled-observation-files.mjs';
import {assertArtifactBinding, main, EXECUTION_BLOCK} from '../scripts/security/observe-settled-incoming.mjs';

const plan = OBSERVATION_PLAN[0], other = OBSERVATION_PLAN[1], transfer = plan.transfers[0];
const now = 1_793_060_000_000;
const query = JSON.parse(fs.readFileSync(new URL('./fixtures/settled-observation/queries.graphql.json', import.meta.url), 'utf8'));
const coordinator = 'https://0.spark.lightspark.com';
const key = Buffer.from(plan.identity, 'hex');
const vi = n => {n = BigInt(n); const bytes = []; do {const b = Number(n & 127n); n >>= 7n; bytes.push(b | (n ? 128 : 0));} while (n); return Buffer.from(bytes);};
const field = (n, v) => typeof v === 'bigint' ? Buffer.concat([vi(n << 3), vi(v)]) : Buffer.concat([vi((n << 3) | 2), vi(v.length), Buffer.from(v)]);
const message = fields => Buffer.concat(fields.map(([n, v]) => field(n, v)));
const frame = bytes => {const prefix = Buffer.alloc(5); prefix.writeUInt32BE(bytes.length, 1); return Buffer.concat([prefix, bytes]);};
const directFields = () => [[1, Buffer.from(transfer.id)], [2, 2n]];
const htlcFields = () => [[2, key], [4, 2n], [6, Buffer.from(transfer.id)], [7, 2n]];
const authCore = (ssp = false, pk = key) => message([[1, 1n], [ssp ? 10 : 2, 1793060000n], [ssp ? 20 : 3, Buffer.alloc(32, 1)], [ssp ? 30 : 4, pk]]);
const protectedAuth = (ssp = false, pk = key) => message([[1, 1n], [ssp ? 10 : 2, authCore(ssp, pk)], [ssp ? 20 : 3, Buffer.alloc(32, 2)]]);
const grpc = (name, fields) => ({url: coordinator + '/spark.SparkService/' + name, method: 'POST', contentType: 'application/grpc-web+proto', body: frame(message(fields))});
const gql = (operationName, variables) => ({url: 'https://api.lightspark.com/graphql/spark/rc', method: 'POST', contentType: 'application/json', body: Buffer.from(JSON.stringify({variables, query, operationName}))});
const completed = (id = transfer.id, amount = transfer.amount) => ({paymentId: id, identityPubkey: plan.identity, network: 'regtest', observedAt: now / 1000,
  completed: true, payment: {id, paymentType: 'receive', method: 'spark', status: 'completed', amount: BigInt(amount), fees: 0n}});

test('confirmed namespace blocker prevents execution even with an authorization flag', async t => {
  const previous = process.env.GYS_OBSERVATION_AUTHORIZED;
  t.after(() => {if (previous === undefined) delete process.env.GYS_OBSERVATION_AUTHORIZED; else process.env.GYS_OBSERVATION_AUTHORIZED = previous;});
  process.env.GYS_OBSERVATION_AUTHORIZED = 'settled-regtest-receipts-only';
  assert.equal(EXECUTION_BLOCK, 'BLOCKED_PENDING_SUCCESSOR_STORAGE_PROVENANCE');
  await assert.rejects(main(), {message: EXECUTION_BLOCK});
});

test('three fixed historical receipts are distinct and no send plan is provided', () => {
  const transfers = OBSERVATION_PLAN.flatMap(item => item.transfers);
  assert.equal(transfers.length, 3); assert.equal(new Set(transfers.map(item => item.id)).size, 3);
  assert.deepEqual(transfers.map(item => item.amount).sort(), ['100', '1000', '50']);
  assert.equal(verifyCompletedObservation(completed(), plan, transfer, now, now).completed, true);
});
for (const [name, mutate] of Object.entries({
  'wrong wallet': v => {v.identityPubkey = other.identity;}, 'wrong network': v => {v.network = 'mainnet';},
  'wrong transfer': v => {v.paymentId = other.transfers[0].id;}, 'stale observation': v => {v.observedAt -= 1;},
  'future observation': v => {v.observedAt += 6;}, 'unresolved receipt': v => {v.completed = false;},
  'string completion': v => {v.completed = 'true';}, 'wrong nested id': v => {v.payment.id = other.transfers[0].id;},
  'send receipt': v => {v.payment.paymentType = 'send';}, 'Lightning receipt': v => {v.payment.method = 'lightning';},
  'pending receipt': v => {v.payment.status = 'pending';}, 'wrong amount': v => {v.payment.amount -= 1n;},
  'coerced amount': v => {v.payment.amount = '1000';}, 'unexpected fee': v => {v.payment.fees = 1n;},
  'conversion': v => {v.payment.conversionDetails = {};}, 'token': v => {v.payment.tokenIdentifier = 'token';},
})) test('receipt rejection: ' + name, () => {const value = completed(); mutate(value); assert.throws(() => verifyCompletedObservation(value, plan, transfer, now, now));});

test('exact observer invokes only each fixed raw incoming read, once', async () => {
  const calls = [];
  const raw = new Proxy({observeIncomingTransfer: async id => {calls.push(id); const item = plan.transfers.find(item => item.id === id); return completed(id, item.amount);}},
    {get: (target, key) => {assert.equal(key, 'observeIncomingTransfer'); return target[key];}});
  assert.equal((await readExactSettledTransfers(raw, plan, () => {}, () => now)).length, 2);
  assert.deepEqual(calls, plan.transfers.map(item => item.id));
});
test('missing/error evidence stops at first read with no retry or fallback', async () => {
  let count = 0;
  await assert.rejects(readExactSettledTransfers({observeIncomingTransfer: async () => {count++; throw Error('read unavailable');}}, plan, () => {}, () => now));
  assert.equal(count, 1);
});
test('late observation is discarded after revocation before another read', async () => {
  let finish, live = true, count = 0;
  const pending = readExactSettledTransfers({observeIncomingTransfer: () => {count++; return new Promise(resolve => {finish = resolve;});}}, plan,
    () => {assert(live);}, () => now);
  live = false; finish(completed()); await assert.rejects(pending); assert.equal(count, 1);
});

const resources = (overrides = {}) => ({breezSigner: {free() {}}, sparkSigner: {free() {}, isRemote: () => false,
  getIdentityPublicKey: async () => ({bytes: [...key]}), signAuthenticationChallenge: async () => ({bytes: [1]}), ...overrides}, free() {}});
test('only identity and schema-bound authentication methods reach the underlying signer', async () => {
  const calls = []; const signer = observationSigners(resources({signAuthenticationChallenge: async value => {calls.push(value); return {bytes: [1]};}}), plan.identity);
  assert.deepEqual(await signer.sparkSigner.getIdentityPublicKey(), {bytes: [...key]}); assert.equal(signer.sparkSigner.isRemote(), false);
  await signer.sparkSigner.signAuthenticationChallenge(new Uint8Array(authCore()));
  await signer.sparkSigner.signAuthenticationChallenge(new Uint8Array(protectedAuth(true)));
  assert.equal(calls.length, 2); await signer.dispose();
});
for (const method of ['signMessage', 'signLeafRefundSpend', 'signFrost', 'prepareClaim', 'prepareTransfer', 'prepareStaticDepositClaim',
  'prepareLightningReceive', 'signWatchtowerExitRecovery', 'signEcdsa', 'hmacSha256', 'futureUnknownMethod']) {
  test('signer rejects capability: ' + method, () => {
    let reached = false; const signer = observationSigners(resources({[method]: () => {reached = true;}}), plan.identity);
    assert.throws(() => signer.sparkSigner[method]()); assert.throws(() => signer.breezSigner[method]());
    assert.equal(reached, false); assert.equal(signer.counts().denied, 2);
  });
}
test('signer rejects wrong identity and stale async authentication completions', async () => {
  const wrong = observationSigners(resources({getIdentityPublicKey: async () => ({bytes: [...Buffer.from(other.identity, 'hex')]})}), plan.identity);
  await assert.rejects(wrong.sparkSigner.getIdentityPublicKey());
  let finish; const signer = observationSigners(resources({signAuthenticationChallenge: () => new Promise(resolve => {finish = resolve;})}), plan.identity);
  const pending = signer.sparkSigner.signAuthenticationChallenge(new Uint8Array(authCore())); signer.revoke(); finish({bytes: [1]});
  await assert.rejects(pending); await signer.dispose();
});
test('authentication challenge is validated before the underlying signing call', () => {
  let count = 0;
  for (const bytes of [Buffer.from('arbitrary text'), authCore(false, Buffer.from(other.identity, 'hex')),
    Buffer.concat([authCore(), field(8, Buffer.from('unknown'))]), protectedAuth(true, Buffer.from(other.identity, 'hex'))]) {
    const signer = observationSigners(resources({signAuthenticationChallenge: () => {count++;}}), plan.identity);
    assert.throws(() => signer.sparkSigner.signAuthenticationChallenge(new Uint8Array(bytes)));
  }
  assert.equal(count, 0);
});
for (const failure of ['malformed challenge', 'foreign identity', 'allowed-method failure', 'budget exhaustion', 'payment callback']) {
  test('swallowed ' + failure + ' permanently closes signer and receipt access', async () => {
    let underlyingCalls = 0, observationCalls = 0;
    const signer = observationSigners(resources({
      getIdentityPublicKey: async () => {underlyingCalls++; return {bytes: [...Buffer.from(failure === 'foreign identity' ? other.identity : plan.identity, 'hex')]};},
      signAuthenticationChallenge: async () => {underlyingCalls++; throw Error('underlying failure');},
    }), plan.identity);
    try {
      if (failure === 'malformed challenge') signer.sparkSigner.signAuthenticationChallenge(new Uint8Array([1]));
      else if (failure === 'foreign identity') await signer.sparkSigner.getIdentityPublicKey();
      else if (failure === 'allowed-method failure') await signer.sparkSigner.signAuthenticationChallenge(new Uint8Array(authCore()));
      else if (failure === 'budget exhaustion') for (let i = 0; i < 33; i++) await signer.sparkSigner.getIdentityPublicKey();
      else signer.reject();
    } catch { /* Deliberately model an SDK that catches a failed guard callback. */ }
    assert(signer.counts().denied > 0);
    const previous = underlyingCalls;
    assert.throws(() => signer.sparkSigner.getIdentityPublicKey()); assert.equal(underlyingCalls, previous);
    await assert.rejects(readExactSettledTransfers({observeIncomingTransfer: async () => {observationCalls++; return completed();}}, plan,
      () => signer.assertActive(), () => now));
    assert.equal(observationCalls, 0); await signer.dispose();
  });
}
test('authentication decoder rejects default/duplicate/unknown/type-confused and oversized integer fields', () => {
  assert.equal(validateAuthenticationChallenge(authCore(), plan.identity), 'operator');
  assert.equal(validateAuthenticationChallenge(protectedAuth(true), plan.identity), 'ssp');
  for (const malformed of [Buffer.concat([authCore(), field(1, 1n)]), message([[1, 0n], [2, 1793060000n], [3, Buffer.alloc(32)], [4, key]]),
    message([[1, 1n], [2, Buffer.from('1793060000')], [3, Buffer.alloc(32)], [4, key]]),
    message([[1, 1n], [2, 1793060000n], [3, Buffer.alloc(31)], [4, key]]), Buffer.concat([field(1, 1n), Buffer.from([16, ...Array(9).fill(255), 2])])])
    assert.throws(() => validateAuthenticationChallenge(malformed, plan.identity));
  assert.throws(() => decodeProtoFields(Buffer.from([8, 128, 0])));
});

test('restricted config rejects every active service and non-regtest setting', () => {
  const config = {network: 'regtest', backgroundTasksEnabled: false, privateEnabledDefault: false, preferSparkOverLightning: false,
    leafOptimizationConfig: {autoEnabled: false}, tokenOptimizationConfig: {autoEnabled: false}};
  assertObservationConfig(config);
  for (const [key, value] of [['network', 'mainnet'], ['backgroundTasksEnabled', true], ['apiKey', 'configured'], ['proxy', {}],
    ['realTimeSyncServerUrl', 'https://sync.invalid'], ['stableBalanceConfig', {}], ['crossChainConfig', {}], ['lnurlDomain', 'example.com'],
    ['privateEnabledDefault', true], ['preferSparkOverLightning', true], ['maxDepositClaimFee', {}],
    ['leafOptimizationConfig', {autoEnabled: true}], ['tokenOptimizationConfig', {autoEnabled: true}]])
    assert.throws(() => assertObservationConfig({...config, [key]: value}));
});

test('exact direct-transfer and HTLC request bodies are accepted, offset0 may be omitted', () => {
  assert.equal(classifyRequest(grpc('query_transfers_by_id', directFields()), plan), 'operator-exact-transfer');
  assert.equal(classifyRequest(grpc('query_htlc', htlcFields()), plan), 'operator-exact-htlc');
  assert.equal(classifyRequest(grpc('query_htlc', [...htlcFields(), [5, 0n]]), plan), 'operator-exact-htlc');
});
for (const [name, request] of [
  ['non-regtest', () => grpc('query_transfers_by_id', [[1, Buffer.from(transfer.id)], [2, 1n]])],
  ['foreign ID', () => grpc('query_transfers_by_id', [[1, Buffer.from(other.transfers[0].id)], [2, 2n]])],
  ['duplicate IDs', () => grpc('query_transfers_by_id', [...directFields(), [1, Buffer.from(transfer.id)]])],
  ['unknown field', () => grpc('query_transfers_by_id', [...directFields(), [3, 0n]])],
  ['wrong owner', () => grpc('query_htlc', htlcFields().map(([n, v]) => [n, n === 2 ? Buffer.from(other.identity, 'hex') : v]))],
  ['status Some(0)', () => grpc('query_htlc', [...htlcFields(), [3, 0n]])],
  ['payment hash filter', () => grpc('query_htlc', [...htlcFields(), [1, Buffer.alloc(32)]])],
  ['nonzero offset', () => grpc('query_htlc', [...htlcFields(), [5, 1n]])],
  ['larger page', () => grpc('query_htlc', htlcFields().map(([n, v]) => [n, n === 4 ? 100n : v]))],
  ['wrong role', () => grpc('query_htlc', htlcFields().map(([n, v]) => [n, n === 7 ? 1n : v]))],
]) test('transport rejects ' + name, () => {assert.throws(() => classifyRequest(request(), plan));});
test('every economic endpoint, alternate host, cleartext and malformed frame is rejected', () => {
  const allowed = grpc('query_transfers_by_id', directFields());
  for (const url of [coordinator + '/spark.SparkService/claim_transfer', coordinator + '/spark.SparkService/start_transfer',
    coordinator + '/spark.SparkService/query_all_transfers', 'https://evillightspark.com/spark.SparkService/query_transfers_by_id',
    'http://0.spark.lightspark.com/spark.SparkService/query_transfers_by_id', allowed.url + '?extra=1',
    'https://0.spark.lightspark.com:444/spark.SparkService/query_transfers_by_id'])
    assert.throws(() => classifyRequest({...allowed, url}, plan));
  for (const body of [Buffer.concat([allowed.body, allowed.body]), Buffer.from([1, ...allowed.body.subarray(1)]), allowed.body.subarray(1)])
    assert.throws(() => classifyRequest({...allowed, body}, plan));
});
test('exact pinned GraphQL document and the three named operations are accepted', () => {
  assert.equal(digest(query), GRAPHQL_DOCUMENT_SHA256);
  assert.equal(classifyRequest(gql('Transfers', {transfer_spark_ids: [transfer.id]}), plan), 'ssp-exact-transfers');
  assert.equal(classifyRequest(gql('GetChallenge', {input: {public_key: plan.identity}}), plan), 'ssp-auth-challenge');
  assert.equal(classifyRequest(gql('VerifyChallenge', {input: {protected_challenge: protectedAuth(true).toString('base64url'),
    signature: Buffer.alloc(70, 1).toString('base64url'), identity_public_key: plan.identity, provider: null}}), plan), 'ssp-auth-verify');
});
test('GraphQL altered documents, economic names, variable extras, duplicates and foreign identities are rejected', () => {
  for (const request of [gql('RequestSwap', {input: {}}), gql('Transfers', {transfer_spark_ids: []}),
    gql('Transfers', {transfer_spark_ids: [transfer.id, transfer.id]}), gql('Transfers', {transfer_spark_ids: [transfer.id], extra: 1}),
    gql('GetChallenge', {input: {public_key: other.identity}}),
    gql('VerifyChallenge', {input: {protected_challenge: protectedAuth(true, Buffer.from(other.identity, 'hex')).toString('base64url'),
      signature: Buffer.alloc(70, 1).toString('base64url'), identity_public_key: plan.identity, provider: null}})])
    assert.throws(() => classifyRequest(request, plan));
  const request = gql('Transfers', {transfer_spark_ids: [transfer.id]});
  const body = JSON.parse(request.body); body.query += '\nmutation Surprise { send }';
  assert.throws(() => classifyRequest({...request, body: Buffer.from(JSON.stringify(body))}, plan));
  const duplicate = request.body.toString().replace('"operationName":', '"operationName":"RequestSwap","operationName":');
  assert.throws(() => classifyRequest({...request, body: Buffer.from(duplicate)}, plan));
});
test('operator auth requires exact nested identity, versions, typed timestamp and HMAC', () => {
  const get = {url: coordinator + '/spark_authn.SparkAuthnService/get_challenge', method: 'POST', contentType: 'application/grpc-web+proto', body: frame(message([[1, key]]))};
  assert.equal(classifyRequest(get, plan), 'operator-auth-challenge');
  const verify = protectedChallenge => ({...get, url: coordinator + '/spark_authn.SparkAuthnService/verify_challenge', body: frame(message([[1, protectedChallenge], [2, Buffer.alloc(70, 1)], [3, key]]))});
  assert.equal(classifyRequest(verify(protectedAuth()), plan), 'operator-auth-verify');
  for (const challenge of [protectedAuth(false, Buffer.from(other.identity, 'hex')),
    message([[1, 0n], [2, authCore()], [3, Buffer.alloc(32)]]), message([[1, 1n], [2, authCore()], [3, Buffer.alloc(31)]]),
    message([[1, 1n], [2, authCore()], [3, Buffer.alloc(32)], [4, Buffer.alloc(1)]])])
    assert.throws(() => classifyRequest(verify(challenge), plan));
});
test('request budget and denied websocket/redirect remain visible even after approved calls', () => {
  const policy = createTransportPolicy(plan);
  for (let i = 0; i < 12; i++) policy.authorize(grpc('query_transfers_by_id', directFields()));
  assert.throws(() => policy.authorize(grpc('query_transfers_by_id', directFields())));
  policy.denyWebSocket(); policy.denyRedirect();
  assert.throws(() => policy.authorize(grpc('query_htlc', htlcFields())));
  assert.equal(policy.snapshot().denied, 4); assert.equal(policy.snapshot().counts['operator-exact-htlc'], undefined);
});

test('source artifact gate rejects missing hashes and original0005/mixed source or installation', () => {
  const patch = fs.readFileSync(new URL('../vendor/patches/0006-reconciled-recovery-source.patch', import.meta.url));
  assert.equal(digest(patch), EXPECTED_PATCH);
  const archive = Buffer.from('offline package bytes'), expectedPackage = digest(archive), expectedWasm = digest(Buffer.from('offline WASM bytes'));
  const installedManifest = {sdkSourceCommit: '57c5b9e5f0749f97ffe5d93bce21c994f6957cf4', patchSha256: EXPECTED_PATCH,
    generatedArtifacts: {'web/breez_sdk_spark_wasm_bg.wasm': expectedWasm},
    extensions: ['strict-transfer-evidence-v1', 'atomic-cache-reservation-v1']};
  const bound = {expectedPackage, expectedPatch: EXPECTED_PATCH, expectedWasm, archive, patch, installedManifest, manifest: {...installedManifest, packageSha256: expectedPackage}};
  assertArtifactBinding(bound);
  for (const change of [{expectedPackage: undefined}, {expectedWasm: undefined}, {expectedWasm: '0'.repeat(64)}, {expectedPatch: '0'.repeat(64)}, {archive: Buffer.from('different')},
    {patch: Buffer.from('different')}, {manifest: {...bound.manifest, patchSha256: '0'.repeat(64)}},
    {installedManifest: {...installedManifest, extra: 'unbound'}}]) assert.throws(() => assertArtifactBinding({...bound, ...change}));
});

function temporary(t) {const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gys-observation-offline-')); t.after(() => fs.rmSync(directory, {recursive: true, force: true})); return directory;}
test('profile copy includes only required origin stores, preserves every original file, refuses reuse', async t => {
  const directory = temporary(t), original = path.join(directory, 'original'), clone = path.join(directory, 'clone');
  for (const plan of OBSERVATION_PLAN) {
    for (const store of ['Default/Local Storage/leveldb', 'Default/IndexedDB/http_127.0.0.1_5183.indexeddb.leveldb']) {
      const folder = path.join(original, plan.profile, store); fs.mkdirSync(folder, {recursive: true}); fs.writeFileSync(path.join(folder, 'sample'), 'offline fixture data');
    }
    fs.writeFileSync(path.join(original, plan.profile, 'Default', 'Preferences'), 'must not launch');
    fs.mkdirSync(path.join(original, plan.profile, 'Default', 'Service Worker'));
  }
  const before = await inventory(original); await copyOriginStores(original, clone);
  assert.deepEqual(await inventory(original), before);
  assert(!fs.existsSync(path.join(clone, 'wallet-0/Default/Preferences')));
  assert(!fs.existsSync(path.join(clone, 'wallet-1/Default/Service Worker')));
  assert.equal(fs.readFileSync(path.join(clone, 'wallet-0/Default/Local Storage/leveldb/sample'), 'utf8'), 'offline fixture data');
  await assert.rejects(copyOriginStores(original, clone));
  fs.writeFileSync(path.join(original, 'wallet-0/Default/Preferences'), 'changed');
  assert.notDeepEqual(await inventory(original), before);
});
test('profile inventory refuses symlinks rather than reading a linked secret or external profile', async t => {
  const directory = temporary(t); fs.symlinkSync('/etc/hosts', path.join(directory, 'linked'));
  await assert.rejects(inventory(directory));
});
test('whole-package inventory rejects changed wrapper, extra files and symlinks', t => {
  const directory = temporary(t), installed = path.join(directory, 'installed'), archive = path.join(directory, 'package.tgz');
  fs.mkdirSync(installed); fs.writeFileSync(path.join(installed, 'index.js'), 'export const test = true;');
  execFileSync('python3', ['-c', 'import tarfile,sys\nwith tarfile.open(sys.argv[1],"w:gz") as t: t.add(sys.argv[2]+"/index.js",arcname="package/index.js")', archive, installed]);
  const script = fileURLToPath(new URL('../scripts/security/verify-observation-package.py', import.meta.url));
  const verify = () => JSON.parse(execFileSync('python3', [script, archive, installed], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  assert.equal(verify().files, 1); fs.writeFileSync(path.join(installed, 'index.js'), 'altered'); assert.throws(verify);
  fs.writeFileSync(path.join(installed, 'index.js'), 'export const test = true;'); fs.writeFileSync(path.join(installed, 'extra.js'), 'extra'); assert.throws(verify);
  fs.unlinkSync(path.join(installed, 'extra.js')); fs.symlinkSync('/etc/hosts', path.join(installed, 'link')); assert.throws(verify);
});
