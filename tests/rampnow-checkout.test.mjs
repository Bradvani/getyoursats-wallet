import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bech32, bech32m, createBase58check} from '@scure/base';
import {createRampnowCheckoutClient, normalizeRampnowBuyInput} from '../server/rampnowCheckout.mjs';
import {rampnowSignature} from '../server/rampnow.mjs';

const base58check = createBase58check(bytes => createHash('sha256').update(bytes).digest());
const witness = (prefix = 'tb', version = 0, length = 20, coder = version === 0 ? bech32 : bech32m) =>
  coder.encode(prefix, [version, ...coder.toWords(Uint8Array.from({length}, (_, i) => i + 1))]);
const legacy = (version = 0x6f, length = 20) => base58check.encode(Uint8Array.from([version, ...Array(length).fill(3)]));
const user = {email: 'sandbox-tester@example.com', firstName: 'Sandbox', lastName: 'Tester',
  phone: '+919876543210', dateOfBirth: '1990-02-28', gender: 'unknown', country: 'IN'};
const input = {srcAmount: '1000.00', destination: witness(), network: 'signet', user};
const externalOrderUid = 'e4973df9-bfe8-49c6-821d-2ee5fed9fb93';
const returnUrl = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app/rampnow/return?intent=' + externalOrderUid;
const redirectUrl = 'https://app.sandbox.rampnow.io/checkout?orderUid=provider-order-1&token=fixture';
const result = {orderUid: 'provider-order-1', userUid: 'provider-user-1', redirectUrl};
const response = data => new Response(JSON.stringify({code: 0, data}), {status: 200});
const timestamp = '1772080882';
const secret = 'checkout-fixture-secret';
const config = {apiKey: 'checkout-fixture-key', apiSecret: secret, now: () => Number(timestamp) * 1000};
const request = {externalOrderUid, input, returnUrl};

test('normalizes only the explicit customer input, retaining exact money without rounding', () => {
  const normalized = normalizeRampnowBuyInput({...input, webhookUrl: 'private-extra', partnerPctFee: 20,
    user: {...user, email: ' SANDBOX-TESTER@EXAMPLE.COM ', firstName: ' Sandbox ', bankAccountDetail: 'private-extra'}});
  assert.deepEqual(normalized, {...input, srcAmount: '1000'});
  assert.notEqual(normalized.user, input.user);
  assert.equal(normalizeRampnowBuyInput({...input, srcAmount: '0.01'}).srcAmount, '0.01');
  assert.equal(normalizeRampnowBuyInput({...input, srcAmount: '999999999999.99'}).srcAmount, '999999999999.99');
});

test('accepts checksummed testnet witness and legacy addresses for explicitly chosen test networks', () => {
  for (const destination of [witness(), witness('tb', 0, 32), witness('tb', 1, 32), legacy(), legacy(0xc4)]) {
    for (const network of ['testnet', 'signet']) {
      assert.equal(normalizeRampnowBuyInput({...input, destination, network}).destination, destination);
    }
  }
  assert.equal(normalizeRampnowBuyInput({...input, destination: witness().toUpperCase()}).destination, witness());
});

for (const [label, destination] of [
  ['mainnet witness', witness('bc')], ['mainnet legacy', legacy(0)], ['mainnet script hash', legacy(5)],
  ['regtest witness', witness('bcrt')], ['bad witness checksum', witness().slice(0, -1) + 'q'],
  ['bad legacy checksum', legacy().slice(0, -1) + '1'], ['mixed witness case', 'TB' + witness().slice(2)],
  ['v0 bech32m checksum', witness('tb', 0, 20, bech32m)], ['v1 bech32 checksum', witness('tb', 1, 32, bech32)],
  ['wrong v0 program length', witness('tb', 0, 21)], ['invalid witness version', witness('tb', 17, 32)],
  ['short witness program', witness('tb', 1, 1)], ['long witness program', witness('tb', 1, 41)],
  ['wrong legacy payload length', legacy(0x6f, 19)], ['unsupported legacy version', legacy(0x42)],
  ['Bitcoin URI', 'bitcoin:' + witness()], ['surrounding whitespace', ' ' + witness()],
]) test('rejects ' + label + ' before any provider request', () => {
  assert.throws(() => normalizeRampnowBuyInput({...input, destination}), /RAMPNOW_CHECKOUT_ADDRESS_INVALID/);
});

