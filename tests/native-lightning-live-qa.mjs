import {constants} from 'node:fs';
import {chmod, mkdir, mkdtemp, open, realpath, rename, rm, stat, unlink} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateMnemonic, validateMnemonic} from 'bip39';
import {parse as parseEnv} from 'dotenv';

const WALLET_ORIGIN = 'https://wallet.getyoursats.com';
const EMAIL_API = `${WALLET_ORIGIN}/api/account/email`;
const NATIVE_DOMAIN = 'getyoursats.com';
const DEFAULT_DOMAIN = 'breez.tips';
const IDENTITY_MESSAGE = 'gys-native-lnurl-session-v1';
const MODES = new Set(['init', 'status', 'send', 'verify', 'register', 'recover', 'invoice-check', 'check-ineligible', 'cleanup-provider', 'cleanup']);
const PUBKEY = /^(02|03)[a-f0-9]{64}$/;
const INVOICE_AMOUNT_MSAT = 1000;
const cleanupSyncSessions = new WeakSet();

export class QaError extends Error {
  constructor(code, message) {super(message); this.code = code;}
}

function requireQa(condition, code, message) {
  if (!condition) throw new QaError(code, message);
}

export function parseArguments(args) {
  const [mode, ...rest] = args;
  requireQa(MODES.has(mode), 'invalid_mode', 'Choose an explicit QA mode. See the usage comment in this file.');
  const options = {mode, allowLive: false};
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--allow-live') {
      requireQa(!options.allowLive, 'invalid_arguments', 'Do not repeat command options.');
      options.allowLive = true;
      continue;
    }
    const flags = {'--state': 'stateFile', '--env-file': 'envFile', '--otp-file': 'otpFile'};
    const key = Object.hasOwn(flags, flag) ? flags[flag] : undefined;
    requireQa(key && !options[key] && rest[index + 1] && !rest[index + 1].startsWith('--'),
      'invalid_arguments', 'Only --state, --env-file, --otp-file and --allow-live are accepted.');
    options[key] = rest[++index];
  }
  if (mode === 'init') requireQa(rest.length === 0, 'invalid_arguments', 'Init generates its own private fixture directory.');
  else requireQa(options.stateFile, 'state_required', 'Pass the state file printed by init.');
  if (!['init', 'cleanup'].includes(mode)) {
    requireQa(options.allowLive && options.envFile, 'live_confirmation_required', 'Live modes require --allow-live and a private --env-file.');
  }
  if (mode === 'verify') requireQa(options.otpFile, 'otp_file_required', 'Verify requires a private --otp-file inside the fixture directory.');
  else requireQa(!options.otpFile, 'invalid_arguments', '--otp-file is only accepted by verify.');
  if (mode === 'cleanup') requireQa(Boolean(options.envFile) === options.allowLive, 'invalid_arguments', 'Used-wallet cleanup requires both --allow-live and --env-file.');
  return options;
}

async function privateText(path) {
  requireQa(resolve(path).startsWith('/tmp/'), 'unsafe_file', 'QA input files must be private files under /tmp.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    requireQa(info.isFile() && (info.mode & 0o777) === 0o600
      && (typeof process.getuid !== 'function' || info.uid === process.getuid()),
    'unsafe_file', 'QA input files must be regular owner-only mode 0600 files.');
    requireQa(info.size <= 32_768, 'unsafe_file', 'The QA input file is too large.');
    return await handle.readFile('utf8');
  } finally {await handle.close();}
}

