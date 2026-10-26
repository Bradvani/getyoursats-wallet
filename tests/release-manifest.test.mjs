import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const source = await readFile(new URL('../scripts/write-release-manifest.mjs', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, withGit = true) {
  const root = await mkdtemp(join(tmpdir(), 'gys-release-policy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const dir of ['scripts', 'public', 'vendor', 'dist/assets']) await mkdir(join(root, dir), {recursive: true});
  await Promise.all([
    writeFile(join(root, 'scripts/write-release-manifest.mjs'), source),
    writeFile(join(root, 'public/sw.js'), workerSource),
    writeFile(join(root, 'vendor/SOURCE_COMMIT'), 'a'.repeat(40) + '\n'),
    writeFile(join(root, 'vendor/breeztech-breez-sdk-spark.tgz'), 'disposable package fixture'),
    writeFile(join(root, 'package-lock.json'), '{"name":"disposable-fixture","lockfileVersion":3}\n'),
    writeFile(join(root, '.gitignore'), 'dist/\n'),
    writeFile(join(root, 'dist/index.html'), '<html><script type="module" src="/assets/entry-12345678.js"></script></html>'),
    writeFile(join(root, 'dist/assets/entry-12345678.js'), 'export const fixture = true;\n'),
    writeFile(join(root, 'dist/.private-fixture'), 'excluded disposable metadata'),
  ]);
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  if (withGit) {
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=Disposable Test', '-c', 'user.email=disposable@example.invalid', 'commit', '-qm', 'Disposable release fixture');
  }
  return {
    root,
    git,
    run(extraEnv = {}) {
      return execFileSync(process.execPath, ['scripts/write-release-manifest.mjs'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: {...process.env, VERCEL: '', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: '', GETYOURSATS_SOURCE_REVISION: '', ...extraEnv},
      });
    },
    async manifest() { return JSON.parse(await readFile(join(root, 'dist/release-manifest.json'), 'utf8')); },
  };
}

test('manifest binds every emitted asset and installed package to the source commit', async t => {
  const app = await fixture(t);
  app.run();
  const manifest = await app.manifest();
  assert.equal(manifest.sourceRevision, app.git('rev-parse', 'HEAD'));
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.sdk.sourceRevision, 'a'.repeat(40));
  assert.equal(manifest.sdk.packageSha256, hash(await readFile(join(app.root, 'vendor/breeztech-breez-sdk-spark.tgz'))));
  assert.equal(manifest.dependencyLockSha256, hash(await readFile(join(app.root, 'package-lock.json'))));
  assert.deepEqual(manifest.artifacts.map(x => x.path).sort(), ['assets/entry-12345678.js', 'index.html', 'sw.js']);
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(join(app.root, 'dist', artifact.path));
    assert.equal(artifact.bytes, bytes.length);
    assert.equal(artifact.sha256, hash(bytes));
  }
  const worker = await readFile(join(app.root, 'dist/sw.js'), 'utf8');
  assert.ok(worker.includes(manifest.releaseId));
  assert.ok(!worker.includes('__GETYOURSATS_RELEASE__'));
});

test('release ID is deterministic and changes when worker policy changes', async t => {
  const app = await fixture(t);
  app.run();
  const first = await app.manifest();
  app.run();
  assert.equal((await app.manifest()).releaseId, first.releaseId);
  await writeFile(join(app.root, 'public/sw.js'), workerSource + '\n// Disposable policy revision.\n');
  app.run();
  assert.notEqual((await app.manifest()).releaseId, first.releaseId);
});

test('production provenance rejects mismatched and missing revisions', async t => {
  const app = await fixture(t);
  assert.throws(() => app.run({VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40)}), /does not match checkout/);
  assert.throws(() => app.run({VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'not-a-sha'}), /Invalid release source revision/);
  const noGit = await fixture(t, false);
  assert.throws(() => noGit.run({VERCEL_ENV: 'production'}), /requires a source revision/);
});

test('untracked build inputs cannot be represented as a clean production source', async t => {
  const app = await fixture(t);
  await writeFile(join(app.root, 'untracked-input.js'), 'export const additionalBuildInput = true;\n');
  app.run();
  assert.equal((await app.manifest()).sourceDirty, true);
  assert.throws(() => app.run({VERCEL_ENV: 'production'}), /dirty|clean|uncommitted/i);
});

test('invalid SDK provenance and missing worker placeholder fail the build', async t => {
  const app = await fixture(t);
  await writeFile(join(app.root, 'vendor/SOURCE_COMMIT'), 'invalid');
  assert.throws(() => app.run(), /SDK.*revision|SDK.*commit|source.*SHA/i);
  await writeFile(join(app.root, 'vendor/SOURCE_COMMIT'), 'a'.repeat(40) + '\n');
  await writeFile(join(app.root, 'public/sw.js'), workerSource.replace('__GETYOURSATS_RELEASE__', 'hardcoded-cache'));
  assert.throws(() => app.run(), /placeholder|release.*token/i);
});

test('Vercel-only configuration formatting is restored without accepting changed settings', async t => {
  const app = await fixture(t);
  const original = '{\n  "headers": [{"source": "/(.*)", "headers": [{"key": "X-Frame-Options", "value": "DENY"}]}],\n  "installCommand": "npm ci"\n}\n';
  await writeFile(join(app.root, 'vercel.json'), original);
  app.git('add', 'vercel.json');
  app.git('-c', 'user.name=Disposable Test', '-c', 'user.email=disposable@example.invalid', 'commit', '-qm', 'Disposable hosting fixture');
  const parsed = JSON.parse(original);
  await writeFile(join(app.root, 'vercel.json'), JSON.stringify({installCommand: parsed.installCommand, headers: parsed.headers}));
  assert.throws(() => app.run({VERCEL_ENV: 'production'}), /clean source/);
  app.run({VERCEL: '1', VERCEL_ENV: 'production'});
  assert.equal(await readFile(join(app.root, 'vercel.json'), 'utf8'), original);
  assert.equal((await app.manifest()).sourceDirty, false);
  assert.deepEqual((await app.manifest()).restoredConfigFormatting, ['vercel.json']);

  parsed.headers[0].headers[0].value = 'SAMEORIGIN';
  const changed = JSON.stringify(parsed);
  await writeFile(join(app.root, 'vercel.json'), changed);
  assert.throws(() => app.run({VERCEL: '1', VERCEL_ENV: 'production'}), /clean source/);
  assert.equal(await readFile(join(app.root, 'vercel.json'), 'utf8'), changed);
});