test('rejects mainnet, regtest, missing and unknown wallet network independently of address encoding', () => {
  for (const network of ['mainnet', 'regtest', undefined, 'testnet4', 'private-network']) {
    assert.throws(() => normalizeRampnowBuyInput({...input, network}), /RAMPNOW_CHECKOUT_NETWORK_INVALID/);
  }
});

test('rejects invalid INR amounts rather than coercing or rounding', () => {
  for (const srcAmount of ['0', '0.00', '-1', '1e3', '01', '1.', '1.001', '1000000000000', ' 1', 1000, undefined]) {
    assert.throws(() => normalizeRampnowBuyInput({...input, srcAmount}), /RAMPNOW_AMOUNT_INVALID/);
  }
});

test('requires all seven profile fields and rejects malformed or future values', () => {
  for (const field of Object.keys(user)) {
    assert.throws(() => normalizeRampnowBuyInput({...input, user: {...user, [field]: undefined}}), /RAMPNOW_CHECKOUT_PROFILE_INVALID/);
  }
  for (const changes of [{email: 'private-invalid'}, {phone: '9876543210'}, {phone: '+0123456789'},
    {firstName: ''}, {firstName: 'A'.repeat(101)}, {lastName: 'Private\nTester'},
    {dateOfBirth: '1990-02-30'}, {dateOfBirth: '2025-02-29'}, {dateOfBirth: '2999-01-01'},
    {dateOfBirth: '1990-2-28'}, {gender: 'private-invalid'}, {country: 'US'}, {country: 'in'}]) {
    assert.throws(() => normalizeRampnowBuyInput({...input, user: {...user, ...changes}}), /RAMPNOW_CHECKOUT_PROFILE_INVALID/);
  }
  assert.equal(normalizeRampnowBuyInput({...input, user: {...user, firstName: 'अर्जुन', lastName: "D’Souza"}}).user.firstName, 'अर्जुन');
});

test('creates exactly the documented sandbox buy body and signs its exact bytes once', async () => {
  let calls = 0;
  const client = createRampnowCheckoutClient({...config, fetchImpl: async (url, init) => {
    calls++;
    const path = '/api/partner/v1/ext/ramp_order/checkout';
    assert.equal(url, 'https://api.sandbox.rampnow.io' + path);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers['X-RAMPNOW-TIMESTAMP'], timestamp);
    assert.equal(init.headers['X-RAMPNOW-API-KEY'], config.apiKey);
    assert.equal(init.headers['X-RAMPNOW-SIGN'], rampnowSignature(secret, timestamp, 'POST', path, init.body));
    assert.deepEqual(JSON.parse(init.body), {orderType: 'buy', externalOrderUid, srcCurrency: 'INR', srcChain: 'fiat',
      srcAmount: '1000', dstCurrency: 'BTC', dstChain: 'bitcoin', user,
      wallet: {crytpoAccountDetail: {custodyType: 'unhosted', address: input.destination}}, returnUrl});
    return response({...result, customer: 'private-response-extra'});
  }});
  assert.deepEqual(await client.createBuyOrder({...request, input: {...input, orderType: 'sell', srcCurrency: 'USD',
    networkOverride: 'mainnet', webhookUrl: 'https://private.invalid', partnerFixedFee: 100}}), result);
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(client), ['createBuyOrder']);
});

