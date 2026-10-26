import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmod, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {createHash} from 'node:crypto';
import {execute, initFixture, isEmailEligibilityRejection, parseArguments, QaError, validateState} from './native-lightning-live-qa.mjs';

const IDENTITY = '02' + 'a'.repeat(64);
const OTHER_IDENTITY = '03' + 'b'.repeat(64);
const CHALLENGE = 'c'.repeat(36);
const REQUEST = 'd'.repeat(36);
const INVOICE = 'lnbc10n1syntheticqa';
const METADATA = '[\n  ["text/plain", "GetYourSats caf\u00e9 QA"],\n  ["application/json", {"synthetic": true}]\n]';
const ELIGIBILITY_ERROR = 'Network error: network request failed with status 403: '
  + JSON.stringify({status: 'ERROR', reason: 'Verify email before claiming a username'});

async function fixture() {
  const initialized = await initFixture();
  const directory = dirname(initialized.stateFile);
  const envFile = join(directory, 'client.env');
  await writeFile(envFile, 'BREEZ_API_KEY=synthetic-test-client-key\n', {mode: 0o600});
  const records = new Map();
  const calls = {fetches: 0, sends: 0, registrations: 0, deletions: 0, directories: [], signedChallenges: 0,
    invoices: 0, parses: 0, payments: 0, listenerAdds: 0, listenerRemoves: 0, syncs: 0, infoReads: 0, exports: 0};
  const control = {identity: IDENTITY, verified: false, wrongChallenge: false, balance: 0, failNativeRegistration: false,
    loseVerificationResponse: false, nativeRegistrationError: null, publicNotFound: false, storeBeforeDenial: false, lnurlProtocol: 'https:',
    lookupOverrides: new Map(), invoiceResponseOverrides: {}, parsedInvoiceOverrides: {}, parseFails: false,
    emitSynced: true, syncFails: false, infoOverrides: {}, exportFails: false, exitEnvelopeOverrides: {}, exitStateTextOverride: undefined};
  const sdkModule = {
    defaultServerConfig(network) {assert.equal(network, 'mainnet'); return {backgroundTasksEnabled: false};},
    async connect({config, storageDir}) {
      const domain = config.lnurlDomain;
      assert.ok(['getyoursats.com', 'breez.tips'].includes(domain));
      calls.directories.push(storageDir);
      let listener;
      let syncStarted = false;
      let syncComplete = false;
      return {
        async signMessage({message, compact}) {
          assert.equal(compact, true);
          if (message.startsWith('gys-email-v1:')) calls.signedChallenges++;
          return {pubkey: control.identity, signature: 'synthetic-signature'};
        },
        async getLightningAddress() {return records.get(domain);},
        async checkLightningAddressAvailable() {return true;},
        async registerLightningAddress({username}) {
          calls.registrations++;
          if (domain === 'getyoursats.com' && control.failNativeRegistration) throw new Error('Synthetic provider outage');
          const address = {username, lightningAddress: `${username}@${domain}`, description: 'QA',
            lnurl: {url: `${control.lnurlProtocol}//${domain}/lnurlp/${username}`, bech32: 'lnurl1synthetic'}};
          if (domain === 'getyoursats.com' && control.nativeRegistrationError) {
            if (control.storeBeforeDenial) records.set(domain, address);
            throw new Error(control.nativeRegistrationError);
          }
          records.set(domain, address);
          return address;
        },
        async addEventListener(value) {
          assert.equal(syncStarted, false);
          calls.listenerAdds++;
          listener = value;
          return 'synthetic-listener';
        },
        async removeEventListener(id) {
          assert.equal(id, 'synthetic-listener');
          calls.listenerRemoves++;
          listener = undefined;
          return true;
        },
        async syncWallet(request) {
          assert.deepEqual(request, {});
          assert.equal(Boolean(listener) && !syncStarted, true);
          syncStarted = true;
          calls.syncs++;
          if (control.emitSynced) listener.onEvent({type: 'synced'});
          else listener.onEvent({type: 'unilateralExitStateChanged'});
          if (control.syncFails) throw new Error('Synthetic sync failure');
          syncComplete = true;
          return {};
        },
        async getInfo({ensureSynced}) {
          assert.equal(ensureSynced === false && syncComplete, true);
          calls.infoReads++;
          return {identityPubkey: control.identity, balanceSats: control.balance, recoverableFundsSats: 0, tokenBalances: new Map(),
            ...control.infoOverrides};
        },
        async exportUnilateralExitState() {
          assert.equal(syncComplete, true);
          calls.exports++;
          if (control.exportFails) throw new Error('Synthetic export failure with private leaf data');
          return {exitState: control.exitStateTextOverride ?? JSON.stringify({version: 2, network: 'mainnet',
            identity_public_key: control.identity, pedigrees: [], ...control.exitEnvelopeOverrides})};
        },
        async deleteLightningAddress() {calls.deletions++; records.delete(domain);},
        async parse(input) {
          calls.parses++;
          assert.equal(input === INVOICE, true);
          if (control.parseFails) throw new Error('Synthetic parse failure with sensitive invoice data');
          return {type: 'bolt11Invoice', network: 'bitcoin', amountMsat: 1000,
            invoice: {bolt11: INVOICE, source: {type: 'bolt11Invoice'}},
            descriptionHash: createHash('sha256').update(METADATA, 'utf8').digest('hex'),
            ...control.parsedInvoiceOverrides};
        },
        async sendPayment() {calls.payments++; throw new Error('Payments are forbidden in QA');},
        async lnurlPay() {calls.payments++; throw new Error('Payments are forbidden in QA');},
        async disconnect() {}, free() {},
      };
    },
  };
  const fetchImpl = async (url, options) => {
    calls.fetches++;
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    const reply = result => ({ok: true, status: 200, json: async () => result});
    if (url === 'https://wallet.getyoursats.com/api/account/email') {
      if (!options.body) return reply({available: true});
      assert.equal(options.headers.Origin, 'https://wallet.getyoursats.com');
      const body = JSON.parse(options.body);
      if (body.action === 'challenge') return reply({challengeId: CHALLENGE,
        message: control.wrongChallenge ? 'another-wallet-challenge' : `gys-email-v1:${body.purpose}:${body.walletPubkey}:${CHALLENGE}`});
      if (body.action === 'status') return reply({verified: control.verified, email: control.verified ? initialized.recipient : null});
      if (body.action === 'send') {
        assert.equal(body.email, initialized.recipient);
        calls.sends++;
        return reply({requestId: REQUEST, expiresIn: 600});
      }
      if (body.action === 'verify') {
        assert.equal(body.requestId === REQUEST && body.code === '123456', true);
        control.verified = true;
        if (control.loseVerificationResponse) throw new Error('Synthetic lost response after committed verification');
        return reply({verified: true, email: initialized.recipient});
      }
      throw new Error('Unexpected synthetic email request');
    }
    const lookup = new URL(url);
    assert.equal(lookup.protocol, 'https:');
    assert.ok(['getyoursats.com', 'breez.tips'].includes(lookup.hostname));
    if (/^\/lnurlp\/gysqa[a-f0-9]{16}(?:old)?\/invoice$/.test(lookup.pathname)) {
      const name = lookup.hostname === 'getyoursats.com' ? initialized.username : `${initialized.username}old`;
      assert.equal(lookup.pathname === `/lnurlp/${name}/invoice` && lookup.search === '?amount=1000', true);
      calls.invoices++;
      return reply({pr: INVOICE, routes: [], ...control.invoiceResponseOverrides});
    }
    assert.match(lookup.pathname, /^\/\.well-known\/lnurlp\/gysqa[a-f0-9]{16}(?:old)?$/);
    if (control.publicNotFound) return {ok: false, status: 404, json: async () => ''};
    return reply({tag: 'payRequest', callback: `https://${lookup.hostname}/lnurlp/${lookup.pathname.split('/').at(-1)}/invoice`,
      minSendable: 1, maxSendable: 1_000_000, metadata: METADATA, ...control.lookupOverrides.get(lookup.hostname)});
  };
  return {
    ...initialized, directory, envFile, calls, control, records,
    state: async () => JSON.parse(await readFile(initialized.stateFile, 'utf8')),
    run: (mode, extra = {}) => execute({mode, stateFile: initialized.stateFile, envFile, allowLive: true, ...extra}, {sdkModule, fetchImpl}),
    remove: () => rm(directory, {recursive: true, force: true}),
  };
}

