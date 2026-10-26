import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createPublicKey, ECDH, verify} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect, defaultServerConfig} from '@breeztech/breez-sdk-spark';

const SEED = {type: 'mnemonic', mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'};

async function provider() {
  const requests = [];
  const records = new Map();
  let unavailable = false;
  const server = createServer(async (request, response) => {
    try {
      const match = /^\/lnurlpay\/((?:02|03)[a-f0-9]{64})(?:\/(recover|available))?$/.exec(request.url);
      assert.equal(request.method, 'POST');
      assert.ok(match);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const pubkey = match[1];
      const operation = match[2] ?? 'register';
      const fields = ['breez-lnurl:v2', operation, request.headers.host];
      if (operation === 'register') fields.push(body.username, createHash('sha256').update(body.description).digest('hex'));
      else fields.push(pubkey, ...(operation === 'available' ? [body.username] : []));
      fields.push(String(body.timestamp));
      const publicKey = createPublicKey({format: 'der', type: 'spki', key: Buffer.concat([
        Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex'),
        ECDH.convertKey(Buffer.from(pubkey, 'hex'), 'secp256k1', undefined, undefined, 'uncompressed'),
      ])});
      assert.equal(verify('sha256', Buffer.from(fields.join('\n')), publicKey, Buffer.from(body.signature, 'hex')), true);
      requests.push({operation, pubkey});
      response.setHeader('content-type', 'application/json');
      if (unavailable) {response.writeHead(503); response.end('{"error":"unavailable"}'); return;}
      if (operation === 'recover') {
        const record = records.get(pubkey);
        response.writeHead(record ? 200 : 404);
        response.end(JSON.stringify(record ?? {error: 'not found'}));
      } else if (operation === 'available') {
        response.end('{"available":true}');
      } else {
        const record = {
          username: body.username, description: body.description,
          lightning_address: `${body.username}@${request.headers.host}`,
          lnurl: `http://${request.headers.host}/.well-known/lnurlp/${body.username}`,
        };
        records.set(pubkey, record);
        response.end(JSON.stringify(record));
      }
    } catch (error) {
      response.writeHead(400); response.end(JSON.stringify({error: error.message}));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`, requests,
    fail: () => {unavailable = true;},
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('actual pinned SDK recovers, registers and restores a second-domain name without changing the old address', async () => {
  const original = await provider();
  const native = await provider();
  const directories = [];
  const sessions = [];
  async function session(domain) {
    const storageDir = await mkdtemp(join(tmpdir(), 'gys-lnurl-regtest-'));
    directories.push(storageDir);
    const config = defaultServerConfig('regtest');
    config.lnurlDomain = domain;
    assert.equal(config.backgroundTasksEnabled, false);
    assert.equal(config.apiKey, undefined);
    const sdk = await connect({config, seed: SEED, storageDir});
    sessions.push(sdk);
    return sdk;
  }
  try {
    const main = await session(original.url);
    assert.equal(await main.getLightningAddress(), undefined);
    const oldAddress = await main.registerLightningAddress({username: 'anonymous'});
    const identity = (await main.signMessage({message: 'gys-native-lnurl-session-v1', compact: true})).pubkey;

    const first = await session(native.url);
    assert.equal((await first.signMessage({message: 'gys-native-lnurl-session-v1', compact: true})).pubkey, identity);
    assert.equal(await first.getLightningAddress(), undefined);
    assert.equal(await first.checkLightningAddressAvailable({username: 'alice'}), true);
    const claimed = await first.registerLightningAddress({username: 'alice'});
    assert.equal((await main.getLightningAddress()).lightningAddress, oldAddress.lightningAddress);

    const restored = await session(native.url);
    const recovered = await restored.getLightningAddress();
    assert.deepEqual(recovered, claimed);
    assert.equal(native.requests.filter(request => request.operation === 'register').length, 1);
    assert.ok(native.requests.every(request => request.pubkey === identity));
    assert.deepEqual(native.requests.map(request => request.operation), ['recover', 'available', 'register', 'recover']);

    native.fail();
    const unavailable = await session(native.url);
    await assert.rejects(() => unavailable.getLightningAddress());
    assert.equal(native.requests.filter(request => request.operation === 'register').length, 1);
    assert.equal((await main.getLightningAddress()).lightningAddress, oldAddress.lightningAddress);
  } finally {
    for (const sdk of sessions) {await sdk.disconnect(); sdk.free();}
    await Promise.all([original.close(), native.close()]);
    await Promise.all(directories.map(directory => rm(directory, {recursive: true, force: true})));
  }
});
