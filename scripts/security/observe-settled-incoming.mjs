/** No fresh payments: copies retained REGTEST stores, observes three completed IDs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {OBSERVATION_ORIGIN, OBSERVATION_PLAN, EXPECTED_PATCH, PRIOR_RECEIPT_SHA256,
  EXECUTION_BLOCK, assertObservationExecutionAllowed} from '../../e2e/fixtures/settled-incoming-contract.ts';
import {createTransportPolicy} from './settled-observation-transport.mjs';
import {digest, inventory, inventorySummary, validateOriginalRoot, copyOriginStores} from './settled-observation-files.mjs';

export {EXECUTION_BLOCK};

export function assertArtifactBinding({expectedPackage, expectedPatch, expectedWasm, archive, patch, manifest, installedManifest}) {
  assert.match(expectedPackage ?? '', /^[0-9a-f]{64}$/, 'Explicit final canonical package SHA256 required');
  assert.match(expectedWasm ?? '', /^[0-9a-f]{64}$/, 'Explicit final browser WASM SHA256 required');
  assert.equal(expectedPatch, EXPECTED_PATCH, 'Only the reviewed 0006 source is supported');
  assert.equal(digest(archive), expectedPackage); assert.equal(manifest.packageSha256, expectedPackage);
  assert.equal(digest(patch), expectedPatch); assert.equal(manifest.patchSha256, expectedPatch);
  assert.equal(manifest.sdkSourceCommit, '57c5b9e5f0749f97ffe5d93bce21c994f6957cf4');
  assert.equal(manifest.generatedArtifacts['web/breez_sdk_spark_wasm_bg.wasm'], expectedWasm);
  const {packageSha256: _packageSha256, ...inner} = manifest;
  assert.deepEqual(installedManifest, inner, 'Installed manifest must match the canonical artifact');
  for (const extension of ['strict-transfer-evidence-v1', 'atomic-cache-reservation-v1']) assert(manifest.extensions.includes(extension));
}

export async function main() {
  // The subsequently confirmed external-signer namespace defect affects0006.
  // Retained profiles use its placeholder namespace. No environment flag may
  // authorize a connection/copy/migration before a separately reviewed successor.
  assertObservationExecutionAllowed();
}

/** Prepared implementation only. Deliberately not exported or invoked while
 * the namespace/provenance blocker is unresolved. Keep offline guards testable. */