test('init creates only a private generated fixture and fixed test recipient', async () => {
  const item = await fixture();
  try {
    assert.equal((await stat(item.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(item.stateFile)).mode & 0o777, 0o600);
    assert.match(item.recipient, /^delivered\+gysqa[a-f0-9]{16}@resend\.dev$/);
    assert.match(item.username, /^gysqa[a-f0-9]{16}$/);
    assert.equal(item.calls.fetches, 0);
    assert.equal(item.calls.directories.length, 0);
    const state = await item.state();
    assert.equal(validateState(state, item.stateFile) === state, true);
    state.email = 'person@example.com';
    assert.throws(() => validateState(state, item.stateFile), error => error instanceof QaError && error.code === 'invalid_fixture');
    const cleaned = await execute({mode: 'cleanup', stateFile: item.stateFile});
    assert.equal(cleaned.localFilesRemoved && cleaned.liveCalls === false, true);
  } finally {await item.remove();}
});

test('CLI requires explicit live modes and rejects recipient, name and endpoint overrides', () => {
  for (const args of [[], ['send'], ['send', '--state', '/tmp/x'], ['init', '--allow-live'],
    ['send', '--allow-live', '--state', '/tmp/x', '--env-file', '/tmp/env', '--recipient', 'person@example.com'],
    ['register', '--allow-live', '--state', '/tmp/x', '--env-file', '/tmp/env', '--username', 'alice'],
    ['status', '--allow-live', '--state', '/tmp/x', '--env-file', '/tmp/env', '--endpoint', 'https://elsewhere.example'],
    ['status', '--allow-live', '--state', '/tmp/x', '--env-file', '/tmp/env', 'constructor', 'value'],
    ['status', '--allow-live', '--state', '/tmp/x', '--env-file', '/tmp/env', '__proto__', 'value'],
    ['cleanup', '--state', '/tmp/x', '--allow-live'],
    ['verify', '--allow-live', '--state', '/tmp/x', '--env-file', '/tmp/env']]) {
    assert.throws(() => parseArguments(args), error => error instanceof QaError);
  }
  assert.equal(parseArguments(['cleanup-provider', '--allow-live', '--state', '/tmp/x', '--env-file', '/tmp/env']).mode, 'cleanup-provider');
});

test('an unsafe env file is rejected before creating an SDK session or making requests', async () => {
  const item = await fixture();
  try {
    await chmod(item.envFile, 0o644);
    await assert.rejects(item.run('status'), error => error.code === 'unsafe_file');
    assert.equal(item.calls.fetches, 0);
    assert.equal(item.calls.directories.length, 0);
  } finally {await item.remove();}
});

test('mocked explicit modes verify one email, preserve both names and recover without registering again', async () => {
  const item = await fixture();
  try {
    assert.equal((await item.run('status')).emailVerified, false);
    assert.equal((await item.run('send')).sent, true);
    await assert.rejects(item.run('send'), error => error.code === 'send_already_attempted');
    assert.equal(item.calls.sends, 1);
    const otpFile = join(item.directory, 'code.txt');
    await writeFile(otpFile, '123456\n', {mode: 0o600});
    assert.equal((await item.run('verify', {otpFile})).emailVerified, true);
    await assert.rejects(stat(otpFile), error => error.code === 'ENOENT');
    assert.equal((await item.run('register')).registered, true);
    assert.equal(item.calls.registrations, 2);
    const restored = await item.run('recover');
    assert.equal(restored.oldAddressUnchanged && restored.sameIdentity && restored.restoredFromFreshStorage, true);
    assert.equal(item.calls.registrations, 2);
    assert.equal(item.calls.sends, 1);
    assert.equal(new Set(item.calls.directories).size, item.calls.directories.length);
    await assert.rejects(execute({mode: 'cleanup', stateFile: item.stateFile}), error => error.code === 'provider_cleanup_required');
    assert.equal((await item.run('cleanup-provider')).providerNamesRemoved, true);
    assert.equal(item.calls.deletions, 2);
    assert.equal(item.records.size, 0);
    const cleaned = await item.run('cleanup');
    assert.equal(cleaned.localFilesRemoved && cleaned.emailRecordMayRemain, true);
    assert.equal(item.calls.syncs === 6 && item.calls.infoReads === 6 && item.calls.exports === 6, true);
    assert.equal(item.calls.listenerAdds === 6 && item.calls.listenerRemoves === 6, true);
    await assert.rejects(stat(item.directory), error => error.code === 'ENOENT');
  } finally {await item.remove();}
});

test('SDK identity mismatch stops before email or registration requests', async () => {
  const item = await fixture();
  try {
    await item.run('status');
    const before = item.calls.fetches;
    item.control.identity = OTHER_IDENTITY;
    await assert.rejects(item.run('send'), error => error.code === 'identity_mismatch');
    await assert.rejects(item.run('register'), error => error.code === 'identity_mismatch');
    await assert.rejects(item.run('check-ineligible'), error => error.code === 'identity_mismatch');
    assert.equal(item.calls.fetches, before);
    assert.equal(item.calls.sends + item.calls.registrations, 0);
  } finally {await item.remove();}
});

test('an altered server challenge is rejected without signing it or sending email', async () => {
  const item = await fixture();
  try {
    item.control.wrongChallenge = true;
    await assert.rejects(item.run('status'), error => error.code === 'invalid_challenge');
    assert.equal(item.calls.signedChallenges, 0);
    assert.equal(item.calls.sends, 0);
  } finally {await item.remove();}
});

test('uncertain registration retains cleanup authority and local deletion stays blocked', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    await item.run('status');
    item.control.failNativeRegistration = true;
    await assert.rejects(item.run('register'));
    assert.equal((await item.state()).providerState, 'may_exist');
    await assert.rejects(execute({mode: 'cleanup', stateFile: item.stateFile}), error => error.code === 'provider_cleanup_required');
    assert.equal((await item.run('cleanup-provider')).providerNamesRemoved, true);
    assert.equal(item.records.size, 0);
  } finally {await item.remove();}
});

