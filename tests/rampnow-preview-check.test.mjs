import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRampnowPreview } from '../scripts/rampnow-preview-check.mjs';
import { createRampnowClient, RampnowError } from '../server/rampnow.mjs';

const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/rampnow-integration-20261028',
  RAMPNOW_ENVIRONMENT: 'sandbox', RAMPNOW_API_KEY: 'private-key', RAMPNOW_API_SECRET: 'private-secret' };
const factory = () => ({ getConfig: async () => ({}),
  getBitcoinNetwork: async () => ({networkClassification: 'testnet_unspecified'}),
  getBitcoinAsset: async () => ({ currency: 'BTC', chain: 'bitcoin', orderCurrency: 'INR', status: 'active',
    buyOrderRange: { status: 'active' }, sellOrderRange: { status: 'active' }, payinModes: ['upi'], payoutModes: ['upi'] }),
  getBlockedCurrencies: async () => ({ countries: [{ country: 'IN', blockedCurrencies: [] }] }) });

test('HTTP authentication denial reports only status, never the provider body', async () => {
  const result = await checkRampnowPreview(env, options => createRampnowClient({ ...options,
    fetchImpl: async () => new Response('private-secret', { status: 401 }) }));
  assert.equal(result.httpStatus, 401);
  assert.equal(result.status, 'authentication_check_failed');
  assert.doesNotMatch(JSON.stringify(result), /private-secret/);
});

test('build check never contacts provider outside configured sandbox branch', async () => {
  for (const override of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: undefined },
    { VERCEL_GIT_COMMIT_REF: 'main' }, { RAMPNOW_ENVIRONMENT: 'production' }, { RAMPNOW_API_SECRET: '' }]) {
    const result = await checkRampnowPreview({ ...env, ...override }, () => { assert.fail('must not create client'); });
    assert.equal(result.authentication, false);
    assert.equal(result.productionReady, false);
  }
});
test('reports capability candidates without claiming tested settlement or printing private config', async () => {
  const result = await checkRampnowPreview(env, factory);
  assert.equal(result.authentication, true);
  assert.equal(result.btcBuyCandidate, true);
  assert.equal(result.btcSellCandidate, true);
  assert.equal(result.productionReady, false);
  assert.equal(result.webhookStorageConfigured, false);
  assert.equal(result.bitcoinNetwork, 'testnet_unspecified');
  assert.equal(result.networkStatus, 'provider_metadata_read');
  assert.equal(result.providerDeliveryVerified, false);
  assert.doesNotMatch(JSON.stringify(result), /private-key|private-secret/);
});
test('runs webhook self-test only after verified storage, without claiming provider delivery', async () => {
  for (const status of ['sandbox_storage_verified', 'sandbox_storage_check_failed']) {
    let called = false; let deliveryCalled = false;
    const result = await checkRampnowPreview(env, factory, {
      storageCheck: async () => ({configured: true, status}),
      webhookCheck: async () => {called = true; return {status: 'sandbox_webhook_selftest_verified'};},
      deliveryCheck: async () => {deliveryCalled = true; return {httpDeliveryVerified: true, providerDeliveryVerified: false};},
    });
    assert.equal(called, status === 'sandbox_storage_verified');
    assert.equal(deliveryCalled, status === 'sandbox_storage_verified');
    assert.equal(result.webhookStorageConfigured, true);
    assert.equal(result.providerDeliveryVerified, false);
    assert.equal(result.productionReady, false);
  }
});
test('network diagnostics expose only fixed reasons and bounded counts', async () => {
  for (const valid of [true, false]) {
    const error = new RampnowError('RAMPNOW_BITCOIN_NETWORK_INVALID');
    error.reason = valid ? 'bitcoin_absent' : 'private-secret';
    error.bitcoinMatchCount = valid ? 0 : 'private-secret';
    error.networkFacts = {nodeProtocol: valid ? 'bitcoin' : 'private-secret',
      testnetFlag: valid ? true : 'private-secret', nativeAsset: valid ? 'BTC' : 'private-secret',
      addressTypePresent: true, addressTypeValid: valid, btcAssetSupported: true, unwanted: 'private-secret'};
    const result = await checkRampnowPreview(env, () => ({...factory(), getBitcoinNetwork: async () => {throw error;}}));
    assert.equal(result.networkReason, valid ? 'bitcoin_absent' : 'unavailable');
    assert.equal(result.bitcoinMatchCount, valid ? 0 : undefined);
    assert.deepEqual(result.bitcoinNetworkFacts, {nodeProtocol: valid ? 'bitcoin' : 'other',
      testnetFlag: valid ? true : null, nativeAsset: valid ? 'BTC' : 'other',
      addressTypePresent: true, addressTypeValid: valid, btcAssetSupported: true});
    assert.equal(result.bitcoinNetwork, 'unverified');
    assert.doesNotMatch(JSON.stringify(result), /private-secret/);
  }
});
test('unavailable network metadata stays unverified even when BTC capability is active', async () => {
  const result = await checkRampnowPreview(env, () => ({...factory(),
    getBitcoinNetwork: async () => {throw Error('private-secret');},
  }));
  assert.equal(result.authentication, true);
  assert.equal(result.btcBuyCandidate, true);
  assert.equal(result.bitcoinNetwork, 'unverified');
  assert.equal(result.networkStatus, 'bitcoin_network_confirmation_required');
  assert.equal(result.productionReady, false);
  assert.doesNotMatch(JSON.stringify(result), /private-secret/);
});
test('missing country rule and mismatched network fail closed', async () => {
  for (const overrides of [{ getBlockedCurrencies: async () => ({ countries: [] }) },
    { getBitcoinAsset: async () => ({ ...(await factory().getBitcoinAsset()), chain: 'ethereum' }) }]) {
    const result = await checkRampnowPreview(env, () => ({ ...factory(), ...overrides }));
    assert.equal(result.btcBuyCandidate, false);
    assert.equal(result.btcSellCandidate, false);
  }
});
test('auth and capability failures are distinguished without leaking exception text', async () => {
  for (const method of ['getConfig', 'getBitcoinAsset']) {
    const result = await checkRampnowPreview(env, () => ({ ...factory(), [method]: async () => { throw Error('private-secret'); } }));
    assert.equal(result.authentication, method !== 'getConfig');
    assert.equal(result.status, method === 'getConfig' ? 'authentication_check_failed' : 'capability_check_failed');
    assert.doesNotMatch(JSON.stringify(result), /private-secret/);
  }
});
