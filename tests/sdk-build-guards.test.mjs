import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertNonterminalOutcome, assertStorageContract, assertProductionWasmExports, verifyGeneratedArtifacts, verifyStorageAdapters } from '../scripts/security/verify-observation-extension.mjs';

const declaration = (expression) => `export type IncomingLightningObservationOutcome = ${expression};\n`;

test('the exact two nonterminal literals are accepted in either generated order', () => {
  for (const expression of ['"awaitingPreimage" | "unresolved"', ' "unresolved"\n | "awaitingPreimage" ']) {
    assertNonterminalOutcome(declaration(expression), 'fixture');
  }
});

for (const extra of ['string', 'any', 'unknown', 'undefined', 'OtherOutcome', 'never']) {
  test(`an added ${extra} type fails despite the old literal extraction passing`, () => {
    const expression = `"awaitingPreimage" | "unresolved" | ${extra}`;
    assert.deepEqual([...expression.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort(), ['awaitingPreimage', 'unresolved']);
    assert.throws(() => assertNonterminalOutcome(declaration(expression), 'fixture'), /complete nonterminal/);
  });
}

test('duplicate, missing, terminal, and intersection outcome declarations are rejected', () => {
  const valid = declaration('"awaitingPreimage" | "unresolved"');
  for (const text of [valid + valid, '', declaration('"awaitingPreimage" | "unresolved" | "completed"'),
    declaration('"awaitingPreimage" | "unresolved" & OtherOutcome')]) {
    assert.throws(() => assertNonterminalOutcome(text, 'fixture'));
  }
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gys-generated-artifact-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = {};
  for (const target of ['web', 'nodejs', 'bundler', 'deno']) {
    fs.mkdirSync(path.join(root, target), { recursive: true });
    const files = ['.js', '.d.ts', '_bg.wasm', '_bg.wasm.d.ts', ...(target === 'bundler' ? ['_bg.js'] : [])]
      .map((suffix) => `${target}/breez_sdk_spark_wasm${suffix}`);
    files.push(`${target}/snippets/public-fixture/nested/inline.js`);
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), `public generated fixture: ${file}\n`);
      manifest[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    }
  }
  return { root, manifest };
}

function oldListedFileCheck(root, manifest) {
  for (const target of ['web', 'nodejs', 'bundler', 'deno']) {
    for (const suffix of ['.js', '.d.ts', '_bg.wasm']) {
      assert.equal(typeof manifest[`${target}/breez_sdk_spark_wasm${suffix}`], 'string');
    }
  }
  for (const [file, digest] of Object.entries(manifest)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), digest);
  }
}

test('complete generated bindings and recursive snippets pass', (t) => {
  const { root, manifest } = fixture(t);
  assert.equal(verifyGeneratedArtifacts(root, manifest), 21);
});

for (const missing of ['bundler/breez_sdk_spark_wasm_bg.js', 'web/snippets/public-fixture/nested/inline.js']) {
  test(`omitting ${missing} from the manifest fails after the old check passed`, (t) => {
    const { root, manifest } = fixture(t);
    delete manifest[missing];
    oldListedFileCheck(root, manifest);
    assert.throws(() => verifyGeneratedArtifacts(root, manifest), /exact generated/);
  });
}

test('unlisted generated helper or nested snippet is rejected', (t) => {
  const { root, manifest } = fixture(t);
  fs.writeFileSync(path.join(root, 'web/snippets/public-fixture/nested/unlisted.js'), 'unlisted fixture');
  assert.throws(() => verifyGeneratedArtifacts(root, manifest), /exact generated/);
});

test('a generated file whose content changes is rejected', (t) => {
  const { root, manifest } = fixture(t);
  fs.appendFileSync(path.join(root, 'bundler/breez_sdk_spark_wasm_bg.js'), 'changed');
  assert.throws(() => verifyGeneratedArtifacts(root, manifest), /breez_sdk_spark_wasm_bg.js/);
});