test('local cleanup reports a possible email binding after a committed verification response is lost', async () => {
  const item = await fixture();
  try {
    await item.run('status');
    await item.run('send');
    const otpFile = join(item.directory, 'code.txt');
    await writeFile(otpFile, '123456\n', {mode: 0o600});
    item.control.loseVerificationResponse = true;
    await assert.rejects(item.run('verify', {otpFile}));
    assert.equal(item.control.verified, true);
    assert.equal((await item.state()).emailVerified, false);
    const cleaned = await item.run('cleanup');
    assert.equal(cleaned.localFilesRemoved && cleaned.emailRecordMayRemain, true);
  } finally {await item.remove();}
});

test('provider cleanup refuses a funded wallet or a name outside the exact fixture', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    await item.run('status');
    await item.run('register');
    item.control.balance = 1;
    await assert.rejects(item.run('cleanup-provider'), error => error.code === 'wallet_not_confirmed_empty');
    assert.equal(item.calls.deletions, 0);
    item.control.balance = 0;
    item.records.set('breez.tips', {username: 'anothername', lightningAddress: 'anothername@breez.tips',
      lnurl: {url: 'https://breez.tips/.well-known/lnurlp/anothername'}});
    await assert.rejects(item.run('cleanup-provider'), error => error.code === 'unexpected_address');
    assert.equal(item.calls.deletions, 0);
    assert.equal((await item.state()).providerState, 'may_exist');
  } finally {await item.remove();}
});

