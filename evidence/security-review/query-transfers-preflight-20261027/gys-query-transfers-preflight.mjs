#!/usr/bin/env node
/**
 * Stateless method-availability preflight. IMPORTING THIS FILE SENDS NOTHING.
 * Execute only after root's source/build gate approval:
 *   node /tmp/gys-query-transfers-preflight.mjs --execute
 * No wallet, SDK, authentication, signing, claims, faucet, or session creation.
 * An empty response is not absence, non-execution, or provider-acceptance proof.
 */
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LIMITS = Object.freeze({
  maxRequests: 2,
  connectSeconds: 4,
  requestSeconds: 8,
  processMilliseconds: 9000,
  maxHeaderBytes: 8192,
  maxBodyBytes: 8192,
  maxFrames: 2,
});
export const ENDPOINT = 'https://0.spark.lightspark.com/spark.SparkService/query_transfers_by_id';
export const SOURCE = Object.freeze({
  sdkCommit: '57c5b9e5f0749f97ffe5d93bce21c994f6957cf4',
  operatorCommit: '0b3a32a05c9ac06cc411683551dd1f1bde9d0caa',
  network: 'REGTEST',
  networkEnum: 2,
});
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CAPTURE = LIMITS.maxHeaderBytes + LIMITS.maxBodyBytes;
const CRLF = Buffer.from('\r\n\r\n', 'ascii');

export class PreflightError extends Error {
  constructor(code, facts = {}) {
    super(code);
    this.name = 'PreflightError';
    this.code = code;
    this.facts = facts;
  }
}
function reject(code, facts) { throw new PreflightError(code, facts); }

export function encodeRequest(kind, transferId) {
  let payload;
  if (kind === 'unknown-id') {
    if (typeof transferId !== 'string' || !UUID_V4.test(transferId)) reject('invalid_probe_uuid');
    // QueryTransfersByIdRequest: repeated string transfer_ids=1; Network network=2.
    const id = Buffer.from(transferId, 'ascii');
    payload = Buffer.concat([Buffer.from([0x0a, id.length]), id, Buffer.from([0x10, 2])]);
  } else if (kind === 'empty-id-control' && transferId === undefined) {
    payload = Buffer.from([0x10, 2]);
  } else {
    reject('invalid_probe_kind');
  }
  const frame = Buffer.alloc(5);
  frame.writeUInt32BE(payload.length, 1);
  return Buffer.concat([frame, payload]);
}

function parseHeaders(bytes, isTrailer) {
  if (bytes.length > LIMITS.maxHeaderBytes) reject('header_limit');
  // Do not permit folded headers, non-ASCII fields, or bare control characters.
  const raw = bytes.toString('latin1');
  if (/[^\x09\x20-\x7e\r\n]/.test(raw) || /(^|[^\r])\n|\r(?!\n)/.test(raw)) reject('malformed_headers');
  const lines = raw.split('\r\n');
  let httpStatus;
  if (!isTrailer) {
    const match = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: [\x20-\x7e]*)?$/.exec(lines.shift() ?? '');
    if (!match) reject('malformed_http_status');
    httpStatus = Number(match[1]);
  }
  const headers = new Map();
  for (const line of lines) {
    if (line === '') continue;
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[\t ]*([^\r\n]*)$/.exec(line);
    if (!match) reject('malformed_headers');
    const key = match[1].toLowerCase();
    const values = headers.get(key) ?? [];
    values.push(match[2].trim());
    headers.set(key, values);
  }
  for (const key of ['content-type', 'grpc-status', 'grpc-message', 'grpc-status-details-bin']) {
    if ((headers.get(key)?.length ?? 0) > 1) reject('duplicate_critical_header');
  }
  return { httpStatus, headers };
}

function grpcCode(headers) {
  const value = headers.get('grpc-status')?.[0];
  if (value === undefined) return undefined;
  if (!/^(?:[0-9]|1[0-6])$/.test(value)) reject('invalid_grpc_status');
  return Number(value);
}

function readVarint(bytes, start) {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    const byte = bytes[start + i];
    if (byte === undefined) reject('truncated_protobuf');
    if (i === 9 && byte > 1) reject('overflowed_protobuf_varint');
    value |= BigInt(byte & 0x7f) << BigInt(7 * i);
    if ((byte & 0x80) === 0) {
      if (i > 0 && byte === 0) reject('noncanonical_protobuf_varint');
      return { value, next: start + i + 1 };
    }
  }
  reject('overflowed_protobuf_varint');
}

