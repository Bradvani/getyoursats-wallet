import assert from 'node:assert/strict';
import test from 'node:test';
import {parseLightsparkResponseUrl} from '../scripts/security/lightspark-response-url.mjs';

// Import only the side-effect-free URL parser, never the funding script.
for (const [value, hostname, pathname] of [
  ['https://lightspark.com/regtest-faucet', 'lightspark.com', '/regtest-faucet'],
  ['https://app.lightspark.com/regtest-faucet', 'app.lightspark.com', '/regtest-faucet'],
  ['https://api.lightspark.com/faucet', 'api.lightspark.com', '/faucet'],
  ['https://nested.api.lightspark.com/faucet', 'nested.api.lightspark.com', '/faucet'],
  ['https://APP.LIGHTSPARK.COM/regtest-faucet', 'app.lightspark.com', '/regtest-faucet'],
  ['https://app.lightspark.com/api/fund?next=attacker.invalid#result', 'app.lightspark.com', '/api/fund'],
]) {
  test(`records the parsed path of an intended HTTPS host: ${value}`, () => {
    const parsed = parseLightsparkResponseUrl(value);
    assert.ok(parsed instanceof URL);
    assert.equal(parsed.hostname, hostname);
    assert.equal(parsed.pathname, pathname);
    assert.equal(parsed.protocol, 'https:');
  });
}

for (const value of [
  'https://evillightspark.com/faucet',
  'https://evil-lightspark.com/faucet',
  'https://lightspark.com.attacker.invalid/faucet',
  'https://app.lightspark.com.attacker.invalid/faucet',
  'https://attacker.invalid/lightspark.com',
  'https://attacker.invalid/?next=https://app.lightspark.com',
  'https://lightspark.com@attacker.invalid/faucet',
  'https://attacker.invalid@app.lightspark.com/faucet',
  'https://user:password@app.lightspark.com/faucet',
  'http://app.lightspark.com/faucet',
  'ftp://app.lightspark.com/faucet',
  '//app.lightspark.com/faucet',
  '/regtest-faucet',
  'not a URL',
  '',
]) {
  test(`rejects a misleading or non-HTTPS response URL: ${JSON.stringify(value)}`, () => {
    assert.equal(parseLightsparkResponseUrl(value), null);
  });
}

test('rejects non-string values without invoking user-defined coercion', () => {
  for (const value of [undefined, null, 123, {}, new URL('https://app.lightspark.com/')]) {
    assert.equal(parseLightsparkResponseUrl(value), null);
  }
  assert.equal(parseLightsparkResponseUrl({toString() { throw new Error('must not coerce'); }}), null);
});