test('local cleanup checks a status-only wallet live before deleting its seed', async () => {
  const item = await fixture();
  try {
    await item.run('status');
    await assert.rejects(execute({mode: 'cleanup', stateFile: item.stateFile}), error => error.code === 'live_confirmation_required');
    item.control.balance = 1;
    await assert.rejects(item.run('cleanup'), error => error.code === 'wallet_not_confirmed_empty');
    assert.equal((await stat(item.stateFile)).isFile(), true);
    item.control.balance = 0;
    assert.equal((await item.run('cleanup')).localFilesRemoved, true);
  } finally {await item.remove();}
});

test('local cleanup rechecks funds and address absence after provider cleanup', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    await item.run('status');
    await item.run('register');
    await item.run('cleanup-provider');
    item.control.balance = 1;
    await assert.rejects(item.run('cleanup'), error => error.code === 'wallet_not_confirmed_empty');
    assert.equal((await stat(item.stateFile)).isFile(), true);
    item.control.balance = 0;
    item.records.set('getyoursats.com', {username: item.username,
      lightningAddress: `${item.username}@getyoursats.com`, lnurl: {url: `https://getyoursats.com/.well-known/lnurlp/${item.username}`}});
    await assert.rejects(item.run('cleanup'), error => error.code === 'provider_cleanup_required');
    assert.equal((await stat(item.stateFile)).isFile(), true);
    assert.equal(item.calls.deletions, 2);
  } finally {await item.remove();}
});