export function validateState(state, stateFile) {
  requireQa(state?.version === 1 && /^[a-f0-9]{16}$/.test(state.id)
    && resolve(stateFile) === `/tmp/gys-live-qa-${state.id}/state.json`,
  'invalid_fixture', 'The state does not belong to a generated QA fixture.');
  requireQa(state.network === 'mainnet' && state.email === `delivered+gysqa${state.id}@resend.dev`
    && state.username === `gysqa${state.id}` && state.defaultUsername === `gysqa${state.id}old`
    && typeof state.mnemonic === 'string' && validateMnemonic(state.mnemonic),
  'invalid_fixture', 'The fixture identity, test recipient or test names were altered.');
  requireQa(state.identityPubkey === null || PUBKEY.test(state.identityPubkey), 'invalid_fixture', 'Invalid fixture wallet identity.');
  requireQa(['untouched', 'may_exist', 'cleared'].includes(state.providerState)
    && typeof state.emailVerified === 'boolean' && Number.isSafeInteger(state.lastSendAttemptAt)
    && state.lastSendAttemptAt >= 0,
  'invalid_fixture', 'Invalid fixture progress state.');
  if (state.pending !== null) requireQa(/^[a-f0-9]{36}$/.test(state.pending?.requestId)
    && Number.isSafeInteger(state.pending.expiresAt) && state.pending.expiresAt > 0,
  'invalid_fixture', 'Invalid fixture verification request.');
  return state;
}

async function checkDirectory(stateFile) {
  const directory = dirname(resolve(stateFile));
  requireQa(/^\/tmp\/gys-live-qa-[a-f0-9]{16}$/.test(directory)
    && await realpath(directory) === directory,
  'unsafe_directory', 'Use the original generated fixture directory.');
  const info = await stat(directory);
  requireQa(info.isDirectory() && (info.mode & 0o777) === 0o700
    && (typeof process.getuid !== 'function' || info.uid === process.getuid()),
  'unsafe_directory', 'The fixture directory must remain owner-only mode 0700.');
  return directory;
}

export async function saveState(stateFile, state) {
  validateState(state, stateFile);
  await checkDirectory(stateFile);
  const temporary = `${stateFile}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {await handle.writeFile(JSON.stringify(state)); await handle.sync();}
  finally {await handle.close();}
  await rename(temporary, stateFile);
}

export async function initFixture() {
  const id = randomBytes(8).toString('hex');
  const directory = `/tmp/gys-live-qa-${id}`;
  await mkdir(directory, {mode: 0o700});
  const stateFile = join(directory, 'state.json');
  const state = {
    version: 1, id, network: 'mainnet', mnemonic: generateMnemonic(256), identityPubkey: null,
    email: `delivered+gysqa${id}@resend.dev`, username: `gysqa${id}`, defaultUsername: `gysqa${id}old`,
    emailVerified: false, lastSendAttemptAt: 0, pending: null, providerState: 'untouched',
  };
  try {await saveState(stateFile, state);}
  catch (error) {await rm(directory, {recursive: true, force: true}); throw error;}
  return {mode: 'init', stateFile, recipient: state.email, username: state.username, liveCalls: false};
}

async function apiJson(fetchImpl, body) {
  const response = await fetchImpl(EMAIL_API, {
    method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit',
    headers: body ? {'Content-Type': 'application/json', Origin: WALLET_ORIGIN} : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  });
  requireQa(response.ok, `email_http_${response.status}`, 'The email API rejected this QA step. Check release readiness and retry limits.');
  const result = await response.json();
  requireQa(result && typeof result === 'object' && !Array.isArray(result), 'invalid_email_response', 'The email API returned an invalid response.');
  return result;
}

async function proofFor(sdk, pubkey, purpose, fetchImpl) {
  const challenge = await apiJson(fetchImpl, {action: 'challenge', purpose, walletPubkey: pubkey});
  requireQa(typeof challenge.challengeId === 'string' && /^[a-f0-9]{36}$/.test(challenge.challengeId)
    && challenge.message === `gys-email-v1:${purpose}:${pubkey}:${challenge.challengeId}`,
  'invalid_challenge', 'The server challenge does not match the fixture identity and requested operation.');
  const proof = await sdk.signMessage({message: challenge.message, compact: true});
  requireQa(proof.pubkey?.toLowerCase() === pubkey && typeof proof.signature === 'string' && proof.signature.length > 0,
    'identity_mismatch', 'The SDK signing identity changed. No authenticated email operation was submitted.');
  return {challengeId: challenge.challengeId, signature: proof.signature};
}

async function emailStatus(sdk, state, fetchImpl) {
  const proof = await proofFor(sdk, state.identityPubkey, 'status', fetchImpl);
  const result = await apiJson(fetchImpl, {action: 'status', ...proof});
  requireQa((result.verified === false && result.email === null)
    || (result.verified === true && result.email === state.email),
  'unexpected_email_binding', 'The wallet email binding does not match this disposable fixture.');
  return result.verified;
}

function checkAddress(address, state, domain) {
  const name = domain === NATIVE_DOMAIN ? state.username : state.defaultUsername;
  let url;
  try {url = new URL(address?.lnurl?.url);} catch { /* Validate the full provider address before any mutation. */ }
  requireQa(address?.username === name && address.lightningAddress === `${name}@${domain}`
    && ['https:', 'lnurlp:'].includes(url?.protocol) && url.hostname === domain && !url.username && !url.password && !url.port
    && !url.hash && !url.search && [`/.well-known/lnurlp/${name}`, `/lnurlp/${name}`].includes(url.pathname),
  'unexpected_address', 'The recovered address does not exactly match the disposable fixture.');
  return address;
}

async function publicLookup(fetchImpl, name, domain) {
  const response = await fetchImpl(`https://${domain}/.well-known/lnurlp/${name}`, {
    redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15_000),
  });
  requireQa(response.ok, 'public_lookup_failed', 'The fixture public Lightning lookup is not ready.');
  const result = await response.json();
  let callback;
  try {callback = new URL(result?.callback);} catch { /* A lookup must advertise the exact approved callback. */ }
  requireQa(result?.tag === 'payRequest' && callback?.protocol === 'https:' && callback.hostname === domain
    && !callback.username && !callback.password && !callback.port && !callback.hash
    && callback.pathname === `/lnurlp/${name}/invoice`,
  'invalid_callback', 'The fixture public Lightning lookup returned an unexpected callback.');
  return result;
}

