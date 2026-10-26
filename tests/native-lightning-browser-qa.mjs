import {constants} from 'node:fs';
import {open, readFile, realpath, readdir, stat, unlink} from 'node:fs/promises';
import {dirname, extname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import {validateState} from './native-lightning-live-qa.mjs';

const WALLET_ORIGIN = 'https://wallet.getyoursats.com';
const DOMAINS = new Set(['breez.tips', 'getyoursats.com']);
const PUBKEY = /^(02|03)[a-f0-9]{64}$/;
const TYPES = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml'};

export class BrowserQaError extends Error {
  constructor(code, message) {super(message); this.code = code;}
}

function requireQa(condition, code, message) {
  if (!condition) throw new BrowserQaError(code, message);
}

export function parseArguments(args) {
  const options = {allowLive: false};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--allow-live') {
      requireQa(!options.allowLive, 'invalid_arguments', 'Do not repeat command options.');
      options.allowLive = true;
      continue;
    }
    const names = {'--state': 'stateFile', '--dist': 'distDirectory', '--browser-executable': 'browserExecutable'};
    const key = Object.hasOwn(names, flag) ? names[flag] : null;
    requireQa(key && !options[key] && args[index + 1] && !args[index + 1].startsWith('--'),
      'invalid_arguments', 'Use --allow-live, --state, --dist and optionally --browser-executable.');
    options[key] = args[++index];
  }
  requireQa(options.allowLive && options.stateFile && options.distDirectory,
    'live_confirmation_required', 'Pass --allow-live, the private fixture --state and the compiled candidate --dist.');
  return options;
}

async function privateDirectory(stateFile) {
  const directory = dirname(stateFile);
  requireQa(/^\/tmp\/gys-live-qa-[a-f0-9]{16}\/state\.json$/.test(stateFile)
    && await realpath(directory) === directory, 'unsafe_fixture', 'Use the original private generated fixture.');
  const info = await stat(directory);
  requireQa(info.isDirectory() && (info.mode & 0o777) === 0o700
    && (typeof process.getuid !== 'function' || info.uid === process.getuid()),
  'unsafe_fixture', 'The fixture directory must be owned by this user with mode 0700.');
  return directory;
}

async function readFixture(stateFile) {
  const handle = await open(stateFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    requireQa(info.isFile() && (info.mode & 0o777) === 0o600 && info.size <= 32_768
      && (typeof process.getuid !== 'function' || info.uid === process.getuid()),
    'unsafe_fixture', 'The fixture state must be an owner-only mode 0600 regular file.');
    const state = validateState(JSON.parse(await handle.readFile('utf8')), stateFile);
    requireQa(PUBKEY.test(state.identityPubkey ?? '') && state.emailVerified
      && state.providerState === 'may_exist' && state.lastSendAttemptAt > 0 && state.pending === null,
    'fixture_not_ready', 'Use the verified, registered and identity-pinned disposable fixture.');
    return state;
  } finally {await handle.close();}
}

export async function staticManifest(directory) {
  const root = await realpath(resolve(directory));
  requireQa((await stat(root)).isDirectory(), 'invalid_candidate', 'The compiled candidate directory does not exist.');
  const files = new Map();
  async function visit(path, prefix) {
    for (const entry of await readdir(path, {withFileTypes: true})) {
      requireQa(!entry.isSymbolicLink(), 'invalid_candidate', 'Candidate assets must not contain symbolic links.');
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(path, entry.name), name);
      else if (entry.isFile()) files.set(name, {path: join(path, entry.name),
        contentType: TYPES[extname(entry.name)] ?? 'application/octet-stream'});
      requireQa(files.size <= 10_000, 'invalid_candidate', 'The candidate contains too many files.');
    }
  }
  await visit(root, '');
  requireQa(files.has('/index.html'), 'invalid_candidate', 'The candidate must contain index.html.');
  files.set('/', files.get('/index.html'));
  return files;
}

export async function candidateHeaders() {
  const configuration = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rules = configuration.headers?.filter(rule => rule.source === '/(.*)');
  requireQa(rules?.length === 1 && Array.isArray(rules[0].headers),
    'candidate_policy_missing', 'The production browser security header policy must be available.');
  const headers = Object.fromEntries(rules[0].headers.map(header => [header.key.toLowerCase(), header.value]));
  requireQa(typeof headers['content-security-policy'] === 'string'
    && headers['cross-origin-opener-policy'] === 'same-origin' && headers['cross-origin-embedder-policy'] === 'require-corp',
  'candidate_policy_missing', 'The candidate must preserve production CSP and cross-origin isolation.');
  return {...headers, 'cache-control': 'no-store'};
}