test('eligibility classifier requires the pinned SDK status and exact proxy reason', () => {
  assert.equal(isEmailEligibilityRejection(new Error(ELIGIBILITY_ERROR)), true);
  for (const error of [new Error('Synthetic timeout'), new Error(ELIGIBILITY_ERROR.replace('403', '503')),
    new Error(ELIGIBILITY_ERROR.replace('Verify email before claiming a username', 'Unsupported origin')),
    new Error('Network error: network request failed with status 403: null'),
    new Error('Network error: network request failed with status 403: {"status":"ERROR","reason":"Verify email before claiming a username","extra":true}'),
    ELIGIBILITY_ERROR]) {
    assert.equal(isEmailEligibilityRejection(error), false);
  }
});

test('negative eligibility confirms exact denial, fresh native absence and public not-found', async () => {
  const item = await fixture();
  try {
    await item.run('status');
    item.control.nativeRegistrationError = ELIGIBILITY_ERROR;
    item.control.publicNotFound = true;
    const result = await item.run('check-ineligible');
    assert.equal(result.ineligibleRegistrationRejected && result.nativeAddressAbsent && result.publicLookupNotFound, true);
    assert.equal(result.rejectionStatus, 403);
    assert.equal(item.calls.registrations, 1);
    assert.equal(item.calls.sends, 0);
    assert.equal(item.records.size, 0);
    assert.equal((await item.state()).providerState, 'cleared');
  } finally {await item.remove();}
});

test('negative eligibility rejects unrelated SDK errors and retains cleanup authority', async () => {
  for (const message of ['Synthetic timeout', ELIGIBILITY_ERROR.replace('403', '503'),
    ELIGIBILITY_ERROR.replace('Verify email before claiming a username', 'Unsupported origin')]) {
    const item = await fixture();
    try {
      await item.run('status');
      item.control.nativeRegistrationError = message;
      item.control.publicNotFound = true;
      await assert.rejects(item.run('check-ineligible'), error => error.code === 'eligibility_rejection_unconfirmed');
      assert.equal((await item.state()).providerState, 'may_exist');
      await assert.rejects(execute({mode: 'cleanup', stateFile: item.stateFile}), error => error.code === 'provider_cleanup_required');
    } finally {await item.remove();}
  }
});

test('negative eligibility preserves state if an unverified registration unexpectedly succeeds', async () => {
  const item = await fixture();
  try {
    await item.run('status');
    await assert.rejects(item.run('check-ineligible'), error => error.code === 'unexpected_registration');
    assert.equal((await item.state()).providerState, 'may_exist');
    assert.equal(item.records.size, 1);
    assert.equal(item.calls.deletions, 0);
    await assert.rejects(execute({mode: 'cleanup', stateFile: item.stateFile}), error => error.code === 'provider_cleanup_required');
  } finally {await item.remove();}
});