function checkInvoiceMetadata(result, name, domain) {
  const callback = `https://${domain}/lnurlp/${name}/invoice`;
  requireQa(result.callback === callback, 'invalid_callback', 'Invoice QA requires the exact canonical callback without extra parameters.');
  requireQa(Number.isSafeInteger(result.minSendable) && Number.isSafeInteger(result.maxSendable)
    && result.minSendable > 0 && result.maxSendable >= result.minSendable
    && result.minSendable <= INVOICE_AMOUNT_MSAT && result.maxSendable >= INVOICE_AMOUNT_MSAT,
  'invoice_amount_outside_limits', 'The advertised limits do not permit the fixed one-sat QA invoice. No larger amount will be requested.');
  requireQa(typeof result.metadata === 'string' && result.metadata.length > 0 && result.metadata.length <= 200_000,
    'invalid_lnurl_metadata', 'The public lookup did not return valid LNURL metadata.');
  let metadata;
  try {metadata = JSON.parse(result.metadata);} catch { /* Hash the original text only after validating its schema. */ }
  requireQa(Array.isArray(metadata) && metadata.every(entry => Array.isArray(entry)
    && entry.length >= 2 && typeof entry[0] === 'string')
    && metadata.filter(entry => entry[0] === 'text/plain').length === 1
    && typeof metadata.find(entry => entry[0] === 'text/plain')?.[1] === 'string',
  'invalid_lnurl_metadata', 'The public lookup metadata is missing its single text description.');
  return {callback, metadata: result.metadata};
}

