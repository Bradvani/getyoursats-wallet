/** Exact, fail-closed auth/read policy. Bodies/headers/challenges never enter reports. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OBSERVATION_ORIGIN, decodeProtoFields, validateAuthenticationChallenge} from '../../e2e/fixtures/settled-incoming-contract.ts';

const COORDINATOR = 'https://0.spark.lightspark.com';
const SSP = 'https://api.lightspark.com/graphql/spark/rc';
const AUTH_GET = '/spark_authn.SparkAuthnService/get_challenge';
const AUTH_VERIFY = '/spark_authn.SparkAuthnService/verify_challenge';
const TRANSFER = '/spark.SparkService/query_transfers_by_id';
const HTLC = '/spark.SparkService/query_htlc';
// Entire document is compiled by graphql_client; operationName selects one of
// the three permitted operations. The hash binds every definition and fragment.
export const GRAPHQL_DOCUMENT_SHA256 = '8b580121176b9e2bdf7f3015da7ae9dd0eefd8a881ba89f35addbc79bb9c31fc';
const sha = data => createHash('sha256').update(data).digest('hex');
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const object = value => {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value;
};

/** Small strict decoder for the four fixed request messages; no response parser. */
export function decodeMessage(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length <= 16384);
  return decodeProtoFields(bytes);
}
function grpcMessage(body, contentType) {
  assert(Buffer.isBuffer(body) && body.length >= 5 && body.length <= 16389);
  assert(/^application\/grpc-web(?:\+proto)?(?:;.*)?$/i.test(contentType));
  assert.equal(body[0], 0); assert.equal(body.readUInt32BE(1), body.length - 5);
  return decodeMessage(body.subarray(5));
}
function exactTags(fields, required, optional = []) {
  for (const key of required) assert(fields.has(key));
  for (const key of fields.keys()) assert(required.includes(key) || optional.includes(key));
}
function identity(bytes, expected) {assert(Buffer.isBuffer(bytes)); assert.equal(bytes.toString('hex'), expected);}
function oneId(bytes, ids) {assert(Buffer.isBuffer(bytes)); const id = bytes.toString('utf8'); assert(ids.includes(id)); return id;}
function canonicalJson(body) {
  assert(Buffer.isBuffer(body) && body.length <= 20000);
  const text = body.toString('utf8'); const parsed = JSON.parse(text);
  // serde_json emits compact JSON. This also rejects duplicate object members,
  // alternate encodings and trailing material before different parsers can disagree.
  assert.equal(JSON.stringify(parsed), text);
  return object(parsed);
}

export function classifyRequest({url: rawUrl, method, contentType = '', body}, plan) {
  const url = new URL(rawUrl);
  assert(!url.username && !url.password && !url.hash);
  if (url.origin === OBSERVATION_ORIGIN) {
    assert.equal(method, 'GET');
    // Local assets only. The runner owns this fresh, strict-port Vite server;
    // it installs no proxy. No localhost POST/PUT/websocket is permitted.
    return 'local-asset';
  }
  assert.equal(url.protocol, 'https:'); assert(!url.search);
  if (method === 'OPTIONS') {
    assert((url.origin === COORDINATOR && [AUTH_GET, AUTH_VERIFY, TRANSFER, HTLC].includes(url.pathname)) || url.href === SSP);
    return 'cors-preflight';
  }
  assert.equal(method, 'POST');
  const ids = plan.transfers.map(item => item.id);
  if (url.origin === COORDINATOR) {
    assert([AUTH_GET, AUTH_VERIFY, TRANSFER, HTLC].includes(url.pathname));
    const fields = grpcMessage(body, contentType);
    if (url.pathname === AUTH_GET) {
      exactTags(fields, [1]); identity(fields.get(1), plan.identity); return 'operator-auth-challenge';
    }
    if (url.pathname === AUTH_VERIFY) {
      exactTags(fields, [1, 2, 3]); identity(fields.get(3), plan.identity);
      assert(Buffer.isBuffer(fields.get(2)) && fields.get(2).length >= 8 && fields.get(2).length <= 80);
      const protectedChallenge = decodeMessage(fields.get(1)); exactTags(protectedChallenge, [1, 2, 3]);
      assert.equal(protectedChallenge.get(1), 1n);
      assert(Buffer.isBuffer(protectedChallenge.get(3)) && protectedChallenge.get(3).length === 32);
      assert.equal(validateAuthenticationChallenge(protectedChallenge.get(2), plan.identity), 'operator');
      return 'operator-auth-verify';
    }
    if (url.pathname === TRANSFER) {
      exactTags(fields, [1, 2]); oneId(fields.get(1), ids); assert.equal(fields.get(2), 2n);
      return 'operator-exact-transfer';
    }
    exactTags(fields, [2, 4, 6, 7], [5]); identity(fields.get(2), plan.identity);
    assert.equal(fields.get(4), 2n); assert.equal(fields.get(5) ?? 0n, 0n); assert.equal(fields.get(7), 2n);
    oneId(fields.get(6), ids); return 'operator-exact-htlc';
  }
  assert.equal(url.href, SSP); assert.match(contentType, /^application\/json(?:;.*)?$/i);
  const request = canonicalJson(body); keys(request, ['operationName', 'query', 'variables']);
  assert.equal(typeof request.query, 'string'); assert.equal(sha(request.query), GRAPHQL_DOCUMENT_SHA256);
  const variables = object(request.variables);
  if (request.operationName === 'Transfers') {
    keys(variables, ['transfer_spark_ids']);
    assert(Array.isArray(variables.transfer_spark_ids) && variables.transfer_spark_ids.length === 1);
    assert(ids.includes(variables.transfer_spark_ids[0])); return 'ssp-exact-transfers';
  }
  keys(variables, ['input']); const input = object(variables.input);
  if (request.operationName === 'GetChallenge') {
    keys(input, ['public_key']); assert.equal(input.public_key, plan.identity); return 'ssp-auth-challenge';
  }
  assert.equal(request.operationName, 'VerifyChallenge');
  keys(input, ['protected_challenge', 'signature', 'identity_public_key', 'provider']);
  assert.equal(input.identity_public_key, plan.identity); assert.equal(input.provider, null);
  for (const key of ['protected_challenge', 'signature']) {
    assert(typeof input[key] === 'string' && input[key].length > 0 && input[key].length <= 6000 && /^[A-Za-z0-9_-]+$/.test(input[key]));
    assert.equal(Buffer.from(input[key], 'base64url').toString('base64url'), input[key]);
  }
  assert.equal(validateAuthenticationChallenge(Buffer.from(input.protected_challenge, 'base64url'), plan.identity), 'ssp');
  const signature = Buffer.from(input.signature, 'base64url'); assert(signature.length >= 8 && signature.length <= 80);
  return 'ssp-auth-verify';
}

export function createTransportPolicy(plan) {
  const counts = {}; let denied = 0; let total = 0;
  return {
    authorize(request) {
      try {
        assert.equal(denied, 0, 'A prior transport violation closes this session');
        const kind = classifyRequest(request, plan);
        if (kind !== 'local-asset') {assert(++total <= 40); assert((counts[kind] ?? 0) < 12);}
        counts[kind] = (counts[kind] ?? 0) + 1;
        return kind;
      } catch {denied++; throw new Error('Request is outside the observation-only transport policy');}
    },
    denyWebSocket() {denied++;},
    denyRedirect() {denied++;},
    snapshot() {return {counts: {...counts}, denied, providerRequests: total};},
  };
}