export function decodeEmptyQueryResponse(bytes) {
  let cursor = 0;
  let offset;
  while (cursor < bytes.length) {
    const tag = readVarint(bytes, cursor);
    cursor = tag.next;
    const field = tag.value >> 3n;
    const wire = tag.value & 7n;
    // Never decode, stringify, hash, or persist the contents of a transfer row.
    if (field === 1n) reject('unexpected_transfer_record');
    if (field !== 2n || wire !== 0n) reject('unexpected_protobuf_field');
    if (offset !== undefined) reject('duplicate_offset');
    const encoded = readVarint(bytes, cursor);
    cursor = encoded.next;
    offset = BigInt.asIntN(64, encoded.value);
  }
  // An omitted int64 is zero, not the explicit -1 terminal sentinel.
  if (offset !== -1n) reject('nonterminal_or_missing_offset');
  return { transferCount: 0, offset: '-1' };
}

export function decodeResponse(raw, kind) {
  if (!Buffer.isBuffer(raw) || raw.length > MAX_CAPTURE) reject('capture_limit');
  const split = raw.indexOf(CRLF);
  if (split < 0 || split + CRLF.length > LIMITS.maxHeaderBytes) reject('header_limit_or_incomplete');
  const { httpStatus, headers } = parseHeaders(raw.subarray(0, split), false);
  const body = raw.subarray(split + CRLF.length);
  if (body.length > LIMITS.maxBodyBytes) reject('body_limit');
  const facts = { httpStatus, bodyBytes: body.length };
  if (headers.has('www-authenticate') || headers.has('proxy-authenticate') || headers.has('set-cookie')) reject('auth_or_session_response', facts);
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 407) reject('authentication_required', facts);
  if (headers.has('location') || headers.has('refresh') || (httpStatus >= 300 && httpStatus <= 399)) reject('redirect_forbidden', facts);
  if (headers.get('cf-mitigated')?.some(v => v.toLowerCase().includes('challenge'))) reject('challenge_response', facts);
  if (httpStatus !== 200) reject('unexpected_http_status', facts);
  const contentType = headers.get('content-type')?.[0]?.split(';')[0].trim().toLowerCase();
  if (!['application/grpc-web+proto', 'application/grpc-web'].includes(contentType)) reject('unexpected_content_type', facts);

  const headerStatus = grpcCode(headers);
  let trailerStatus;
  let data;
  let cursor = 0;
  let frames = 0;
  let sawTrailer = false;
  while (cursor < body.length) {
    if (++frames > LIMITS.maxFrames || sawTrailer) reject('unexpected_frame_sequence');
    if (body.length - cursor < 5) reject('truncated_grpc_frame');
    const flag = body[cursor];
    const length = body.readUInt32BE(cursor + 1);
    cursor += 5;
    if (length > LIMITS.maxBodyBytes || length > body.length - cursor) reject('truncated_or_oversized_grpc_frame');
    const frame = body.subarray(cursor, cursor + length);
    cursor += length;
    if (flag === 0) {
      if (data !== undefined) reject('multiple_unary_messages');
      data = frame;
    } else if (flag === 0x80) {
      sawTrailer = true;
      const trailer = parseHeaders(frame, true).headers;
      if (['www-authenticate', 'proxy-authenticate', 'set-cookie', 'location', 'refresh'].some(k => trailer.has(k))) reject('auth_or_redirect_trailer');
      trailerStatus = grpcCode(trailer);
      if (trailerStatus === undefined) reject('missing_grpc_status');
    } else {
      reject('compressed_or_unknown_frame');
    }
  }
  if (headerStatus !== undefined && trailerStatus !== undefined && headerStatus !== trailerStatus) reject('conflicting_grpc_status');
  const grpcStatus = trailerStatus ?? headerStatus;
  if (grpcStatus === undefined) reject('missing_grpc_status');
  if (grpcStatus === 7 || grpcStatus === 16) reject('authentication_required', { ...facts, grpcStatus });
  if (grpcStatus === 12) reject('method_unimplemented', { ...facts, grpcStatus });
  if (kind === 'unknown-id') {
    if (grpcStatus !== 0) reject('unexpected_grpc_status', { ...facts, grpcStatus });
    if (data === undefined) reject('missing_query_response');
    const decoded = decodeEmptyQueryResponse(data);
    return { ...facts, grpcStatus, ...decoded, bodySha256: createHash('sha256').update(body).digest('hex') };
  }
  if (kind === 'empty-id-control') {
    if (grpcStatus !== 3) reject('empty_id_not_rejected_as_invalid', { ...facts, grpcStatus });
    if (data !== undefined) reject('unexpected_negative_control_payload');
    return { ...facts, grpcStatus, validationRejected: true };
  }
  reject('invalid_probe_kind');
}

