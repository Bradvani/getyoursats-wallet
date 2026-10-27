import test from 'node:test';
import assert from 'node:assert/strict';
import { CURL_ARGS, ENDPOINT, LIMITS, PreflightError, decodeEmptyQueryResponse, decodeResponse, encodeRequest, runPreflight } from './gys-query-transfers-preflight.mjs';

const ID = '9f417f0d-d137-4775-a2b9-dc2deacfc843';
const minusOne = Buffer.from([0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
const frame = (payload, flags = 0) => {
  payload = Buffer.from(payload);
  const h = Buffer.alloc(5); h[0] = flags; h.writeUInt32BE(payload.length, 1);
  return Buffer.concat([h, payload]);
};
const trailer = text => frame(Buffer.from(text, 'ascii'), 0x80);
const http = (body, { status = '200 OK', headers = '' } = {}) => Buffer.concat([
  Buffer.from(`HTTP/1.1 ${status}\r\nContent-Type: application/grpc-web+proto\r\n${headers}\r\n`, 'ascii'), body,
]);
const good = () => http(Buffer.concat([frame(minusOne), trailer('grpc-status: 0\r\n')]));
const invalid = () => http(trailer('grpc-status: 3\r\ngrpc-message: missing%20ids\r\n'));
const fails = (fn, code) => assert.throws(fn, e => e instanceof PreflightError && e.code === code);

test('request wire contains only one canonical UUID and explicit REGTEST2', () => {
  const wire = encodeRequest('unknown-id', ID);
  assert.equal(wire.length, 45); assert.equal(wire[0], 0); assert.equal(wire.readUInt32BE(1), 40);
  assert.deepEqual(wire.subarray(5), Buffer.concat([Buffer.from([10, 36]), Buffer.from(ID), Buffer.from([16, 2])]));
  assert.deepEqual(encodeRequest('empty-id-control'), Buffer.from([0, 0, 0, 0, 2, 16, 2]));
});
test('request rejects noncanonical or supplied-empty-control identifiers', () => {
  for (const id of ['', ID.toUpperCase(), '00000000-0000-0000-0000-000000000000', ID + '\n', null]) fails(() => encodeRequest('unknown-id', id), 'invalid_probe_uuid');
  fails(() => encodeRequest('empty-id-control', ID), 'invalid_probe_kind');
});
test('protobuf decodes explicit signed int64 minus-one terminal', () => {
  assert.deepEqual(decodeEmptyQueryResponse(minusOne), { transferCount: 0, offset: '-1' });
});
test('missing/default/nonterminal offsets cannot pass', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from([16, 0]), Buffer.from([16, 1])]) fails(() => decodeEmptyQueryResponse(bytes), 'nonterminal_or_missing_offset');
});
test('unexpected transfer is rejected before its payload is decoded', () => {
  fails(() => decodeEmptyQueryResponse(Buffer.concat([Buffer.from([10, 255]), Buffer.from('DO-NOT-RECORD')])), 'unexpected_transfer_record');
});
test('duplicate offset and unknown fields fail', () => {
  fails(() => decodeEmptyQueryResponse(Buffer.concat([minusOne, minusOne])), 'duplicate_offset');
  fails(() => decodeEmptyQueryResponse(Buffer.from([24, 0])), 'unexpected_protobuf_field');
});
test('truncated/overflowed/noncanonical protobuf varints fail', () => {
  fails(() => decodeEmptyQueryResponse(Buffer.from([16, 128])), 'truncated_protobuf');
  fails(() => decodeEmptyQueryResponse(Buffer.from([16, ...Array(10).fill(255)])), 'overflowed_protobuf_varint');
  fails(() => decodeEmptyQueryResponse(Buffer.from([16, 128, 0])), 'noncanonical_protobuf_varint');
});
test('binary grpc-web success requires terminal protobuf and status', () => {
  const value = decodeResponse(good(), 'unknown-id');
  assert.equal(value.httpStatus, 200); assert.equal(value.grpcStatus, 0); assert.equal(value.offset, '-1');
  assert.equal(value.transferCount, 0); assert.match(value.bodySha256, /^[0-9a-f]{64}$/);
});
test('negative control decodes trailer-only InvalidArgument', () => {
  const value = decodeResponse(invalid(), 'empty-id-control');
  assert.equal(value.grpcStatus, 3); assert.equal(value.validationRejected, true);
});
test('grpc status may be in initial headers, including trailers-only errors', () => {
  assert.equal(decodeResponse(http(frame(minusOne), { headers: 'grpc-status: 0\r\n' }), 'unknown-id').offset, '-1');
  assert.equal(decodeResponse(http(Buffer.alloc(0), { headers: 'grpc-status: 3\r\n' }), 'empty-id-control').grpcStatus, 3);
});
test('HTTP200 without grpc-status does not pass', () => {
  fails(() => decodeResponse(http(frame(minusOne)), 'unknown-id'), 'missing_grpc_status');
});
test('conflicting or duplicate grpc status fails', () => {
  fails(() => decodeResponse(http(Buffer.concat([frame(minusOne), trailer('grpc-status: 0\r\n')]), { headers: 'grpc-status: 3\r\n' }), 'unknown-id'), 'conflicting_grpc_status');
  fails(() => decodeResponse(http(trailer('grpc-status: 0\r\ngrpc-status: 0\r\n')), 'unknown-id'), 'duplicate_critical_header');
});
test('invalid grpc status spellings fail', () => {
  for (const code of ['00', '+0', '-1', '17', '0, 3']) fails(() => decodeResponse(http(trailer(`grpc-status: ${code}\r\n`)), 'unknown-id'), 'invalid_grpc_status');
});
test('authentication and unimplemented statuses stop', () => {
  for (const code of [7, 16]) fails(() => decodeResponse(http(trailer(`grpc-status: ${code}\r\n`)), 'unknown-id'), 'authentication_required');
  fails(() => decodeResponse(http(trailer('grpc-status: 12\r\n')), 'unknown-id'), 'method_unimplemented');
});
test('HTTP auth, redirect, session cookie and challenge stop', () => {
  fails(() => decodeResponse(http(Buffer.alloc(0), { status: '401 Unauthorized' }), 'unknown-id'), 'authentication_required');
  fails(() => decodeResponse(http(Buffer.alloc(0), { status: '302 Found', headers: 'Location: https://example.invalid/\r\n' }), 'unknown-id'), 'redirect_forbidden');
  fails(() => decodeResponse(http(Buffer.alloc(0), { headers: 'Set-Cookie: do-not-record=x\r\n' }), 'unknown-id'), 'auth_or_session_response');
  fails(() => decodeResponse(http(Buffer.alloc(0), { headers: 'cf-mitigated: challenge\r\n' }), 'unknown-id'), 'challenge_response');
});
test('HTML/text response cannot be mistaken for protobuf success', () => {
  const raw = Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nchallenge');
  fails(() => decodeResponse(raw, 'unknown-id'), 'unexpected_content_type');
});
test('compressed and unknown frame flags fail', () => {
  for (const flags of [1, 0x81, 2]) fails(() => decodeResponse(http(frame(minusOne, flags)), 'unknown-id'), 'compressed_or_unknown_frame');
});
test('truncated header, truncated payload and oversized frame fail', () => {
  fails(() => decodeResponse(http(Buffer.from([0, 0, 0])), 'unknown-id'), 'truncated_grpc_frame');
  fails(() => decodeResponse(http(Buffer.from([0, 0, 0, 0, 1])), 'unknown-id'), 'truncated_or_oversized_grpc_frame');
  const h = Buffer.alloc(5); h.writeUInt32BE(LIMITS.maxBodyBytes + 1, 1);
  fails(() => decodeResponse(http(h), 'unknown-id'), 'truncated_or_oversized_grpc_frame');
});
test('multiple unary messages and data after trailers fail', () => {
  fails(() => decodeResponse(http(Buffer.concat([frame(minusOne), frame(minusOne)])), 'unknown-id'), 'multiple_unary_messages');
  fails(() => decodeResponse(http(Buffer.concat([trailer('grpc-status: 0\r\n'), frame(minusOne)])), 'unknown-id'), 'unexpected_frame_sequence');
});
test('body/header capture caps are enforced', () => {
  fails(() => decodeResponse(Buffer.alloc(LIMITS.maxHeaderBytes + LIMITS.maxBodyBytes + 1), 'unknown-id'), 'capture_limit');
  fails(() => decodeResponse(http(Buffer.alloc(LIMITS.maxBodyBytes + 1)), 'unknown-id'), 'body_limit');
  fails(() => decodeResponse(Buffer.from('HTTP/1.1 200 OK\r\nX: ' + 'a'.repeat(LIMITS.maxHeaderBytes) + '\r\n\r\n'), 'unknown-id'), 'header_limit_or_incomplete');
});
test('negative control cannot return successful or populated payload', () => {
  fails(() => decodeResponse(good(), 'empty-id-control'), 'empty_id_not_rejected_as_invalid');
  fails(() => decodeResponse(http(Buffer.concat([frame(Buffer.from([10, 0])), trailer('grpc-status: 3\r\n')])), 'empty-id-control'), 'unexpected_negative_control_payload');
});
test('curl invocation pins endpoint and forbids credentials, redirects and retry options', () => {
  assert.equal(CURL_ARGS[0], '-q'); assert.equal(CURL_ARGS.at(-1), ENDPOINT);
  assert.equal(CURL_ARGS.filter(v => v === '--url').length, 1);
  for (const forbidden of ['-k', '--insecure', '-L', '--location', '--location-trusted', '--netrc', '--user', '--cookie', '--cookie-jar', '--cert', '--key']) assert(!CURL_ARGS.includes(forbidden));
  assert(CURL_ARGS.includes('Authorization:')); assert(CURL_ARGS.includes('Cookie:'));
  assert.equal(CURL_ARGS[CURL_ARGS.indexOf('--retry') + 1], '0');
  assert.equal(CURL_ARGS[CURL_ARGS.indexOf('--max-time') + 1], '8');
});
test('successful synthetic flow performs exactly two reads and never claims acceptance', async () => {
  const sent = [];
  const report = await runPreflight({ uuid: () => ID, transport: async wire => { sent.push(wire); return sent.length === 1 ? good() : invalid(); } });
  assert.equal(sent.length, 2); assert.equal(report.operatorRequestAttempts, 2); assert.equal(report.responsesReceived, 2);
  assert.deepEqual(sent[0], encodeRequest('unknown-id', ID)); assert.deepEqual(sent[1], encodeRequest('empty-id-control'));
  assert.equal(report.verdict, 'method_and_empty_terminal_response_observed');
  assert.equal(report.providerCompatibilityAccepted, false); assert.equal(report.fundedAcceptance, false);
});
test('unexpected transfer stops after one read without recording returned payload', async () => {
  let calls = 0;
  const sensitive = Buffer.from('RETURNED-TRANSFER-MUST-NOT-APPEAR');
  const response = http(Buffer.concat([frame(Buffer.concat([Buffer.from([10, sensitive.length]), sensitive])), trailer('grpc-status: 0\r\n')]));
  const report = await runPreflight({ uuid: () => ID, transport: async () => { calls++; return response; } });
  assert.equal(calls, 1); assert.equal(report.attempts[0].reason, 'unexpected_transfer_record');
  assert(!JSON.stringify(report).includes(sensitive.toString())); assert(!('bodySha256' in report.attempts[0]));
});
test('auth or transport failure is not retried and skips negative control', async () => {
  for (const mode of ['auth', 'transport']) {
    let calls = 0;
    const report = await runPreflight({ uuid: () => ID, transport: async () => { calls++; if (mode === 'transport') throw Error('NEVER-LOG-REMOTE-DETAIL'); return http(trailer('grpc-status: 16\r\n')); } });
    assert.equal(calls, 1); assert.equal(report.operatorRequestAttempts, 1); assert.equal(report.verdict, 'unresolved');
    assert(!JSON.stringify(report).includes('NEVER-LOG-REMOTE-DETAIL'));
  }
});
test('second-response failure stops at two requests', async () => {
  let calls = 0;
  const report = await runPreflight({ uuid: () => ID, transport: async () => ++calls === 1 ? good() : good() });
  assert.equal(calls, 2); assert.equal(report.verdict, 'unresolved');
  assert.equal(report.attempts[1].reason, 'empty_id_not_rejected_as_invalid');
});
test('imported flow cannot implicitly obtain a real transport', async () => {
  await assert.rejects(runPreflight(), e => e.code === 'explicit_transport_required');
});
