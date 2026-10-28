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

for (const [label, data] of [
  ['missing chains', {}], ['non-array chains', {chains: {bitcoin}}], ['no chains', {chains: []}],
  ['missing Bitcoin', {chains: [{code: 'ethereum'}]}],
  ['duplicate Bitcoin', {chains: [bitcoin, {...bitcoin}]}],
  ['conflicting Bitcoin networks', {chains: [bitcoin, {...bitcoin, isTestnet: false}]}],
  ['malformed entry', {chains: [bitcoin, null]}],
  ['too many chains', {chains: [bitcoin, ...Array.from({length: 512}, () => ({code: 'other'}))]}],
]) test('network metadata fails closed for ' + label, async () => {
  await assert.rejects(clientFor(data).getBitcoinNetwork(), error =>
    error.code === 'RAMPNOW_BITCOIN_NETWORK_INVALID' && error.message === error.code && !error.cause);
});

for (const [label, changes] of [
  ['missing testnet declaration', {isTestnet: undefined}], ['string testnet declaration', {isTestnet: 'false'}],
  ['wrong ledger model', {type: 'account'}], ['wrong node protocol', {nodeType: 'evm'}],
  ['wrong native asset', {nativeToken: 'ETH'}], ['missing BTC support', {supportedAssets: ['WBTC:ethereum']}],
  ['missing supported assets', {supportedAssets: undefined}],
  ['missing address type', {addressType: undefined}], ['empty address type', {addressType: ''}],
  ['unbounded address type', {addressType: 'x'.repeat(41)}],
  ['control characters in address type', {addressType: 'bitcoin\nprivate-data'}],
  ['URL in address type', {addressType: 'https://private.test'}],
]) test('network metadata rejects ' + label, async () => {
  await assert.rejects(clientFor({chains: [{...bitcoin, ...changes}]}).getBitcoinNetwork(), error =>
    error.code === 'RAMPNOW_BITCOIN_NETWORK_INVALID' && !error.message.includes('private'));
});