async function preparedObservationRun() {
  assert.equal(process.env.GYS_OBSERVATION_AUTHORIZED, 'settled-regtest-receipts-only', 'Explicit observation execution required');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(repo), 'Run from the reviewed harness checkout');
  const original = path.resolve(process.env.GYS_OBSERVATION_PROFILE_ROOT ?? '');
  validateOriginalRoot(original);
  const receiptPath = process.env.GYS_OBSERVATION_PRIOR_RECEIPT;
  assert(receiptPath, 'Committed reconciliation receipt required');
  assert.equal(digest(fs.readFileSync(receiptPath)), PRIOR_RECEIPT_SHA256);
  const require = createRequire(import.meta.url);
  const sdkRoot = path.resolve(path.dirname(require.resolve('@breeztech/breez-sdk-spark')), '..');
  const archivePath = path.join(repo, 'vendor/breeztech-breez-sdk-spark.tgz');
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'vendor/getyoursats-sdk-build.json')));
  assertArtifactBinding({expectedPackage: process.env.GYS_OBSERVATION_EXPECTED_PACKAGE_SHA256,
    expectedPatch: process.env.GYS_OBSERVATION_EXPECTED_PATCH_SHA256,
    expectedWasm: process.env.GYS_OBSERVATION_EXPECTED_WEB_WASM_SHA256, archive: fs.readFileSync(archivePath),
    patch: fs.readFileSync(path.join(repo, 'vendor/patches/0006-reconciled-recovery-source.patch')),
    manifest, installedManifest: JSON.parse(fs.readFileSync(path.join(sdkRoot, 'getyoursats-build.json')))});
  assert.equal(digest(fs.readFileSync(path.join(sdkRoot, 'web/breez_sdk_spark_wasm_bg.wasm'))),
    process.env.GYS_OBSERVATION_EXPECTED_WEB_WASM_SHA256);
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim(), '',
    'Tracked harness/source must be committed before a provider check');
  const installed = JSON.parse(execFileSync('python3', [path.join(repo, 'scripts/security/verify-observation-package.py'), archivePath, sdkRoot], {encoding: 'utf8'}));
  // Existing complete source/adapter/generated-byte/API guard, no wallet calls.
  const {verifyInstalledSdk} = await import('./verify-observation-extension.mjs');
  await verifyInstalledSdk();
  const before = {};
  for (const plan of OBSERVATION_PLAN) before[plan.profile] = await inventory(path.join(original, plan.profile));
  const output = fs.mkdtempSync('/tmp/gys-settled-incoming-0006-'); fs.chmodSync(output, 0o700);
  fs.writeFileSync(path.join(output, 'original-before.json'), JSON.stringify(before), {mode: 0o600, flag: 'wx'});
  const report = {schema: 1, result: 'BLOCKED', scope: 'fresh-positive-completed-incoming-compatibility-only',
    network: 'regtest', realFunds: false, newEconomicOperationsAuthorized: false, fullProductAcceptance: false,
    origin: OBSERVATION_ORIGIN, expectedPackageSha256: manifest.packageSha256, expectedPatchSha256: EXPECTED_PATCH,
    expectedWebWasmSha256: process.env.GYS_OBSERVATION_EXPECTED_WEB_WASM_SHA256,
    priorReceiptSha256: PRIOR_RECEIPT_SHA256, installed, originalProfilesPreserved: false,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim() !== '',
    originalBefore: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, inventorySummary(value)])),
    receipts: [], transport: [], startedAt: new Date().toISOString()};
  let server; const contexts = []; const policies = []; let deadline;
  try {
    await copyOriginStores(original, path.join(output, 'profiles'));
    const [{createServer}, {default: wasm}, {chromium}] = await Promise.all([import('vite'), import('vite-plugin-wasm'), import('@playwright/test')]);
    server = await createServer({root: repo, configFile: false, envFile: false, plugins: [wasm()],
      resolve: {alias: [{find: /^@breeztech\/breez-sdk-spark$/, replacement: path.join(sdkRoot, 'web/index.js')}]},
      optimizeDeps: {exclude: ['@breeztech/breez-sdk-spark']},
      server: {host: '127.0.0.1', port: 5183, strictPort: true, hmr: false,
        fs: {allow: [repo, sdkRoot, path.join(repo, 'node_modules')]},
        headers: {'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Opener-Policy': 'same-origin'}}});
    await server.listen();
    deadline = setTimeout(() => {for (const context of contexts) void context.close();}, 120000);
    for (const plan of OBSERVATION_PLAN) {
      const policy = createTransportPolicy(plan);
      policies.push({profile: plan.profile, policy});
      const context = await chromium.launchPersistentContext(path.join(output, 'profiles', plan.profile), {
        headless: true, serviceWorkers: 'block', executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: ['--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'],
      });
      contexts.push(context);
      await context.routeWebSocket('**/*', route => {policy.denyWebSocket(); route.close();});
      await context.route('**/*', async route => {
        try {
          const request = route.request();
          policy.authorize({url: request.url(), method: request.method(), contentType: request.headers()['content-type'] ?? '', body: request.postDataBuffer()});
          // Browser redirects can escape an initial route interception. Fetch one
          // hop, reject every redirect, then fulfill that exact response.
          const response = await route.fetch({maxRedirects: 0, maxRetries: 0, timeout: 20000});
          if (response.status() >= 300 && response.status() < 400) {policy.denyRedirect(); throw Error('Redirect denied');}
          await route.fulfill({response});
        } catch {await route.abort('blockedbyclient').catch(() => {});}
      });
      const page = context.pages()[0] ?? await context.newPage();
      // Fresh profile has origin stores only; there are no restored pages/workers.
      assert(['about:blank', ''].includes(page.url()));
      await page.goto(OBSERVATION_ORIGIN + '/e2e/fixtures/settled-incoming-observation.html?network=regtest');
      await page.waitForFunction(() => typeof window.gysSettledIncomingObservation?.observe === 'function');
      const result = await page.evaluate(profile => window.gysSettledIncomingObservation.observe(profile), plan.profile);
      await context.close();
      assert.equal(policy.snapshot().denied, 0, 'No unapproved request may be hidden by successful observations');
      report.receipts.push(result);
    }
    assert.equal(report.receipts.reduce((n, item) => n + item.receipts.length, 0), 3);
    report.result = 'PASS_FRESH_COMPLETED_INCOMING_COMPATIBILITY_ONLY';
  } catch {
    report.result = 'BLOCKED'; report.error = 'An exact artifact, origin, identity, transport, or incoming receipt gate failed. No retry is authorized.';
  } finally {
    if (deadline) clearTimeout(deadline);
    for (const context of contexts) await context.close().catch(() => {});
    if (server) await server.close();
    report.transport = policies.map(({profile, policy}) => ({profile, ...policy.snapshot()}));
    const after = {};
    for (const plan of OBSERVATION_PLAN) after[plan.profile] = await inventory(path.join(original, plan.profile));
    fs.writeFileSync(path.join(output, 'original-after.json'), JSON.stringify(after), {mode: 0o600, flag: 'wx'});
    report.originalAfter = Object.fromEntries(Object.entries(after).map(([key, value]) => [key, inventorySummary(value)]));
    report.originalProfilesPreserved = JSON.stringify(after) === JSON.stringify(before);
    if (!report.originalProfilesPreserved) report.result = 'BLOCKED_ORIGINAL_PROFILE_CHANGED';
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    console.log(JSON.stringify({result: report.result, output, originalProfilesPreserved: report.originalProfilesPreserved}));
  }
  if (report.result !== 'PASS_FRESH_COMPLETED_INCOMING_COMPATIBILITY_ONLY') process.exitCode = 1;
}
// Retain the reviewed prepared implementation without making it a callable CLI.
void preparedObservationRun;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {console.error(EXECUTION_BLOCK + ': no profile preparation or wallet connection is permitted.'); process.exitCode = 1;});
}