export function classifyRequest({url: rawUrl, method, postData}, state, files) {
  const url = new URL(rawUrl);
  const abort = code => ({kind: 'abort', code});
  if (url.protocol !== 'https:') return abort('unexpected_insecure_request');
  let decodedPath;
  try {decodedPath = decodeURIComponent(url.pathname);} catch {return abort('invalid_request_path');}
  if (DOMAINS.has(url.hostname) && decodedPath.startsWith('/lnurlpay')) {
    if (decodedPath !== url.pathname) return abort('unexpected_management_path');
    const match = /^\/lnurlpay\/((?:02|03)[a-f0-9]{64})(?:\/(recover|available|metadata))?$/.exec(url.pathname);
    if (!match || match[1] !== state.identityPubkey) return abort('unexpected_management_identity');
    const operation = match[2];
    if (!operation || method === 'DELETE') return abort('unexpected_management_mutation');
    const allowed = operation === 'metadata' ? ['GET', 'OPTIONS'] : ['POST', 'OPTIONS'];
    if (!allowed.includes(method)) return abort('unexpected_management_mutation');
    return {kind: 'continue'};
  }
  if (DOMAINS.has(url.hostname) && /^\/(?:\.well-known\/)?lnurlp\//.test(decodedPath)) {
    const name = url.hostname === 'getyoursats.com' ? state.username : state.defaultUsername;
    if (decodedPath !== url.pathname || url.search || url.hash
      || ![`/lnurlp/${name}`, `/.well-known/lnurlp/${name}`].includes(url.pathname)
      || !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return abort('unexpected_payment_request');
    }
  }
  if (url.origin !== WALLET_ORIGIN) return {kind: 'continue'};
  if (url.pathname === '/api/account/email') {
    if (method === 'GET') return {kind: 'continue'};
    if (method !== 'POST') return abort('unexpected_email_mutation');
    let body;
    try {body = JSON.parse(postData ?? '');} catch {return abort('invalid_email_request');}
    if (body?.action === 'challenge' && body.purpose === 'status' && body.walletPubkey === state.identityPubkey) {
      return {kind: 'continue'};
    }
    if (body?.action === 'status' && typeof body.challengeId === 'string' && typeof body.signature === 'string') {
      return {kind: 'continue'};
    }
    return abort('unexpected_email_mutation');
  }
  if (url.pathname.startsWith('/api/')) {
    return ['GET', 'HEAD'].includes(method) ? {kind: 'continue'} : abort('unexpected_api_mutation');
  }
  if (!['GET', 'HEAD'].includes(method)) return abort('unexpected_static_mutation');
  const file = files.get(url.pathname);
  return file ? {kind: 'static', file} : abort('candidate_asset_missing');
}

export function proxyOptions(environment) {
  const value = environment.HTTPS_PROXY || environment.https_proxy || environment.HTTP_PROXY || environment.http_proxy;
  if (!value) return undefined;
  const url = new URL(value);
  requireQa(['http:', 'https:'].includes(url.protocol), 'invalid_proxy', 'The configured browser proxy must use HTTP or HTTPS.');
  return {server: `${url.protocol}//${url.host}`, bypass: 'localhost,127.0.0.1,[::1]',
    ...(url.username ? {username: decodeURIComponent(url.username)} : {}),
    ...(url.password ? {password: decodeURIComponent(url.password)} : {})};
}

export function safeNetworkFailure(value) {
  return typeof value === 'string' && /^net::[A-Z0-9_]+$/.test(value) ? value : null;
}