test('a listed but missing generated file is rejected', (t) => {
  const { root, manifest } = fixture(t);
  fs.rmSync(path.join(root, 'web/snippets/public-fixture/nested/inline.js'));
  assert.throws(() => verifyGeneratedArtifacts(root, manifest), /exact generated/);
});

test('a generated-file symlink cannot substitute bytes outside the inventory', (t) => {
  const { root, manifest } = fixture(t);
  const helper = path.join(root, 'bundler/breez_sdk_spark_wasm_bg.js');
  fs.renameSync(helper, path.join(root, 'outside.js'));
  fs.symlinkSync('../outside.js', helper);
  // The old check follows the link and still accepts the expected digest.
  oldListedFileCheck(root, manifest);
  assert.throws(() => verifyGeneratedArtifacts(root, manifest), /symbolic link/);
});

test('manifest traversal paths and malformed digests are rejected', (t) => {
  const { root, manifest } = fixture(t);
  assert.throws(() => verifyGeneratedArtifacts(root, { ...manifest, '../outside.js': '0'.repeat(64) }), /exact generated/);
  manifest['web/breez_sdk_spark_wasm.js'] = 'not-a-sha256';
  assert.throws(() => verifyGeneratedArtifacts(root, manifest), /SHA256/);
});

const storageDeclaration = (expression) => `export interface Storage {\n compareAndSwapCachedItem?: ${expression};\n}\n`;
const exactStorageContract = '(key: string, expected: string | null, value: string) => Promise<boolean>';

test('the generated optional storage method has an exact null/string predicate and boolean Promise', () => {
  assertStorageContract(storageDeclaration(exactStorageContract), 'fixture');
});

test('widened, absent, duplicate or non-Promise storage commit contracts are rejected', () => {
  for (const expression of [exactStorageContract.replace('boolean', 'boolean | string'),
    exactStorageContract.replace('string | null', 'string | undefined'),
    exactStorageContract.replace('Promise<boolean>', 'boolean'),
    exactStorageContract.replace('Promise<boolean>', 'Promise<any>')]) {
    assert.throws(() => assertStorageContract(storageDeclaration(expression), 'fixture'), /exact null/);
  }
  const valid = storageDeclaration(exactStorageContract);
  assert.throws(() => assertStorageContract(valid + valid, 'fixture'), /one Storage/);
  assert.throws(() => assertStorageContract('export interface Storage {\n}\n', 'fixture'), /one optional/);
});

for (const [name, declaration] of [
  ['similarly named property', storageDeclaration(exactStorageContract).replace('compareAndSwapCachedItem', 'notcompareAndSwapCachedItem')],
  ['comment without a real method', `export interface Storage {\n /* compareAndSwapCachedItem?: ${exactStorageContract}; */\n}\n`],
  ['second required declaration', storageDeclaration(exactStorageContract)
    .replace('\n}', '\n compareAndSwapCachedItem: (key: any) => Promise<any>;\n}')],
]) {
  test(`${name} fails after the old optional-substring check passed`, () => {
    assert.equal([...declaration.matchAll(/compareAndSwapCachedItem\?\s*:\s*([^;]+);/g)].length, 1);
    assert.throws(() => assertStorageContract(declaration, 'fixture'), /one optional/);
  });
}

function storageFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gys-storage-adapter-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = Buffer.from('// public reviewed browser adapter fixture\n');
  const digest = crypto.createHash('sha256').update(data).digest('hex');
  const sourceFile = 'crates/breez-sdk/wasm/js/web-storage/index.js';
  const blob = crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  const manifest = {
    sourceFile, sourceSha256: digest,
    baselineSha256: '1c4562a4b62898422d4ed11324e9622a337429cc322e030ed502eccd2fc6fc0d',
    artifacts: { 'web/storage/index.js': digest, 'bundler/storage/index.js': digest },
  };
  const patch = Buffer.from(`diff --git a/${sourceFile} b/${sourceFile}\nindex 07ca313f7f18dc4ce1857ab9342664044126ac11..${blob} 100644\n`);
  for (const relative of Object.keys(manifest.artifacts)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  return { root, manifest, patch };
}