test('invalid local input or return URL never dispatches checkout', async () => {
  let calls = 0;
  const client = createRampnowCheckoutClient({...config, fetchImpl: async () => { calls++; return response(result); }});
  for (const invalid of [null, undefined, [], 'private-input']) {
    await assert.rejects(client.createBuyOrder(invalid), /RAMPNOW_CHECKOUT_INPUT_INVALID/);
  }
  for (const changes of [{externalOrderUid: 'private-invalid-id'}, {input: {...input, network: 'mainnet'}},
    {input: {...input, destination: witness('bc')}}, {returnUrl: returnUrl.replace('https:', 'http:')},
    {returnUrl: returnUrl.replace('.vercel.app', '.vercel.app.private.invalid')},
    {returnUrl: returnUrl.replace('/rampnow/return', '/different')}, {returnUrl: returnUrl + '&extra=1'},
    {returnUrl: returnUrl + '&intent=' + externalOrderUid}, {returnUrl: returnUrl + '#fragment'},
    {returnUrl: returnUrl.replace(externalOrderUid, '10fe88a7-5287-4e70-a62b-9c9a177147af')},
    {returnUrl: returnUrl.replace('https://', 'https://private-user@')},
    {returnUrl: returnUrl.replace('.vercel.app/', '.vercel.app:8443/')}]) {
    await assert.rejects(client.createBuyOrder({...request, ...changes}), error =>
      error.code?.startsWith('RAMPNOW_') && error.ambiguous === undefined && !error.message.includes('private'));
  }
  assert.equal(calls, 0);
});

test('checkout carries the server-reviewed payment method and refuses an unknown preference', async () => {
  let calls = 0;
  const client = createRampnowCheckoutClient({...config, fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(init.body).paymentMode, 'upi');
    assert.equal(init.headers['X-RAMPNOW-SIGN'], rampnowSignature(secret, timestamp, 'POST',
      '/api/partner/v1/ext/ramp_order/checkout', init.body));
    return response(result);
  }});
  await client.createBuyOrder({...request, paymentMode: 'upi'});
  for (const paymentMode of ['unknown', 'UPI', '', 'private\nmethod', {}]) {
    await assert.rejects(client.createBuyOrder({...request, paymentMode}), /RAMPNOW_PAYMENT_MODE_INVALID/);
  }
  assert.equal(calls, 1);
});

for (const [label, produce] of [
  ['network error', () => { throw new Error('private-secret-and-profile'); }],
  ['server error', () => new Response('private-provider-error', {status: 500})],
  ['client error', () => new Response('private-provider-error', {status: 400})],
  ['HTTP redirect', () => new Response(null, {status: 302, headers: {location: 'https://private.invalid'}})],
  ['application error', () => new Response(JSON.stringify({code: 1, data: result, message: 'private-provider-error'}))],
  ['invalid JSON', () => new Response('private-malformed')],
  ['oversized response', () => new Response('x'.repeat(2 * 1024 * 1024 + 1))],
  ['missing order UID', () => response({...result, orderUid: undefined})],
  ['invalid user UID', () => response({...result, userUid: 'private-user@test.invalid'})],
]) test('marks ' + label + ' as uncertain without retrying or reflecting private content', async () => {
  let calls = 0;
  const client = createRampnowCheckoutClient({...config, fetchImpl: async () => { calls++; return produce(); }});
  await assert.rejects(client.createBuyOrder(request), error => {
    assert.equal(error.code, 'RAMPNOW_CHECKOUT_UNCERTAIN');
    assert.equal(error.ambiguous, true);
    assert.equal(error.cause, undefined);
    assert.equal(error.message, error.code);
    assert.doesNotMatch(JSON.stringify(error), /private|secret|example/);
    return true;
  });
  assert.equal(calls, 1);
});

test('accepts only the exact sandbox checkout origin while preserving its query', async () => {
  for (const redirectUrl of ['http://app.sandbox.rampnow.io/checkout', 'https://app.rampnow.io/checkout',
    'https://app.sandbox.rampnow.io.private.invalid/checkout', 'https://private@app.sandbox.rampnow.io/checkout',
    'https://app.sandbox.rampnow.io:8443/checkout', 'https://app.sandbox.rampnow.io:443/checkout',
    'https://app.sandbox.rampnow.io/checkout#private', 'https://app.sandbox.rampnow.io/checkout#',
    'https://app.sandbox.rampnow.io\\private.invalid/checkout', 'https://app.sandbox.rampnow.io/checkout\n']) {
    const client = createRampnowCheckoutClient({...config, fetchImpl: async () => response({...result, redirectUrl})});
    await assert.rejects(client.createBuyOrder(request), /RAMPNOW_CHECKOUT_UNCERTAIN/);
  }
  const client = createRampnowCheckoutClient({...config, fetchImpl: async () => response(result)});
  assert.equal((await client.createBuyOrder(request)).redirectUrl, redirectUrl);
});