async function checkInvoice(sdk, fetchImpl, metadata) {
  const callback = new URL(metadata.callback);
  callback.searchParams.set('amount', String(INVOICE_AMOUNT_MSAT));
  const response = await fetchImpl(callback.href, {
    redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15_000),
  });
  requireQa(response.ok, 'invoice_request_failed', 'The provider did not create the QA invoice. Keep the fixture for inspection.');
  const result = await response.json();
  requireQa(result && !Array.isArray(result) && (result.status === undefined || result.status === 'OK')
    && typeof result.pr === 'string' && result.pr.length <= 32_000 && /^(?:lnbc[0-9a-z]+|LNBC[0-9A-Z]+)$/.test(result.pr)
    && Array.isArray(result.routes) && result.routes.length === 0,
  'invalid_invoice_response', 'The provider did not return the expected BOLT11 invoice response.');
  let parsed;
  try {parsed = await sdk.parse(result.pr);} catch { /* SDK parse errors can contain the invoice. */ }
  requireQa(parsed?.type === 'bolt11Invoice' && typeof parsed.invoice?.bolt11 === 'string'
    && parsed.invoice.bolt11.toLowerCase() === result.pr.toLowerCase(),
  'invalid_invoice', 'The pinned SDK could not parse the exact returned BOLT11 invoice.');
  requireQa(parsed.network === 'bitcoin', 'invoice_not_mainnet', 'The QA invoice does not use Bitcoin mainnet.');
  requireQa(parsed.amountMsat === INVOICE_AMOUNT_MSAT, 'invoice_amount_mismatch', 'The QA invoice does not match the requested one-sat amount.');
  // LNURL commits to the original UTF-8 metadata, including its whitespace.
  const expectedHash = createHash('sha256').update(metadata.metadata, 'utf8').digest('hex');
  requireQa(typeof parsed.descriptionHash === 'string' && /^[a-f0-9]{64}$/i.test(parsed.descriptionHash)
    && parsed.descriptionHash.toLowerCase() === expectedHash,
  'invoice_metadata_mismatch', 'The QA invoice does not commit to the exact public LNURL metadata.');
}

export function isEmailEligibilityRejection(error) {
  const prefix = 'Network error: network request failed with status 403: ';
  if (!(error instanceof Error) || !error.message.startsWith(prefix) || error.message.length > 4096) return false;
  try {
    const body = JSON.parse(error.message.slice(prefix.length));
    return !!body && !Array.isArray(body) && Object.keys(body).length === 2
      && body.status === 'ERROR' && body.reason === 'Verify email before claiming a username';
  } catch {return false;}
}

async function publicLookupAbsent(fetchImpl, name) {
  const response = await fetchImpl(`https://${NATIVE_DOMAIN}/.well-known/lnurlp/${name}`, {
    redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15_000),
  });
  requireQa(response.status === 404 && await response.json() === '', 'public_absence_unconfirmed',
    'The public lookup did not return the expected provider not-found response. Keep the fixture state.');
}

async function withSession(state, stateFile, apiKey, sdkModule, domain, allowPin, use) {
  const directory = await mkdtemp(join(dirname(stateFile), 'session-'));
  await chmod(directory, 0o700);
  let sdk;
  try {
    const config = sdkModule.defaultServerConfig('mainnet');
    requireQa(config.backgroundTasksEnabled === false, 'unsafe_sdk_config', 'The SDK must use server mode with background tasks disabled.');
    config.apiKey = apiKey;
    config.lnurlDomain = domain;
    sdk = await sdkModule.connect({config, seed: {type: 'mnemonic', mnemonic: state.mnemonic}, storageDir: directory});
    const identity = (await sdk.signMessage({message: IDENTITY_MESSAGE, compact: true})).pubkey?.toLowerCase();
    requireQa(typeof identity === 'string' && PUBKEY.test(identity), 'invalid_identity', 'The SDK did not return a valid wallet identity.');
    if (state.identityPubkey === null) {
      requireQa(allowPin, 'identity_not_pinned', 'Run status first to bind this generated fixture to its SDK identity.');
      state.identityPubkey = identity;
      await saveState(stateFile, state);
    }
    requireQa(identity === state.identityPubkey, 'identity_mismatch', 'The SDK identity does not match this fixture. No external mutation was attempted.');
    return await use(sdk);
  } finally {
    if (sdk) {
      try {await sdk.disconnect();} catch { /* Preserve the operation result while releasing only fixture resources. */ }
      try {sdk.free();} catch { /* The temporary signer must not outlive this command. */ }
    }
    await rm(directory, {recursive: true, force: true});
  }
}