test('negative eligibility refuses verified fixtures and fixtures with prior email attempts', async () => {
  for (const verified of [true, false]) {
    const item = await fixture();
    try {
      item.control.verified = verified;
      await item.run('status');
      if (!verified) await item.run('send');
      await assert.rejects(item.run('check-ineligible'), error => error.code === 'fresh_fixture_required');
      assert.equal(item.calls.registrations, 0);
    } finally {await item.remove();}
  }
});

test('an exact eligibility denial alone does not prove that no address was registered', async () => {
  for (const hiddenBinding of [false, true]) {
    const item = await fixture();
    try {
      await item.run('status');
      item.control.nativeRegistrationError = ELIGIBILITY_ERROR;
      item.control.storeBeforeDenial = hiddenBinding;
      await assert.rejects(item.run('check-ineligible'), error => error.code === (hiddenBinding ? 'unexpected_registration' : 'public_absence_unconfirmed'));
      assert.equal((await item.state()).providerState, 'may_exist');
    } finally {await item.remove();}
  }
});

test('actual SDK lnurlp-form addresses restore while public lookup stays HTTPS', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    item.control.lnurlProtocol = 'lnurlp:';
    await item.run('status');
    assert.equal((await item.run('register')).publicLookupsConfirmed, true);
    assert.equal([...item.records.values()].every(address => address.lnurl.url.startsWith('lnurlp://')), true);
    assert.equal((await item.run('recover')).restoredFromFreshStorage, true);
    assert.equal(item.calls.registrations, 2);
  } finally {await item.remove();}
});

test('permitting SDK lnurlp-form addresses does not permit unencrypted HTTP addresses', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    item.control.lnurlProtocol = 'http:';
    await item.run('status');
    await assert.rejects(item.run('register'), error => error.code === 'unexpected_address');
    assert.equal((await item.state()).providerState, 'may_exist');
  } finally {await item.remove();}
});

test('invoice QA validates both exact names and raw UTF-8 metadata without paying or persisting invoices', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    item.control.lnurlProtocol = 'lnurlp:';
    item.control.invoiceResponseOverrides.verify = 'https://getyoursats.com/verify/synthetic-private-token';
    await item.run('status');
    await item.run('register');
    const before = await readFile(item.stateFile, 'utf8');
    const result = await item.run('invoice-check');
    assert.equal(result.invoicesValidated && result.sameIdentity && result.metadataHashesMatch, true);
    assert.equal(result.invoiceCount === 2 && result.invoiceAmountSats === 1, true);
    assert.equal(result.paymentsInitiated === false && result.settlementChecked === false, true);
    assert.equal(item.calls.invoices === 2 && item.calls.parses === 2 && item.calls.payments === 0, true);
    assert.equal(item.calls.registrations, 2);
    assert.equal(await readFile(item.stateFile, 'utf8') === before, true);
    assert.deepEqual((await readdir(item.directory)).sort(), ['client.env', 'state.json']);
    const output = JSON.stringify(result);
    const metadataHash = createHash('sha256').update(METADATA, 'utf8').digest('hex');
    assert.equal([INVOICE, METADATA, metadataHash, 'synthetic-private-token'].some(value => output.includes(value)), false);
  } finally {await item.remove();}
});

test('invoice QA requires registration and fresh exact bindings before any invoice request', async () => {
  const item = await fixture();
  try {
    await item.run('status');
    await assert.rejects(item.run('invoice-check'), error => error.code === 'no_registration');
    item.control.verified = true;
    await item.run('register');
    item.control.identity = OTHER_IDENTITY;
    await assert.rejects(item.run('invoice-check'), error => error.code === 'identity_mismatch');
    item.control.identity = IDENTITY;
    item.records.delete('getyoursats.com');
    await assert.rejects(item.run('invoice-check'), error => error.code === 'unexpected_address');
    assert.equal(item.calls.invoices, 0);
    assert.equal(item.calls.registrations, 2);
    assert.equal((await item.state()).providerState, 'may_exist');
  } finally {await item.remove();}
});

