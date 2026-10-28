import test from 'node:test';
import assert from 'node:assert/strict';
import {createRampnowClient, rampnowSignature} from '../server/rampnow.mjs';

const timestamp = '1772080882';
const secret = 'network-test-secret';
const config = {environment: 'sandbox', apiKey: 'network-test-key', apiSecret: secret,
  now: () => Number(timestamp) * 1000};
const bitcoin = {code: 'bitcoin', type: 'utxo', nodeType: 'btc', nativeToken: 'BTC',
  isTestnet: true, addressType: 'bitcoin', supportedAssets: ['BTC:bitcoin']};
const response = data => new Response(JSON.stringify({code: 0, data}));
const clientFor = data => createRampnowClient({...config, fetchImpl: async () => response(data)});

test('Bitcoin network metadata uses the exact signed, read-only chain config route', async () => {
  let calls = 0;
  const client = createRampnowClient({...config, fetchImpl: async (url, init) => {
    calls++;
    const path = '/api/partner/v1/ext/ramp_order/chain_config';
    assert.equal(url, 'https://api.sandbox.rampnow.io' + path);
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['X-RAMPNOW-API-KEY'], config.apiKey);
    assert.equal(init.headers['X-RAMPNOW-TIMESTAMP'], timestamp);
    assert.equal(init.headers['X-RAMPNOW-SIGN'], rampnowSignature(secret, timestamp, 'GET', path));
    return response({chains: [{code: 'ethereum'}, {...bitcoin, name: 'private-provider-data',
      addressRegex: 'private-regex', credentials: 'private-credential'}]});
  }});
  assert.deepEqual(await client.getBitcoinNetwork(), {chain: 'bitcoin',
    networkClassification: 'testnet_unspecified', isTestnet: true, addressType: 'bitcoin', nativeToken: 'BTC'});
  assert.equal(calls, 1);
});

test('non-testnet declaration is reported without inferring sandbox settlement readiness', async () => {
  const result = await clientFor({chains: [{...bitcoin, isTestnet: false, supportedAssets: ['BTC']}]}).getBitcoinNetwork();
  assert.deepEqual(result, {chain: 'bitcoin', networkClassification: 'mainnet',
    isTestnet: false, addressType: 'bitcoin', nativeToken: 'BTC'});
});

for (const [label, data, reason, count] of [
  ['missing chains', {}, 'chains_missing'],
  ['non-array chains', {chains: {bitcoin}}, 'chains_missing'],
  ['no chains', {chains: []}, 'bitcoin_absent', 0],
  ['missing Bitcoin', {chains: [{code: 'ethereum'}]}, 'bitcoin_absent', 0],
  ['duplicate Bitcoin', {chains: [bitcoin, {...bitcoin}]}, 'bitcoin_ambiguous', 2],
  ['conflicting Bitcoin networks', {chains: [bitcoin, {...bitcoin, isTestnet: false}]}, 'bitcoin_ambiguous', 2],
  ['malformed entry', {chains: [bitcoin, null]}, 'chains_entries'],
  ['too many chains', {chains: [bitcoin, ...Array.from({length: 512}, () => ({code: 'other'}))]}, 'chains_count'],
]) test('network metadata fails closed for ' + label, async () => {
  await assert.rejects(clientFor(data).getBitcoinNetwork(), error => {
    assert.equal(error.code, 'RAMPNOW_BITCOIN_NETWORK_INVALID');
    assert.equal(error.message, error.code);
    assert.equal(error.reason, reason);
    assert.equal(error.bitcoinMatchCount, count);
    assert.equal(error.cause, undefined);
    return true;
  });
});

for (const [label, changes, reason] of [
  ['missing testnet declaration', {isTestnet: undefined}, 'testnet_flag'],
  ['string testnet declaration', {isTestnet: 'false'}, 'testnet_flag'],
  ['wrong ledger model', {type: 'account'}, 'ledger_model'],
  ['wrong node protocol', {nodeType: 'evm'}, 'node_protocol'],
  ['wrong native asset', {nativeToken: 'ETH'}, 'native_token'],
  ['missing BTC support', {supportedAssets: ['WBTC:ethereum']}, 'supported_assets'],
  ['missing supported assets', {supportedAssets: undefined}, 'supported_assets'],
  ['missing address type', {addressType: undefined}, 'address_type'],
  ['empty address type', {addressType: ''}, 'address_type'],
  ['unbounded address type', {addressType: 'x'.repeat(41)}, 'address_type'],
  ['control characters in address type', {addressType: 'bitcoin\nprivate-data'}, 'address_type'],
  ['URL in address type', {addressType: 'https://private.test'}, 'address_type'],
]) test('network metadata rejects ' + label, async () => {
  await assert.rejects(clientFor({chains: [{...bitcoin, ...changes}]}).getBitcoinNetwork(), error => {
    assert.equal(error.code, 'RAMPNOW_BITCOIN_NETWORK_INVALID');
    assert.equal(error.reason, reason);
    assert.equal(error.bitcoinMatchCount, 1);
    assert.doesNotMatch(JSON.stringify(error), /private/);
    assert.deepEqual(Object.keys(error).sort(), ['bitcoinMatchCount', 'code', 'name', 'reason']);
    return true;
  });
});