async function assertUnfunded(sdk, state) {
  // Only the first Synced event requires a successful Spark wallet sync.
  requireQa(!cleanupSyncSessions.has(sdk), 'fresh_cleanup_session_required', 'Cleanup checks require a fresh server-mode SDK session.');
  cleanupSyncSessions.add(sdk);
  let synced = false;
  const listener = await sdk.addEventListener({onEvent(event) {if (event?.type === 'synced') synced = true;}});
  try {
    try {await sdk.syncWallet({});}
    catch {throw new QaError('wallet_sync_failed', 'The foreground wallet sync failed. Keep the fixture state.');}
    requireQa(synced, 'wallet_sync_unconfirmed', 'The first successful wallet sync was not confirmed. Keep the fixture state.');
    const info = await sdk.getInfo({ensureSynced: false});
    requireQa(info.identityPubkey?.toLowerCase() === state.identityPubkey
      && info.balanceSats === 0 && info.recoverableFundsSats === 0
      && info.tokenBalances instanceof Map && [...info.tokenBalances.values()].every(token => token.balance === 0n),
    'wallet_not_confirmed_empty', 'Cleanup requires a synchronized wallet with zero funds and no recoverable funds.');
    let exitState;
    try {
      const exported = await sdk.exportUnilateralExitState();
      if (typeof exported?.exitState !== 'string') throw new Error();
      exitState = JSON.parse(exported.exitState);
    } catch {throw new QaError('wallet_exit_state_unconfirmed', 'The wallet leaf inventory could not be read. Keep the fixture state.');}
    requireQa(exitState && !Array.isArray(exitState) && exitState.version === 2 && exitState.network === 'mainnet'
      && exitState.identity_public_key === state.identityPubkey && Array.isArray(exitState.pedigrees),
    'wallet_exit_state_unconfirmed', 'The wallet leaf inventory did not match the pinned identity and schema. Keep the fixture state.');
    // A failed recovery sub-sync can leave a cached zero; require no leaf records.
    requireQa(exitState.pedigrees.length === 0, 'wallet_not_confirmed_empty', 'Wallet leaf records remain. Keep the fixture state.');
  } finally {await sdk.removeEventListener(listener);}
}