test('invoice QA rejects changed callback hosts, paths, credentials and parameters before creating either invoice', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    await item.run('status');
    await item.run('register');
    const path = `/lnurlp/${item.username}/invoice`;
    for (const callback of [`https://elsewhere.example${path}`, `http://getyoursats.com${path}`,
      'https://getyoursats.com/lnurlp/anothername/invoice', `https://user@getyoursats.com${path}`,
      `https://getyoursats.com:8443${path}`, `https://getyoursats.com${path}?amount=2000`,
      `https://getyoursats.com${path}#fragment`, `https://getyoursats.com:443${path}`]) {
      item.control.lookupOverrides.set('getyoursats.com', {callback});
      await assert.rejects(item.run('invoice-check'), error => error.code === 'invalid_callback');
      assert.equal(item.calls.invoices, 0);
    }
  } finally {await item.remove();}
});

test('invoice QA validates both limits and metadata before generating either invoice', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    await item.run('status');
    await item.run('register');
    for (const override of [{minSendable: 2000}, {maxSendable: 999}, {minSendable: 0},
      {minSendable: '1000'}, {maxSendable: Number.MAX_SAFE_INTEGER + 1}]) {
      item.control.lookupOverrides.set('getyoursats.com', override);
      await assert.rejects(item.run('invoice-check'), error => error.code === 'invoice_amount_outside_limits');
      assert.equal(item.calls.invoices, 0);
    }
    for (const metadata of [null, '', '{', '[]', '["text/plain"]', '[["text/plain",42]]',
      '[["text/plain","one"],["text/plain","two"]]']) {
      item.control.lookupOverrides.set('getyoursats.com', {metadata});
      await assert.rejects(item.run('invoice-check'), error => error.code === 'invalid_lnurl_metadata');
      assert.equal(item.calls.invoices, 0);
    }
  } finally {await item.remove();}
});

test('invoice QA rejects wrong network, amount and metadata commitments without initiating payment', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    await item.run('status');
    await item.run('register');
    const normalizedHash = createHash('sha256').update(JSON.stringify(JSON.parse(METADATA)), 'utf8').digest('hex');
    for (const [override, code] of [
      [{network: 'testnet3'}, 'invoice_not_mainnet'],
      [{amountMsat: 2000}, 'invoice_amount_mismatch'],
      [{amountMsat: undefined}, 'invoice_amount_mismatch'],
      [{amountMsat: '1000'}, 'invoice_amount_mismatch'],
      [{descriptionHash: '0'.repeat(64)}, 'invoice_metadata_mismatch'],
      [{descriptionHash: undefined}, 'invoice_metadata_mismatch'],
      [{descriptionHash: normalizedHash}, 'invoice_metadata_mismatch'],
    ]) {
      item.control.parsedInvoiceOverrides = override;
      const before = item.calls.invoices;
      await assert.rejects(item.run('invoice-check'), error => error.code === code);
      assert.equal(item.calls.invoices === before + 1 && item.calls.payments === 0, true);
      assert.equal((await item.state()).providerState, 'may_exist');
    }
  } finally {await item.remove();}
});

test('invoice QA refuses arbitrary parse inputs and sanitizes SDK parse failures', async () => {
  const item = await fixture();
  try {
    item.control.verified = true;
    await item.run('status');
    await item.run('register');
    for (const override of [{pr: 'https://elsewhere.example/private'}, {pr: 'lightning:' + INVOICE},
      {routes: [{}]}, {status: 'ERROR'}]) {
      item.control.invoiceResponseOverrides = override;
      await assert.rejects(item.run('invoice-check'), error => error.code === 'invalid_invoice_response');
      assert.equal(item.calls.parses, 0);
    }
    item.control.invoiceResponseOverrides = {};
    item.control.parseFails = true;
    await assert.rejects(item.run('invoice-check'), error => error instanceof QaError
      && error.code === 'invalid_invoice' && !error.message.includes('sensitive invoice data'));
    assert.equal(item.calls.payments, 0);
  } finally {await item.remove();}
});