export const CURL_ARGS = Object.freeze([
  '-q', // First: disable curlrc, including hidden credential/redirect options.
  '--silent', '--show-error', '--proto', '=https', '--http1.1',
  '--request', 'POST', '--connect-timeout', String(LIMITS.connectSeconds),
  '--max-time', String(LIMITS.requestSeconds), '--retry', '0', '--max-redirs', '0',
  '--max-filesize', String(LIMITS.maxBodyBytes), '--suppress-connect-headers',
  '--header', 'Content-Type: application/grpc-web+proto',
  '--header', 'Accept: application/grpc-web+proto', '--header', 'x-grpc-web: 1',
  '--header', 'Authorization:', '--header', 'Cookie:', '--header', 'Expect:',
  '--data-binary', '@-', '--dump-header', '-', '--url', ENDPOINT,
]);

function proxyEnvironment() {
  const env = { ...process.env };
  // Do not inherit optional TLS/session-key diagnostic logging.
  delete env.SSLKEYLOGFILE;
  delete env.QLOGDIR;
  for (const key of ['https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'http_proxy', 'HTTP_PROXY']) {
    const value = env[key];
    if (!value) continue;
    let parsed;
    try { parsed = new URL(value); } catch { reject('invalid_proxy_configuration'); }
    if (parsed.username || parsed.password) reject('proxy_credentials_forbidden');
  }
  return env;
}

async function statelessCurl(request) {
  // curl handles the environment's normal proxy/CA trust. No -k, custom CA,
  // cookie jar, auth option, .netrc, redirect following, or alternate transport.
  const env = proxyEnvironment();
  return new Promise((resolve, rejectPromise) => {
    let child;
    let chunks = [];
    let size = 0;
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks = [];
      if (error) rejectPromise(error); else resolve(result);
    };
    try { child = spawn('curl', CURL_ARGS, { env, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { finish(new PreflightError('transport_spawn_failed')); return; }
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new PreflightError('transport_deadline'));
    }, LIMITS.processMilliseconds);
    child.stdout.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_CAPTURE) {
        child.kill('SIGKILL');
        finish(new PreflightError('capture_limit'));
      } else chunks.push(chunk);
    });
    // Drain diagnostics but never retain or print remote bodies/headers/values.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => finish(new PreflightError('transport_spawn_failed')));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) {
        finish(new PreflightError('transport_failed', { curlExitCode: Number.isInteger(code) ? code : null }));
      } else {
        const response = Buffer.concat(chunks);
        finish(null, response);
      }
    });
    child.stdin.end(request);
  });
}

export async function runPreflight({ transport, uuid = randomUUID } = {}) {
  if (typeof transport !== 'function') reject('explicit_transport_required');
  const report = {
    schema: 1, scope: 'anonymous-query-transfers-by-id-availability-only',
    recordedAt: new Date().toISOString(), endpoint: ENDPOINT, ...SOURCE, limits: LIMITS,
    operatorRequestAttempts: 0, responsesReceived: 0, attempts: [], verdict: 'unresolved',
    providerCompatibilityAccepted: false, fundedAcceptance: false,
    claimsPerformed: false, sessionsCreated: false,
  };
  const id = uuid();
  // Only the freshly generated public probe identifier may enter the report.
  if (typeof id !== 'string' || !UUID_V4.test(id)) reject('invalid_probe_uuid');
  report.probeTransferId = id;
  for (const kind of ['unknown-id', 'empty-id-control']) {
    const started = performance.now();
    const attempt = { kind, ordinal: ++report.operatorRequestAttempts };
    report.attempts.push(attempt);
    try {
      const wire = encodeRequest(kind, kind === 'unknown-id' ? id : undefined);
      const response = await transport(wire);
      report.responsesReceived++;
      Object.assign(attempt, decodeResponse(response, kind), { status: 'expected' });
    } catch (error) {
      attempt.status = 'stopped';
      attempt.reason = error instanceof PreflightError ? error.code : 'local_or_transport_failure';
      if (error instanceof PreflightError) Object.assign(attempt, error.facts);
      attempt.elapsedMilliseconds = Math.round(performance.now() - started);
      return report;
    }
    attempt.elapsedMilliseconds = Math.round(performance.now() - started);
  }
  report.verdict = 'method_and_empty_terminal_response_observed';
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--execute') {
    console.error('No network request sent. After source/build approval, run with the sole argument --execute.');
    process.exitCode = 2;
  } else {
    try {
      const report = await runPreflight({ transport: statelessCurl });
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.verdict === 'method_and_empty_terminal_response_observed' ? 0 : 1;
    } catch (error) {
      console.log(JSON.stringify({ schema: 1, verdict: 'unresolved', reason: error instanceof PreflightError ? error.code : 'local_failure', providerCompatibilityAccepted: false, fundedAcceptance: false }));
      process.exitCode = 1;
    }
  }
}