export async function runLiveMode(options, state, {apiKey, sdkModule, fetchImpl = fetch}) {
  requireQa(options.allowLive === true && options.mode !== 'init', 'live_confirmation_required', 'An explicit live QA mode is required.');
  validateState(state, options.stateFile);
  const session = (domain, use, allowPin = false) => withSession(state, options.stateFile, apiKey, sdkModule, domain, allowPin, use);
  const summary = () => ({mode: options.mode, walletPubkey: state.identityPubkey, recipient: state.email, username: state.username});
  if (options.mode === 'status') return session(NATIVE_DOMAIN, async sdk => {
    const readiness = await apiJson(fetchImpl);
    requireQa(typeof readiness.available === 'boolean', 'invalid_email_response', 'The email readiness response was invalid.');
    const verified = readiness.available ? await emailStatus(sdk, state, fetchImpl) : null;
    if (verified !== null) {state.emailVerified = verified; await saveState(options.stateFile, state);}
    return {...summary(), emailAvailable: readiness.available, emailVerified: verified};
  }, true);

  requireQa(state.identityPubkey !== null, 'identity_not_pinned', 'Run status before other live QA commands.');
  if (options.mode === 'check-ineligible') {
    requireQa(state.providerState === 'untouched' && !state.emailVerified && state.lastSendAttemptAt === 0 && state.pending === null,
      'fresh_fixture_required', 'Use a separate fresh fixture with no email send or registration attempt.');
    await session(NATIVE_DOMAIN, async sdk => {
      requireQa(!await emailStatus(sdk, state, fetchImpl), 'already_verified', 'The negative eligibility fixture must have an unverified email status.');
      requireQa(!await sdk.getLightningAddress(), 'existing_native_binding', 'The negative eligibility fixture already has a native name.');
      state.providerState = 'may_exist';
      await saveState(options.stateFile, state);
      let rejected = false;
      try {
        await sdk.registerLightningAddress({username: state.username, description: 'GetYourSats disposable live QA wallet'});
      } catch (error) {
        requireQa(isEmailEligibilityRejection(error), 'eligibility_rejection_unconfirmed',
          'The SDK did not report the exact verified-email rejection. Keep the fixture state for inspection.');
        rejected = true;
      }
      requireQa(rejected, 'unexpected_registration', 'An unverified fixture registered a name. Keep its state and pause new registrations.');
    });
    await session(NATIVE_DOMAIN, async sdk => {
      requireQa(!await sdk.getLightningAddress(), 'unexpected_registration', 'A native name exists after the eligibility rejection. Keep the fixture state.');
    });
    await publicLookupAbsent(fetchImpl, state.username);
    state.providerState = 'cleared';
    await saveState(options.stateFile, state);
    return {...summary(), ineligibleRegistrationRejected: true, rejectionStatus: 403, nativeAddressAbsent: true,
      publicLookupNotFound: true, emailVerified: false, paymentsInitiated: false};
  }
  if (options.mode === 'cleanup') {
    for (const domain of [NATIVE_DOMAIN, DEFAULT_DOMAIN]) await session(domain, async sdk => {
      await assertUnfunded(sdk, state);
      requireQa(!await sdk.getLightningAddress(), 'provider_cleanup_required', 'A provider address still exists. Keep this seed and complete provider cleanup before deleting local state.');
    });
    return {...summary(), liveEmptyWalletCheck: true, providerNamesAbsent: true};
  }
  if (options.mode === 'send') return session(NATIVE_DOMAIN, async sdk => {
    requireQa(!await emailStatus(sdk, state, fetchImpl), 'already_verified', 'This fixture is already verified. No additional email was sent.');
    requireQa(Date.now() - state.lastSendAttemptAt >= 600_000, 'send_already_attempted', 'A code was recently requested. Use verify or wait until the ten-minute window expires.');
    const proof = await proofFor(sdk, state.identityPubkey, 'send', fetchImpl);
    state.lastSendAttemptAt = Date.now();
    await saveState(options.stateFile, state);
    const result = await apiJson(fetchImpl, {action: 'send', email: state.email, ...proof});
    requireQa(typeof result.requestId === 'string' && /^[a-f0-9]{36}$/.test(result.requestId) && result.expiresIn === 600,
      'invalid_email_response', 'The send response was invalid. Inspect the single test email before retrying.');
    state.pending = {requestId: result.requestId, expiresAt: Date.now() + result.expiresIn * 1000};
    await saveState(options.stateFile, state);
    return {...summary(), sent: true, verificationPending: true};
  });

  if (options.mode === 'verify') return session(NATIVE_DOMAIN, async () => {
    requireQa(state.pending && state.pending.expiresAt > Date.now(), 'no_pending_code', 'Request a fresh fixture code before verifying.');
    requireQa(options.otpFile && dirname(resolve(options.otpFile)) === dirname(options.stateFile), 'unsafe_otp_file', 'Keep the OTP file inside the private fixture directory.');
    const code = (await privateText(options.otpFile)).trim();
    requireQa(/^\d{6}$/.test(code), 'invalid_otp_file', 'The private OTP file must contain only the six-digit code.');
    const result = await apiJson(fetchImpl, {action: 'verify', requestId: state.pending.requestId, code});
    requireQa(result.verified === true && result.email === state.email, 'invalid_verification', 'The verification response does not match the fixture.');
    state.emailVerified = true;
    state.pending = null;
    await saveState(options.stateFile, state);
    await unlink(options.otpFile);
    return {...summary(), emailVerified: true};
  });

  if (options.mode === 'register') {
    await session(NATIVE_DOMAIN, async sdk => {
      requireQa(await emailStatus(sdk, state, fetchImpl), 'email_not_verified', 'Verify the fixture email before registering names.');
    });
    // Check both domains before registering either, so an unexpected binding
    // cannot be overwritten by a partially completed fixture command.
    for (const domain of [DEFAULT_DOMAIN, NATIVE_DOMAIN]) await session(domain, async sdk => {
      const address = await sdk.getLightningAddress();
      if (address) checkAddress(address, state, domain);
    });
    state.providerState = 'may_exist';
    await saveState(options.stateFile, state);
    for (const domain of [DEFAULT_DOMAIN, NATIVE_DOMAIN]) await session(domain, async sdk => {
      let address = await sdk.getLightningAddress();
      if (!address) {
        const username = domain === NATIVE_DOMAIN ? state.username : state.defaultUsername;
        requireQa(await sdk.checkLightningAddressAvailable({username}), 'name_unavailable', 'The generated QA name is unavailable. Do not substitute another name in this fixture.');
        address = await sdk.registerLightningAddress({username, description: 'GetYourSats disposable live QA wallet'});
      }
      checkAddress(address, state, domain);
    });
    await publicLookup(fetchImpl, state.username, NATIVE_DOMAIN);
    await publicLookup(fetchImpl, state.defaultUsername, DEFAULT_DOMAIN);
    return {...summary(), registered: true, publicLookupsConfirmed: true, paymentsInitiated: false};
  }

  if (options.mode === 'recover') {
    requireQa(state.providerState === 'may_exist', 'no_registration', 'Register the fixture before checking restoration.');
    for (const domain of [DEFAULT_DOMAIN, NATIVE_DOMAIN]) await session(domain, async sdk => {
      checkAddress(await sdk.getLightningAddress(), state, domain);
    });
    const verified = await session(NATIVE_DOMAIN, sdk => emailStatus(sdk, state, fetchImpl));
    requireQa(verified, 'email_not_verified', 'The fixture email binding did not restore.');
    await publicLookup(fetchImpl, state.username, NATIVE_DOMAIN);
    await publicLookup(fetchImpl, state.defaultUsername, DEFAULT_DOMAIN);
    return {...summary(), restoredFromFreshStorage: true, sameIdentity: true, oldAddressUnchanged: true, emailVerified: true, paymentsInitiated: false};
  }

  if (options.mode === 'invoice-check') {
    requireQa(state.providerState === 'may_exist', 'no_registration', 'Register the fixture before checking invoice generation.');
    const lookups = [];
    // Validate both identities, names and limits before either invoice is created.
    for (const domain of [DEFAULT_DOMAIN, NATIVE_DOMAIN]) await session(domain, async sdk => {
      checkAddress(await sdk.getLightningAddress(), state, domain);
      const name = domain === NATIVE_DOMAIN ? state.username : state.defaultUsername;
      lookups.push({domain, metadata: checkInvoiceMetadata(await publicLookup(fetchImpl, name, domain), name, domain)});
    });
    for (const {domain, metadata} of lookups) await session(domain, async sdk => {
      checkAddress(await sdk.getLightningAddress(), state, domain);
      await checkInvoice(sdk, fetchImpl, metadata);
    });
    return {...summary(), invoicesValidated: true, invoiceCount: lookups.length, invoiceAmountSats: 1,
      sameIdentity: true, metadataHashesMatch: true, paymentsInitiated: false, settlementChecked: false};
  }

  if (options.mode === 'cleanup-provider') {
    for (const domain of [NATIVE_DOMAIN, DEFAULT_DOMAIN]) await session(domain, async sdk => {
      await assertUnfunded(sdk, state);
      const address = await sdk.getLightningAddress();
      if (address) checkAddress(address, state, domain);
    });
    state.providerState = 'may_exist';
    await saveState(options.stateFile, state);
    for (const domain of [NATIVE_DOMAIN, DEFAULT_DOMAIN]) {
      await session(domain, async sdk => {
        await assertUnfunded(sdk, state);
        const address = await sdk.getLightningAddress();
        if (address) {checkAddress(address, state, domain); await sdk.deleteLightningAddress();}
      });
      await session(domain, async sdk => {
        requireQa(!await sdk.getLightningAddress(), 'provider_cleanup_unconfirmed', 'The provider still returned a fixture name. Keep the local state for recovery.');
      });
    }
    state.providerState = 'cleared';
    await saveState(options.stateFile, state);
    return {...summary(), providerNamesRemoved: true, emailRecordMayRemain: state.emailVerified || state.lastSendAttemptAt > 0, paymentsInitiated: false};
  }
  throw new QaError('invalid_mode', 'This mode is not a supported live operation.');
}