test('both installed browser adapters are bound to complete patch blob identities', (t) => {
  const { root, manifest, patch } = storageFixture(t);
  assert.equal(verifyStorageAdapters(root, manifest, patch), 2);
});

test('omitting one browser adapter cannot pass a listed-files-only manifest check', (t) => {
  const { root, manifest, patch } = storageFixture(t);
  delete manifest.artifacts['bundler/storage/index.js'];
  for (const [file, digest] of Object.entries(manifest.artifacts)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), digest);
  }
  assert.throws(() => verifyStorageAdapters(root, manifest, patch), /Exactly the two/);
});

test('changed adapter bytes are rejected even if their manifest hashes are changed together', (t) => {
  const { root, manifest, patch } = storageFixture(t);
  const changed = Buffer.from('// different executable adapter fixture\n');
  const digest = crypto.createHash('sha256').update(changed).digest('hex');
  for (const file of Object.keys(manifest.artifacts)) {
    fs.writeFileSync(path.join(root, file), changed);
    manifest.artifacts[file] = digest;
  }
  manifest.sourceSha256 = digest;
  assert.throws(() => verifyStorageAdapters(root, manifest, patch), /complete reviewed source patch/);
});

test('changed installed adapter without a matching manifest is rejected', (t) => {
  const { root, manifest, patch } = storageFixture(t);
  fs.appendFileSync(path.join(root, 'web/storage/index.js'), '// altered');
  assert.throws(() => verifyStorageAdapters(root, manifest, patch), /installed bytes/);
});

test('browser adapter file and parent-directory symlinks are rejected', (t) => {
  for (const directoryLink of [false, true]) {
    const { root, manifest, patch } = storageFixture(t);
    const original = path.join(root, directoryLink ? 'web/storage' : 'web/storage/index.js');
    const outside = path.join(root, directoryLink ? 'outside-directory' : 'outside.js');
    fs.renameSync(original, outside);
    fs.symlinkSync(outside, original);
    assert.throws(() => verifyStorageAdapters(root, manifest, patch), /symbolic link/);
  }
});

test('unreviewed adapter baseline, manifest inventory and patch identity are rejected', (t) => {
  const { root, manifest, patch } = storageFixture(t);
  for (const altered of [
    { ...manifest, baselineSha256: '0'.repeat(64) },
    { ...manifest, sourceFile: 'other.js' },
    { ...manifest, artifacts: { ...manifest.artifacts, '../outside.js': '0'.repeat(64) } },
  ]) assert.throws(() => verifyStorageAdapters(root, altered, patch));
  for (const altered of [Buffer.from(''), Buffer.concat([patch, patch]),
    Buffer.from(patch.toString().replace('07ca313f7f18dc4ce1857ab9342664044126ac11', '0'.repeat(40)))]) {
    assert.throws(() => verifyStorageAdapters(root, manifest, altered));
  }
});

test('ordinary SDK and binding exports pass the production-only guard', () => {
  assertProductionWasmExports([
    { name: 'breezsdk_observeIncomingLightning', kind: 'function' },
    { name: 'breezsdk_continueMatureDepositClaim', kind: 'function' },
    { name: '__wbindgen_malloc', kind: 'function' },
    { name: 'memory', kind: 'memory' },
  ], 'fixture');
});

test('required SDK methods cannot conceal additional WASM test harness exports', () => {
  const sdk = [
    { name: 'breezsdk_observeIncomingLightning', kind: 'function' },
    { name: 'breezsdk_continueMatureDepositClaim', kind: 'function' },
  ];
  for (const name of ['__wbgt__public_fixture::storage_cas_bridge_control',
    '__wbgtest_console_log', 'wasmbindgentestcontext_new']) {
    const exports = [...sdk, { name, kind: 'function' }];
    assert(exports.some(({ name }) => name === 'breezsdk_observeIncomingLightning'));
    assert(exports.some(({ name }) => name === 'breezsdk_continueMatureDepositClaim'));
    assert.throws(() => assertProductionWasmExports(exports, 'fixture'), /must not export test fixtures/);
  }
});
