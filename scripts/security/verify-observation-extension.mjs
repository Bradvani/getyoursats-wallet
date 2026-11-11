/** Offline artifact/API checks only. Does not connect a wallet or prove settlement. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyCanonicalInstalledSdk } from './verify-canonical-installed-sdk.mjs';

const targets = ['web', 'nodejs', 'bundler', 'deno'];
const browserStorageSource = 'crates/breez-sdk/wasm/js/web-storage/index.js';
const browserStorageTargets = ['web/storage/index.js', 'bundler/storage/index.js'];
const baselineStorageSha256 = '1c4562a4b62898422d4ed11324e9622a337429cc322e030ed502eccd2fc6fc0d';
const baselineStorageGitBlob = '07ca313f7f18dc4ce1857ab9342664044126ac11';

export function assertNonterminalOutcome(declarations, target) {
  const outcomes = [...declarations.matchAll(/export type IncomingLightningObservationOutcome\s*=\s*([^;]+);/g)];
  assert.equal(outcomes.length, 1, `${target}: one nonterminal Lightning outcome declaration`);
  assert.match(outcomes[0][1], /^\s*(?:"awaitingPreimage"\s*\|\s*"unresolved"|"unresolved"\s*\|\s*"awaitingPreimage")\s*$/,
    `${target}: complete nonterminal Lightning outcome union`);
}

export function assertStorageContract(declarations, target) {
  const uncommented = declarations.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
  const interfaces = [...uncommented.matchAll(/export interface Storage\s*\{([\s\S]*?)\n\}/g)];
  assert.equal(interfaces.length, 1, `${target}: one Storage interface`);
  const body = interfaces[0][1];
  assert.equal([...body.matchAll(/\bcompareAndSwapCachedItem\b/g)].length, 1,
    `${target}: one optional atomic storage commit contract`);
  const signatures = [...body.matchAll(/(?:^|[\r\n;])\s*compareAndSwapCachedItem(\?)?\s*:\s*([^;]+);/g)];
  assert.equal(signatures.length, 1, `${target}: one optional atomic storage commit contract`);
  assert.equal(signatures[0][1], '?', `${target}: optional unsupported-store contract`);
  assert.equal(signatures[0][2].replace(/\s+/g, ''),
    '(key:string,expected:string|null,value:string)=>Promise<boolean>',
    `${target}: exact null/string predicate and boolean commit acknowledgement`);
}

export function assertProductionWasmExports(exports, target) {
  const testExports = exports.filter(({ name }) =>
    /__wbgt__|__wbgtest_|wasmbindgentestcontext|storage_cas_bridge_/.test(name));
  assert.deepEqual(testExports, [], `${target}: production WASM must not export test fixtures or a test runner`);
}

export function verifyStorageAdapters(root, storageAdapters, patch) {
  assert(storageAdapters !== null && typeof storageAdapters === 'object' && !Array.isArray(storageAdapters),
    'Reviewed browser storage adapter manifest is an object');
  assert.deepEqual(Object.keys(storageAdapters).sort(), ['sourceFile', 'sourceSha256', 'baselineSha256', 'artifacts'].sort(),
    'Exact browser storage adapter provenance fields');
  assert.equal(storageAdapters.sourceFile, browserStorageSource);
  assert.equal(storageAdapters.baselineSha256, baselineStorageSha256);
  assert.match(storageAdapters.sourceSha256, /^[0-9a-f]{64}$/, 'Browser storage source SHA256');
  assert(storageAdapters.artifacts !== null && typeof storageAdapters.artifacts === 'object'
    && !Array.isArray(storageAdapters.artifacts), 'Browser storage artifact hashes are an object');
  assert.deepEqual(Object.keys(storageAdapters.artifacts).sort(), [...browserStorageTargets].sort(),
    'Exactly the two reviewed browser storage adapters are bound');
  const sections = patch.toString('utf8').split(`diff --git a/${browserStorageSource} b/${browserStorageSource}\n`);
  assert.equal(sections.length, 2, 'Patch contains exactly one browser storage source delta');
  const section = sections[1].split('\ndiff --git ')[0];
  const index = section.match(/^index ([0-9a-f]{40})\.\.([0-9a-f]{40}) 100644$/m);
  assert(index, 'Storage source delta names full regular-file Git blob identities');
  assert.equal(index[1], baselineStorageGitBlob, 'Storage patch retains the pinned original adapter');
  for (const relative of browserStorageTargets) {
    let current = root;
    for (const component of relative.split('/')) {
      current = path.join(current, component);
      assert(!fs.lstatSync(current).isSymbolicLink(), `Storage adapter path cannot contain a symbolic link: ${relative}`);
    }
    assert(fs.lstatSync(current).isFile(), `Storage adapter must be a regular file: ${relative}`);
    const data = fs.readFileSync(current);
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    assert.equal(storageAdapters.artifacts[relative], storageAdapters.sourceSha256, `${relative}: reviewed source digest`);
    assert.equal(digest, storageAdapters.sourceSha256, `${relative}: installed bytes match source manifest`);
    assert.equal(crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'), index[2],
      `${relative}: installed bytes match the complete reviewed source patch`);
  }
  return browserStorageTargets.length;
}

export function verifyGeneratedArtifacts(root, generatedArtifacts) {
  assert(generatedArtifacts !== null && typeof generatedArtifacts === 'object' && !Array.isArray(generatedArtifacts),
    'Generated artifact manifest is an object');
  const inventory = [];
  function visit(relative, directoryAllowed) {
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), `Generated artifact cannot be a symbolic link: ${relative}`);
    if (stat.isDirectory()) {
      assert(directoryAllowed, `Unexpected generated binding directory: ${relative}`);
      for (const name of fs.readdirSync(file)) visit(`${relative}/${name}`, true);
    } else {
      assert(stat.isFile(), `Generated artifact must be a regular file: ${relative}`);
      inventory.push(relative);
    }
  }
  for (const target of targets) {
    const directory = path.join(root, target);
    const stat = fs.lstatSync(directory);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), `Generated target must be a real directory: ${target}`);
    for (const name of fs.readdirSync(directory)) {
      if (name.startsWith('breez_sdk_spark_wasm')) visit(`${target}/${name}`, false);
      else if (name === 'snippets') {
        assert(fs.lstatSync(path.join(directory, name)).isDirectory(), `Generated snippets must be a directory: ${target}`);
        visit(`${target}/${name}`, true);
      }
    }
    for (const suffix of ['.js', '.d.ts', '_bg.wasm', '_bg.wasm.d.ts', ...(target === 'bundler' ? ['_bg.js'] : [])]) {
      assert(inventory.includes(`${target}/breez_sdk_spark_wasm${suffix}`), `${target}: required generated output ${suffix}`);
    }
  }
  assert.deepEqual(Object.keys(generatedArtifacts).sort(), inventory.sort(),
    'Manifest covers the exact generated binding and recursive snippet inventory');
  for (const file of inventory) {
    assert.match(generatedArtifacts[file], /^[0-9a-f]{64}$/, `SHA256 for ${file}`);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
      generatedArtifacts[file], file);
  }
  return inventory.length;
}

export async function verifyInstalledSdk() {
  const { packageRoot: root, manifest, metadata } = verifyCanonicalInstalledSdk();
  const extensions = [
    'seed-compatible-external-signers-v1', 'observation-only-wallet-state-v1',
    'signed-recovery-v1', 'explicit-incoming-claim-v1', 'bounded-mature-deposit-claim-v1',
    'strict-transfer-evidence-v1', 'bounded-deposit-observation-v1',
    'incoming-lightning-observation-v1', 'external-exit-envelope-validation-v1',
    'unreceived-deposit-continuation-v1', 'recovery-signer-envelope-v1',
    'atomic-cache-reservation-v1', 'external-signer-storage-identity-v1',
  ];
  assert.equal(metadata.version, '0.1.0-getyoursats.recovery.3');
  assert.equal(manifest.sdkSourceCommit, '57c5b9e5f0749f97ffe5d93bce21c994f6957cf4');
  assert.deepEqual([...manifest.extensions].sort(), [...extensions].sort(), 'Exact reviewed extension set');
  const artifacts = verifyGeneratedArtifacts(root, manifest.generatedArtifacts);
  const patch = fs.readFileSync('vendor/patches/0007-signer-storage-identity.patch');
  assert.equal(crypto.createHash('sha256').update(patch).digest('hex'), manifest.patchSha256);
  const storageAdapterArtifacts = verifyStorageAdapters(root, manifest.storageAdapters, patch);
  for (const target of targets) {
    const bytes = fs.readFileSync(path.join(root, target, 'breez_sdk_spark_wasm_bg.wasm'));
    assertProductionWasmExports(WebAssembly.Module.exports(new WebAssembly.Module(bytes)), target);
  }
  const sdk = await import('@breeztech/breez-sdk-spark');

  const methods = [
    'observeWalletState', 'observePayment', 'signRefundDeposit', 'verifyRefundTransaction',
    'inspectRecoveryTransaction', 'claimIncomingTransfer', 'observeIncomingTransfer',
    'claimMatureDepositOnce', 'observeDepositClaim', 'observeIncomingLightning',
    'continueMatureDepositClaim',
  ];
  for (const method of methods) assert.equal(typeof sdk.BreezSdk.prototype[method], 'function', method);
  const browserSdk = await import(pathToFileURL(path.join(root, 'web/breez_sdk_spark_wasm.js')).href);
  const browserWasm = fs.readFileSync(path.join(root, 'web/breez_sdk_spark_wasm_bg.wasm'));
  browserSdk.initSync({ module: browserWasm });
  for (const method of methods) assert.equal(typeof browserSdk.BreezSdk.prototype[method], 'function', `web:${method}`);
  const wasmExports = WebAssembly.Module.exports(new WebAssembly.Module(browserWasm));
  for (const method of ['observeIncomingLightning', 'continueMatureDepositClaim']) {
    assert(wasmExports.some(({ name, kind }) => name === `breezsdk_${method}` && kind === 'function'),
      `Actual browser WASM exports ${method}`);
  }

  const contracts = {
    ObserveDepositClaimResponse: ['correlation?: DepositClaimCorrelation;'],
    DepositClaimCorrelation: ['correlationId: string;', 'intentHash: string;', 'transferId: string;', 'sspRequestId: string;'],
    ObserveIncomingLightningRequest: ['paymentId: string;', 'identityPubkey: string;', 'network: Network;',
      'invoice: string;', 'invoiceAmountSats: number;', 'maxFeeSats: number;',
      'minimumCreditSats: number;', 'expectedBindingHash?: string;'],
    ObserveIncomingLightningResponse: ['paymentId: string;', 'identityPubkey: string;', 'network: Network;',
      'observedAt: number;', 'outcome: IncomingLightningObservationOutcome;', 'binding?: IncomingLightningBinding;'],
    IncomingLightningBinding: ['bindingHash: string;', 'sspIdentityPubkey: string;', 'sspRequestId: string;',
      'paymentHash: string;', 'creditSats: number;', 'feeSats: number;',
      'invoiceExpiresAt: number;', 'htlcExpiresAt: number;'],
  };
  for (const target of targets) {
    const declarations = fs.readFileSync(path.join(root, target, 'breez_sdk_spark_wasm.d.ts'), 'utf8');
    assert.match(declarations, /observeIncomingLightning\(request: ObserveIncomingLightningRequest\): Promise<ObserveIncomingLightningResponse>;/, target);
    assert.match(declarations, /continueMatureDepositClaim\(request: MatureDepositClaimRequest\): Promise<ClaimDepositResponse>;/, target);
    for (const [name, fields] of Object.entries(contracts)) {
      const body = declarations.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
      assert.equal(typeof body, 'string', `${target}:${name}`);
      for (const field of fields) assert(body.includes(field), `${target}:${name}:${field}`);
    }
    assertNonterminalOutcome(declarations, target);
    assertStorageContract(declarations, target);
  }
  console.log(JSON.stringify({
    test: 'installed observation/recovery API, generated correlation models and artifact integrity', result: 'PASS',
    extensions: manifest.extensions, methods: methods.length, models: Object.keys(contracts).length,
    runtimeMethodTargets: ['nodejs', 'web'], browserWasmObservationExport: true,
    browserWasmContinuationExport: true, storageAdapterArtifacts,
    generatedTargets: targets.length, artifacts, productionWasmTargetsWithoutTestExports: targets.length,
    walletOperationsInvoked: false, networkCallsInstrumented: false,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await verifyInstalledSdk();
}