async function runBrowserCheck(state, files, headers, {browserType = chromium, executablePath, progress = () => {}} = {}) {
  let browser, context, page;
  let fatal;
  let rejectFailure;
  let stage = 'browser_launch';
  const networkFailureCodes = new Set();
  const responseFailures = [];
  const failure = new Promise((_, reject) => {rejectFailure = reject;});
  void failure.catch(() => {});
  const evidence = {nativeRecoveries: 0, defaultRecoveries: 0, verifiedStatuses: 0, publicLookups: 0};
  const tasks = new Set();
  const fail = code => {
    if (!fatal) {
      fatal = new BrowserQaError(code, 'The browser QA guard stopped this check. The private fixture was retained.');
      rejectFailure(fatal);
    }
  };
  const checked = promise => Promise.race([promise, failure]);
  const expectedAddress = `${state.username}@getyoursats.com`;
  try {
    if (executablePath) {
      requireQa(resolve(executablePath) === executablePath && (await stat(executablePath)).isFile(),
        'invalid_browser_executable', 'The browser executable must be an existing absolute file path.');
    }
    browser = await browserType.launch({headless: true, ...(executablePath ? {executablePath} : {}), proxy: proxyOptions(process.env)});
    stage = 'browser_context';
    context = await browser.newContext({viewport: {width: 1280, height: 900}, locale: 'en-US', serviceWorkers: 'block'});
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: WALLET_ORIGIN});
    await context.route('**/*', async route => {
      try {
        const request = route.request();
        const decision = classifyRequest({url: request.url(), method: request.method(), postData: request.postData()}, state, files);
        if (decision.kind === 'abort') {fail(decision.code); await route.abort('blockedbyclient'); return;}
        if (decision.kind === 'continue') {await route.continue(); return;}
        await route.fulfill({status: 200, path: decision.file.path, contentType: decision.file.contentType, headers});
      } catch {fail('request_guard_failed'); await route.abort('blockedbyclient').catch(() => {});}
    });
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(45_000);
    context.on('page', popup => {fail('unexpected_browser_page'); void popup.close().catch(() => {});});
    page.on('dialog', dialog => {fail('unexpected_browser_dialog'); void dialog.dismiss().catch(() => {});});
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame() || frame.url() === 'about:blank') return;
      if (new URL(frame.url()).origin !== WALLET_ORIGIN) fail('unexpected_browser_navigation');
    });
    page.on('requestfailed', request => {
      const code = safeNetworkFailure(request.failure()?.errorText);
      if (!code) return;
      networkFailureCodes.add(code);
      if (code.startsWith('net::ERR_CERT_') || code === 'net::ERR_SSL_PROTOCOL_ERROR') fail('browser_tls_verification_failed');
    });
    page.on('response', response => {
      const task = (async () => {
        const url = new URL(response.url());
        const request = response.request();
        if (request.method() === 'OPTIONS') return;
        if (response.status() >= 400 && responseFailures.length < 12) {
          const kind = url.origin === WALLET_ORIGIN ? 'wallet_api'
            : url.hostname === 'getyoursats.com' ? 'native_provider'
              : url.hostname === 'breez.tips' ? 'default_provider' : 'sdk_service';
          responseFailures.push({kind, status: response.status()});
        }
        if (DOMAINS.has(url.hostname) && url.pathname === `/lnurlpay/${state.identityPubkey}/recover`) {
          const body = await response.json();
          const expected = url.hostname === 'getyoursats.com' ? expectedAddress : `${state.defaultUsername}@breez.tips`;
          if (!response.ok() || body?.lightning_address !== expected) {fail('unexpected_recovered_address'); return;}
          evidence[url.hostname === 'getyoursats.com' ? 'nativeRecoveries' : 'defaultRecoveries']++;
        } else if (url.origin === WALLET_ORIGIN && url.pathname === '/api/account/email' && request.method() === 'POST') {
          const sent = JSON.parse(request.postData() ?? '');
          if (sent.action === 'status') {
            const body = await response.json();
            if (!response.ok() || body.verified !== true || body.email !== state.email) {fail('unexpected_verified_email'); return;}
            evidence.verifiedStatuses++;
          }
        } else if (url.hostname === 'getyoursats.com'
          && [`/lnurlp/${state.username}`, `/.well-known/lnurlp/${state.username}`].includes(url.pathname)) {
          const body = await response.json();
          if (!response.ok() || body.tag !== 'payRequest' || body.callback !== `https://getyoursats.com/lnurlp/${state.username}/invoice`) {
            fail('unexpected_public_lookup'); return;
          }
          evidence.publicLookups++;
        }
      })().catch(() => fail('response_validation_failed'));
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    });

    stage = 'candidate_load';
    await checked(page.goto(`${WALLET_ORIGIN}/?network=mainnet`, {waitUntil: 'domcontentloaded'}));
    requireQa(await checked(page.evaluate(() => window.isSecureContext && window.crossOriginIsolated)),
      'candidate_not_isolated', 'The candidate must retain the production WASM isolation headers.');
    progress({stage: 'candidate_loaded', isolated: true});
    stage = 'recovery_navigation';
    await checked(page.getByRole('button', {name: 'Restore existing wallet', exact: true}).click());
    await checked(page.getByRole('button', {name: 'Restore with handwritten recovery words', exact: true}).click());
    stage = 'recovery_input';
    await checked(page.getByTestId('mnemonic-input').fill(state.mnemonic));
    state.mnemonic = '';
    stage = 'wallet_restore';
    await checked(page.getByTestId('restore-confirm-button').click());

    async function checkHome() {
      const address = page.getByRole('button', {name: 'Copy your Lightning address', exact: true});
      await checked(address.waitFor({state: 'visible', timeout: 120_000}));
      requireQa((await checked(address.textContent()))?.trim() === expectedAddress,
        'native_home_mismatch', 'The restored wallet did not show its exact native address.');
      requireQa(await checked(page.getByTestId('mnemonic-input').count()) === 0,
        'recovery_input_retained', 'The recovery input must be unmounted before continuing.');
    }
    async function checkName() {
      await checked(page.getByRole('complementary', {name: 'Wallet navigation'}).getByRole('button', {name: 'Settings', exact: true}).click());
      const email = page.getByRole('button', {name: 'Verify Email Address', exact: true});
      await checked(email.waitFor({state: 'visible'}));
      requireQa(await checked(email.isEnabled()), 'candidate_gates_disabled', 'The local candidate email feature is still disabled.');
      await checked(email.click());
      const verified = page.getByRole('region', {name: 'Verified email'});
      await checked(verified.waitFor({state: 'visible', timeout: 45_000}));
      requireQa((await checked(verified.textContent()))?.includes(state.email),
        'verified_email_mismatch', 'The restored verified email did not match the disposable fixture.');
      const copy = page.getByRole('button', {name: 'Copy Address', exact: true});
      await checked(copy.waitFor({state: 'visible', timeout: 45_000}));
      await checked(copy.click());
      await checked(page.getByRole('button', {name: 'Copied', exact: true}).waitFor({state: 'visible'}));
      requireQa(await checked(page.evaluate(() => navigator.clipboard.readText())) === expectedAddress,
        'copied_address_mismatch', 'The copied address did not match the disposable fixture.');
    }
    await checkHome();
    progress({stage: 'wallet_restored', nativeHomeConfirmed: true});
    stage = 'verified_identity';
    await checkName();
    progress({stage: 'name_confirmed', verifiedEmail: true, publicLookup: true, copiedAddress: true});
    stage = 'reload';
    await checked(page.reload({waitUntil: 'domcontentloaded'}));
    stage = 'reload_home';
    await checkHome();
    stage = 'reload_identity';
    await checkName();
    await checked(Promise.all([...tasks]));
    requireQa(evidence.nativeRecoveries >= 2 && evidence.verifiedStatuses >= 2 && evidence.publicLookups >= 2,
      'live_evidence_incomplete', 'Fresh recovery, signed verified status and public lookup must all be observed before and after reload.');
    return {ok: true, nativeHomeConfirmed: true, verifiedEmailRestored: true, copiedAddressConfirmed: true,
      reloadRestored: true, identityMatched: true, defaultRecoveryObserved: evidence.defaultRecoveries > 0,
      providerMutations: 0, emailsSent: 0, invoicesGenerated: 0, paymentsInitiated: false, fixtureRetained: true};
  } catch (error) {
    const safe = error instanceof BrowserQaError ? error : new BrowserQaError('browser_qa_failed',
      'The browser check failed. Sensitive input and browser details were not printed. The fixture was retained.');
    safe.diagnostics = {stage, networkFailureCodes: [...networkFailureCodes], responseFailures};
    throw safe;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

export async function execute(options) {
  requireQa(options.allowLive === true, 'live_confirmation_required', 'Live browser QA requires --allow-live.');
  const stateFile = resolve(options.stateFile);
  const directory = await privateDirectory(stateFile);
  const lockFile = join(directory, 'command.lock');
  let lock;
  try {lock = await open(lockFile, 'wx', 0o600);}
  catch {throw new BrowserQaError('fixture_locked', 'Another fixture command is running or left a lock. Inspect it before retrying.');}
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: Date.now()}));
    const state = await readFixture(stateFile);
    const files = await staticManifest(options.distDirectory);
    const headers = await candidateHeaders();
    return await runBrowserCheck(state, files, headers, {executablePath: options.browserExecutable ?? process.env.GYS_QA_CHROMIUM_PATH,
      progress: event => process.stdout.write(JSON.stringify(event) + '\n')});
  } finally {
    await lock.close();
    await unlink(lockFile).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
}

// Run with --allow-live --state PATH --dist PATH only after provider QA.
// A new non-persistent browser serves the local build under the wallet origin.
// Recording is never enabled and raw browser errors are never printed.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {process.stdout.write(JSON.stringify(await execute(parseArguments(process.argv.slice(2)))) + '\n', () => process.exit(0));}
  catch (error) {
    const safe = error instanceof BrowserQaError ? {code: error.code, message: error.message, ...(error.diagnostics ?? {})}
      : {code: 'browser_qa_failed', message: 'The browser check failed. Sensitive input and browser details were not printed. The fixture was retained.'};
    process.stderr.write(JSON.stringify({ok: false, ...safe}) + '\n', () => process.exit(1));
  }
}