export async function execute(options, dependencies = {}) {
  if (options.mode === 'init') return initFixture();
  const stateFile = resolve(options.stateFile);
  const directory = await checkDirectory(stateFile);
  const lockFile = join(directory, 'command.lock');
  let lock;
  try {lock = await open(lockFile, 'wx', 0o600);}
  catch {throw new QaError('fixture_locked', 'Another fixture command is running or left a lock. Inspect it before retrying.');}
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: Date.now()}));
    const state = validateState(JSON.parse(await privateText(stateFile)), stateFile);
    if (options.mode === 'cleanup') {
      requireQa(state.providerState !== 'may_exist', 'provider_cleanup_required', 'Run cleanup-provider and confirm removal before deleting this fixture state.');
      if (state.identityPubkey === null) {
        requireQa(state.providerState === 'untouched' && !state.emailVerified && state.lastSendAttemptAt === 0 && state.pending === null,
          'invalid_fixture', 'A used fixture must retain its pinned identity for safe cleanup.');
        await rm(directory, {recursive: true, force: false});
        return {mode: 'cleanup', localFilesRemoved: true, liveCalls: false, emailRecordMayRemain: false};
      }
    }
    requireQa(options.allowLive && options.envFile, 'live_confirmation_required', 'Live modes require --allow-live and a private --env-file.');
    const env = parseEnv(await privateText(options.envFile));
    requireQa(Object.keys(env).length === 1 && typeof env.BREEZ_API_KEY === 'string' && /^[^\s]{16,8192}$/.test(env.BREEZ_API_KEY),
      'invalid_env_file', 'The private env file must contain only BREEZ_API_KEY with the existing client API key.');
    const sdkModule = dependencies.sdkModule ?? await import('@breeztech/breez-sdk-spark');
    const result = await runLiveMode({...options, stateFile}, state, {apiKey: env.BREEZ_API_KEY, sdkModule, fetchImpl: dependencies.fetchImpl});
    if (options.mode === 'cleanup') {
      await rm(directory, {recursive: true, force: false});
      return {...result, localFilesRemoved: true, emailRecordMayRemain: state.emailVerified || state.lastSendAttemptAt > 0};
    }
    return result;
  } finally {
    await lock.close();
    await unlink(lockFile).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
}

