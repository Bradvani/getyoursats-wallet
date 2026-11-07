import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect, defaultServerConfig} from '@breeztech/breez-sdk-spark';
import {hashRampnowPayload, verifyRampnowWalletProof} from '../server/rampnowAuth.mjs';

// Public test vector, isolated local storage and disabled background tasks.
// No provider request, customer account, order or funded wallet is involved.
test('the pinned SDK compact signature verifies the exact RampNow owner challenge', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'gys-rampnow-proof-'));
  let sdk;
  try {
    const config = defaultServerConfig('regtest');
    assert.equal(config.backgroundTasksEnabled, false);
    assert.equal(config.apiKey, undefined);
    sdk = await connect({config, storageDir, seed: {type: 'mnemonic',
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'}});
    const identity = await sdk.signMessage({message: 'gys-rampnow-offline-test', compact: true});
    const fields = ['sandbox', 'https://wallet-preview.example.invalid', 'status',
      hashRampnowPayload({externalOrderUid: '00000000-0000-4000-8000-000000000000'}),
      'ab'.repeat(18), identity.pubkey];
    const message = 'gys-rampnow-v1:' + JSON.stringify(fields);
    const proof = await sdk.signMessage({message, compact: true});
    assert.equal(proof.pubkey, identity.pubkey);
    assert.match(proof.signature, /^[a-f0-9]{128}$/i);
    assert.equal(verifyRampnowWalletProof(message, proof.pubkey, proof.signature), true);
    for (const [index, replacement] of [[0, 'production'], [1, 'https://other.example.invalid'],
      [2, 'submit'], [3, 'cd'.repeat(32)], [4, 'ef'.repeat(18)]]) {
      const changed = [...fields]; changed[index] = replacement;
      assert.equal(verifyRampnowWalletProof('gys-rampnow-v1:' + JSON.stringify(changed),
        proof.pubkey, proof.signature), false);
    }
    const der = await sdk.signMessage({message, compact: false});
    assert.equal(verifyRampnowWalletProof(message, der.pubkey, der.signature), false);
  } finally {
    if (sdk) {await sdk.disconnect(); sdk.free();}
    await rm(storageDir, {recursive: true, force: true});
  }
});
