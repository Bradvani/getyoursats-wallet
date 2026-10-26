import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {BrowserQaError, candidateHeaders, classifyRequest, parseArguments, proxyOptions, safeNetworkFailure, staticManifest} from './native-lightning-browser-qa.mjs';

const state = {identityPubkey: '02' + 'a'.repeat(64), username: 'gysqa1234567890abcdef', defaultUsername: 'gysqa1234567890abcdefold'};
const otherPubkey = '03' + 'b'.repeat(64);
const files = new Map([['/', {path: '/candidate/index.html'}], ['/assets/app.js', {path: '/candidate/assets/app.js'}]]);
const decision = (url, method = 'GET', body) => classifyRequest({url, method, postData: body === undefined ? null : JSON.stringify(body)}, state, files);

test('browser QA requires explicit live intent and accepts only scoped configuration', () => {
  for (const args of [[], ['--state', '/tmp/state', '--dist', '/candidate'],
    ['--allow-live', '--state', '/tmp/state'], ['--allow-live', '--allow-live', '--state', '/tmp/state', '--dist', '/candidate'],
    ['--allow-live', '--state', '/tmp/state', '--dist', '/candidate', '--endpoint', 'https://elsewhere.example'],
    ['--allow-live', '--state', '/tmp/state', '--dist', '/candidate', 'constructor', 'value']]) {
    assert.throws(() => parseArguments(args), error => error instanceof BrowserQaError);
  }
  const parsed = parseArguments(['--allow-live', '--state', '/tmp/state', '--dist', '/candidate', '--browser-executable', '/tmp/chrome']);
  assert.equal(parsed.allowLive && parsed.browserExecutable === '/tmp/chrome', true);
});

test('candidate static assets are served locally while missing assets fail instead of mixing builds', () => {
  assert.equal(decision('https://wallet.getyoursats.com/?network=mainnet').kind, 'static');
  assert.equal(decision('https://wallet.getyoursats.com/assets/app.js').file.path, '/candidate/assets/app.js');
  assert.equal(decision('https://wallet.getyoursats.com/assets/old.js').code, 'candidate_asset_missing');
  assert.equal(decision('https://wallet.getyoursats.com/', 'POST').code, 'unexpected_static_mutation');
  assert.equal(decision('http://wallet.getyoursats.com/').code, 'unexpected_insecure_request');
});

test('exact native and default registration mutations are blocked before reaching the provider', () => {
  for (const domain of ['getyoursats.com', 'breez.tips']) {
    for (const method of ['POST', 'DELETE', 'OPTIONS']) {
      assert.equal(decision(`https://${domain}/lnurlpay/${state.identityPubkey}`, method).kind, 'abort');
    }
    for (const suffix of ['transfer', 'recover/../transfer', '%74ransfer']) {
      assert.equal(decision(`https://${domain}/lnurlpay/${state.identityPubkey}/${suffix}`, 'POST').kind, 'abort');
    }
    assert.equal(decision(`https://${domain}/lnurlpay/${state.identityPubkey}/recover`, 'DELETE').kind, 'abort');
    assert.equal(decision(`https://${domain}/lnurlpay%2f${state.identityPubkey}`, 'POST').kind, 'abort');
  }
});

test('only read operations for the pinned management identity pass through', () => {
  for (const domain of ['getyoursats.com', 'breez.tips']) {
    assert.equal(decision(`https://${domain}/lnurlpay/${state.identityPubkey}/recover`, 'POST').kind, 'continue');
    assert.equal(decision(`https://${domain}/lnurlpay/${state.identityPubkey}/available`, 'POST').kind, 'continue');
    assert.equal(decision(`https://${domain}/lnurlpay/${state.identityPubkey}/metadata?limit=10`).kind, 'continue');
    assert.equal(decision(`https://${domain}/lnurlpay/${otherPubkey}/recover`, 'POST').code, 'unexpected_management_identity');
    assert.equal(decision(`https://${domain}/lnurlpay/${state.identityPubkey}/metadata`, 'POST').kind, 'abort');
  }
});