// Usage: node tests/native-lightning-live-qa.mjs MODE --state PATH
// Init needs no options and runs offline. Live modes require --allow-live and
// --env-file PATH containing only BREEZ_API_KEY (mode 0600, never a CLI value).
// Verify also needs a mode 0600 --otp-file inside the fixture directory.
// Used-wallet cleanup repeats live empty-wallet/name checks before removing state.
// Invoice-check requests a one-sat invoice for each registered QA name. It never pays
// or stores invoice data. Settlement is not tested; funded tests need approval.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let exitCode = 0;
  const writeResult = (stream, value) => new Promise((resolveWrite, rejectWrite) => {
    stream.write(JSON.stringify(value) + '\n', error => error ? rejectWrite(error) : resolveWrite());
  });
  try {await writeResult(process.stdout, await execute(parseArguments(process.argv.slice(2))));}
  catch (error) {
    exitCode = 1;
    const safe = error instanceof QaError ? {code: error.code, message: error.message}
      : {code: 'qa_step_failed', message: 'The QA step failed. Sensitive SDK and provider details were not printed. Keep the fixture state.'};
    await writeResult(process.stderr, {ok: false, ...safe}).catch(() => {});
  }
  // SDK worker handles can remain referenced after disconnect/free. All awaited
  // cleanup and output flushing complete before terminating a direct CLI run.
  process.exit(exitCode);
}