test('cleanup requires the first successful sync event even when syncWallet resolves or emits before rejecting', async () => {
  for (const mode of ['cleanup', 'cleanup-provider']) {
    const item = await fixture();
    try {
      item.control.verified = true;
      await item.run('status');
      if (mode === 'cleanup-provider') await item.run('register');
      const before = await readFile(item.stateFile, 'utf8');
      for (const [emitSynced, syncFails, code] of [
        [false, false, 'wallet_sync_unconfirmed'],
        [false, true, 'wallet_sync_failed'],
        [true, true, 'wallet_sync_failed'],
      ]) {
        Object.assign(item.control, {emitSynced, syncFails});
        await assert.rejects(item.run(mode), error => error.code === code);
        assert.equal(item.calls.infoReads === 0 && item.calls.exports === 0 && item.calls.deletions === 0, true);
        assert.equal(item.calls.listenerAdds === item.calls.listenerRemoves, true);
        assert.equal(await readFile(item.stateFile, 'utf8') === before, true);
      }
    } finally {await item.remove();}
  }
});

test('cleanup rejects failed, malformed, foreign or nonempty exit exports and retains recovery state', async () => {
  for (const mode of ['cleanup', 'cleanup-provider']) {
    const item = await fixture();
    try {
      item.control.verified = true;
      await item.run('status');
      if (mode === 'cleanup-provider') await item.run('register');
      const before = await readFile(item.stateFile, 'utf8');
      const cases = [
        {exportFails: true},
        {exitStateTextOverride: '{'},
        {exitStateTextOverride: 'null'},
        {exitStateTextOverride: '[]'},
        {exitStateTextOverride: '{}'},
        {exitEnvelopeOverrides: {version: 1}},
        {exitEnvelopeOverrides: {network: 'regtest'}},
        {exitEnvelopeOverrides: {identity_public_key: OTHER_IDENTITY}},
        {exitEnvelopeOverrides: {pedigrees: null}},
        {exitEnvelopeOverrides: {pedigrees: [{privateData: 'synthetic-private-leaf-data'}]}},
      ];
      for (const entry of cases) {
        Object.assign(item.control, {exportFails: false, exitStateTextOverride: undefined, exitEnvelopeOverrides: {}}, entry);
        const code = entry.exitEnvelopeOverrides?.pedigrees?.length ? 'wallet_not_confirmed_empty' : 'wallet_exit_state_unconfirmed';
        await assert.rejects(item.run(mode), error => error instanceof QaError && error.code === code
          && !error.message.includes('private leaf data') && !error.message.includes('synthetic-private-leaf-data'));
        assert.equal(item.calls.deletions, 0);
        assert.equal(item.calls.listenerAdds === item.calls.listenerRemoves, true);
        assert.equal(await readFile(item.stateFile, 'utf8') === before, true);
        assert.deepEqual((await readdir(item.directory)).sort(), ['client.env', 'state.json']);
      }
    } finally {await item.remove();}
  }
});

test('cleanup still rejects recoverable funds, tokens and mismatched identity after a confirmed sync', async () => {
  const item = await fixture();
  try {
    await item.run('status');
    const before = await readFile(item.stateFile, 'utf8');
    for (const infoOverrides of [{recoverableFundsSats: 1}, {identityPubkey: OTHER_IDENTITY},
      {tokenBalances: new Map([['synthetic-token', {balance: 1n}]])}, {tokenBalances: {}}]) {
      item.control.infoOverrides = infoOverrides;
      await assert.rejects(item.run('cleanup'), error => error.code === 'wallet_not_confirmed_empty');
      assert.equal(item.calls.exports === 0 && item.calls.deletions === 0, true);
      assert.equal(await readFile(item.stateFile, 'utf8') === before, true);
    }
    assert.equal(item.calls.syncs === 4 && item.calls.listenerRemoves === 4, true);
  } finally {await item.remove();}
});