test('email status is real and email sends, verification attempts and other API mutations are blocked', () => {
  const url = 'https://wallet.getyoursats.com/api/account/email';
  assert.equal(decision(url).kind, 'continue');
  assert.equal(decision(url, 'POST', {action: 'challenge', purpose: 'status', walletPubkey: state.identityPubkey}).kind, 'continue');
  assert.equal(decision(url, 'POST', {action: 'status', challengeId: 'fixture', signature: 'fixture'}).kind, 'continue');
  for (const body of [{action: 'send'}, {action: 'verify'},
    {action: 'challenge', purpose: 'send', walletPubkey: state.identityPubkey},
    {action: 'challenge', purpose: 'status', walletPubkey: otherPubkey}]) {
    assert.equal(decision(url, 'POST', body).code, 'unexpected_email_mutation');
  }
  assert.equal(decision('https://wallet.getyoursats.com/api/contact', 'POST', {}).code, 'unexpected_api_mutation');
  const withFakeApiAsset = new Map([...files, ['/api/account/email', {path: '/candidate/api/account/email'}]]);
  assert.equal(classifyRequest({url, method: 'GET'}, state, withFakeApiAsset).kind, 'continue');
});

test('only exact HTTPS public discovery passes and invoice generation cannot be triggered', () => {
  for (const [domain, name] of [['getyoursats.com', state.username], ['breez.tips', state.defaultUsername]]) {
    for (const path of [`/lnurlp/${name}`, `/.well-known/lnurlp/${name}`]) {
      assert.equal(decision(`https://${domain}${path}`).kind, 'continue');
      assert.equal(decision(`https://${domain}${path}?amount=1000`).kind, 'abort');
    }
    for (const path of [`/lnurlp/${name}/invoice`, `/lnurlp/${name}/%69nvoice`,
      `/lnurlp%2f${name}/invoice`, `/lnurlp/someoneelse`]) {
      assert.equal(decision(`https://${domain}${path}`).code, 'unexpected_payment_request');
    }
  }
});

test('proxy configuration retains credentials internally and supports lowercase environment names', () => {
  assert.equal(proxyOptions({}), undefined);
  const proxy = proxyOptions({http_proxy: 'http://test-user:test%40password@proxy.example:8080'});
  assert.equal(proxy.server, 'http://proxy.example:8080');
  assert.equal(proxy.username, 'test-user');
  assert.equal(proxy.password, 'test@password');
  assert.equal(proxy.server.includes('password'), false);
  assert.equal(proxy.bypass, 'localhost,127.0.0.1,[::1]');
  assert.throws(() => proxyOptions({HTTPS_PROXY: 'socks5://proxy.example:1080'}), error => error.code === 'invalid_proxy');
});

test('network failure diagnostics discard any free text or URL content', () => {
  assert.equal(safeNetworkFailure('net::ERR_CERT_AUTHORITY_INVALID'), 'net::ERR_CERT_AUTHORITY_INVALID');
  assert.equal(safeNetworkFailure('net::ERR_FAILED'), 'net::ERR_FAILED');
  for (const value of [undefined, {}, 'net::ERR_FAILED at https://example.invalid/private',
    'request failed: net::ERR_FAILED', 'net::ERR_FAILED\nprivate input', 'net::err_failed']) {
    assert.equal(safeNetworkFailure(value), null);
  }
});

test('candidate manifest includes exact regular assets and rejects symlink escape', async () => {
  const root = await mkdtemp('/tmp/gys-browser-static-');
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html>');
    await writeFile(join(root, 'assets', 'app.js'), 'export {};');
    const manifest = await staticManifest(root);
    assert.equal(manifest.get('/').path, join(root, 'index.html'));
    assert.equal(manifest.get('/assets/app.js').contentType, 'application/javascript');
    assert.equal(manifest.has('/../state.json'), false);
    await symlink('/etc/hosts', join(root, 'escaped.txt'));
    await assert.rejects(staticManifest(root), error => error.code === 'invalid_candidate');
  } finally {await rm(root, {recursive: true, force: true});}
});

test('candidate responses retain production CSP and browser isolation headers', async () => {
  const headers = await candidateHeaders();
  assert.match(headers['content-security-policy'], /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(headers['content-security-policy'], /connect-src 'self' https: wss:/);
  assert.equal(headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(headers['cross-origin-embedder-policy'], 'require-corp');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['cache-control'], 'no-store');
});
