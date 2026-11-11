import test from 'node:test';
import assert from 'node:assert/strict';
import {createRampnowClient, rampnowSignature} from '../server/rampnow.mjs';

const config = {environment: 'sandbox', apiKey: 'test-key', apiSecret: 'test-secret', now: () => 1800000000000};
const response = data => new Response(JSON.stringify({code: 0, data}));
const client = data => createRampnowClient({...config, fetchImpl: async () => response(data)});

test('simulation discovery uses the signed sandbox chain endpoint and exposes only known test routes', async () => {
  let calls = 0;
  const api = createRampnowClient({...config, fetchImpl: async (url, init) => {
    calls++;
    const path = '/api/partner/v1/ext/ramp_order/chain_config';
    assert.equal(url, 'https://api.sandbox.rampnow.io' + path);
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['X-RAMPNOW-SIGN'], rampnowSignature('test-secret', '1800000000', 'GET', path));
    return response({chains: [
      {code: 'base-sepolia', isTestnet: true, supportedAssets: ['USDC:base-sepolia', 'ETH'], name: 'private'},
      {code: 'bitcoin', isTestnet: true, supportedAssets: ['BTC']},
      {code: 'ethereum', isTestnet: false, supportedAssets: ['USDC']},
    ]});
  }});
  assert.deepEqual(await api.getSandboxSimulationRoutes(), [{chain: 'base-sepolia', asset: 'ETH'}, {chain: 'base-sepolia', asset: 'USDC'}]);
  assert.equal(calls, 1);
  assert.equal(api.createOrder, undefined);
});

test('production credentials cannot invoke simulation discovery', async () => {
  let calls = 0;
  const api = createRampnowClient({...config, environment: 'production', fetchImpl: async () => {calls++;}});
  await assert.rejects(api.getSandboxSimulationRoutes(), /RAMPNOW_SANDBOX_ONLY/);
  assert.equal(calls, 0);
});

for (const isTestnet of [undefined, null, false, 'true', 1]) test(`testnet declaration must be boolean true: ${isTestnet}`, async () => {
  assert.deepEqual(await client({chains: [{code: 'sepolia', isTestnet, supportedAssets: ['USDC']}]}).getSandboxSimulationRoutes(), []);
});

test('duplicate chain entries and unadvertised assets cannot authorize a test route', async () => {
  assert.deepEqual(await client({chains: [
    {code: 'sepolia', isTestnet: true, supportedAssets: ['USDC']},
    {code: 'sepolia', isTestnet: false, supportedAssets: ['USDC']},
    {code: 'polygon-amoy', isTestnet: true, supportedAssets: ['USDC:ethereum', 'BTC', 'private']},
    {code: 'solana-devnet', isTestnet: true},
  ]}).getSandboxSimulationRoutes(), []);
});

for (const chains of [undefined, {}, [null], Array.from({length: 513}, () => ({}))]) {
  test('malformed or oversized chain lists fail without leaking the response', async () => {
    await assert.rejects(client({chains, secret: 'private'}).getSandboxSimulationRoutes(), error => {
      assert.equal(error.code, 'RAMPNOW_RESPONSE_INVALID');
      assert.doesNotMatch(JSON.stringify(error), /private/);
      return true;
    });
  });
}
