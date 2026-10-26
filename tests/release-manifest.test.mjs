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
    writeFile(join(root, '.gitignore'), 'dist/\nsite/release-manifest.json\n'),
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
    run(extraEnv = {}, args = []) {
      return execFileSync(process.execPath, ['scripts/write-release-manifest.mjs', ...args], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: {...process.env, VERCEL: '', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: '', GETYOURSATS_SOURCE_REVISION: '', ...extraEnv},
      });
    },
    async manifest(site = false) { return JSON.parse(await readFile(join(root, site ? 'site' : 'dist', 'release-manifest.json'), 'utf8')); },
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

async function siteFixture(t) {
  const app = await fixture(t);
  const repositoryConfig = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');
  const siteConfig = await readFile(new URL('../site/vercel.json', import.meta.url), 'utf8');
  await mkdir(join(app.root, 'site'));
  await Promise.all([
    writeFile(join(app.root, 'vercel.json'), repositoryConfig),
    writeFile(join(app.root, 'site/vercel.json'), siteConfig),
    writeFile(join(app.root, 'site/index.html'), '<html>Disposable public site</html>'),
  ]);
  app.git('add', 'vercel.json', 'site');
  app.git('-c', 'user.name=Disposable Test', '-c', 'user.email=disposable@example.invalid', 'commit', '-qm', 'Disposable site fixture');
  return { ...app, repositoryConfig, siteConfig };
}

const productionVercel = {VERCEL: '1', VERCEL_ENV: 'production'};
const projection = [{path: 'vercel.json', projectedFrom: 'site/vercel.json'}];

test('Vercel site builds restore the observed committed site-to-root projection and bind the site artifacts', async t => {
  const app = await siteFixture(t);
  await writeFile(join(app.root, 'vercel.json'), app.siteConfig);
  app.run(productionVercel, ['--site']);
  const manifest = await app.manifest(true);
  assert.equal(await readFile(join(app.root, 'vercel.json'), 'utf8'), app.repositoryConfig);
  assert.equal(await readFile(join(app.root, 'site/vercel.json'), 'utf8'), app.siteConfig);
  assert.equal(app.git('status', '--porcelain'), '');
  assert.equal(manifest.product, 'getyoursats-site');
  assert.equal(manifest.sourceRevision, app.git('rev-parse', 'HEAD'));
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.sdk, null);
  assert.deepEqual(manifest.restoredConfigFormatting, []);
  assert.deepEqual(manifest.restoredConfigProjections, projection);
  assert.deepEqual(manifest.artifacts.map(x => x.path).sort(), ['index.html', 'vercel.json']);
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(join(app.root, 'site', artifact.path));
    assert.equal(artifact.bytes, bytes.length);
    assert.equal(artifact.sha256, hash(bytes));
  }
});

test('site projection and same-path formatting are recorded separately before hashing', async t => {
  const app = await siteFixture(t);
  const reformatted = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(app.siteConfig)).reverse()));
  await Promise.all([
    writeFile(join(app.root, 'vercel.json'), reformatted),
    writeFile(join(app.root, 'site/vercel.json'), reformatted),
  ]);
  app.run(productionVercel, ['--site']);
  const manifest = await app.manifest(true);
  assert.deepEqual(manifest.restoredConfigFormatting, ['site/vercel.json']);
  assert.deepEqual(manifest.restoredConfigProjections, projection);
  assert.equal(manifest.artifacts.find(x => x.path === 'vercel.json').sha256, hash(app.siteConfig));
  assert.equal(app.git('status', '--porcelain'), '');
});

for (const [name, env, args] of [
  ['non-Vercel site builds', {VERCEL_ENV: 'production'}, ['--site']],
  ['non-exact Vercel flag', {VERCEL: 'true', VERCEL_ENV: 'production'}, ['--site']],
  ['wallet builds', productionVercel, []],
]) {
  test(`site projection is rejected for ${name}`, async t => {
    const app = await siteFixture(t);
    await writeFile(join(app.root, 'vercel.json'), app.siteConfig);
    assert.throws(() => app.run(env, args), /clean source/);
    assert.equal(await readFile(join(app.root, 'vercel.json'), 'utf8'), app.siteConfig);
  });
}

const changedSiteConfig = source => {
  const parsed = JSON.parse(source);
  parsed.headers[0].headers[0].value = 'changed-disposable-header';
  return JSON.stringify(parsed);
};

for (const [name, mutate] of [
  ['changed projected header', async app => writeFile(join(app.root, 'vercel.json'), changedSiteConfig(app.siteConfig))],
  ['added projected setting', async app => writeFile(join(app.root, 'vercel.json'), JSON.stringify({...JSON.parse(app.siteConfig), additionalSetting: true}))],
  ['changed selected site header', async app => writeFile(join(app.root, 'site/vercel.json'), changedSiteConfig(app.siteConfig))],
  ['matching but uncommitted root and site values', async app => Promise.all(['vercel.json', 'site/vercel.json'].map(path => writeFile(join(app.root, path), changedSiteConfig(app.siteConfig))))],
  ['invalid projected JSON', async app => writeFile(join(app.root, 'vercel.json'), '{invalid')],
  ['invalid selected site JSON', async app => writeFile(join(app.root, 'site/vercel.json'), '{invalid')],
  ['missing root configuration', async app => rm(join(app.root, 'vercel.json'))],
  ['missing site configuration', async app => rm(join(app.root, 'site/vercel.json'))],
  ['untracked selected site configuration', async app => app.git('rm', '--cached', 'site/vercel.json')],
]) {
  test(`site projection preserves the clean-source failure for ${name}`, async t => {
    const app = await siteFixture(t);
    await writeFile(join(app.root, 'vercel.json'), app.siteConfig);
    await mutate(app);
    assert.throws(() => app.run(productionVercel, ['--site']), /clean source/);
    assert.notEqual(app.git('status', '--porcelain'), '');
    await assert.rejects(app.manifest(true), {code: 'ENOENT'});
  });
}

for (const [name, mutate] of [
  ['changed tracked input', async app => writeFile(join(app.root, 'site/index.html'), '<html>Uncommitted source change</html>')],
  ['new untracked input', async app => writeFile(join(app.root, 'unexpected-input.js'), 'export const unexpected = true;\n')],
  ['staged configuration change', async app => app.git('add', 'vercel.json')],
]) {
  test(`valid site projection cannot conceal ${name}`, async t => {
    const app = await siteFixture(t);
    await writeFile(join(app.root, 'vercel.json'), app.siteConfig);
    await mutate(app);
    assert.throws(() => app.run(productionVercel, ['--site']), /clean source/);
    assert.equal(await readFile(join(app.root, 'vercel.json'), 'utf8'), app.repositoryConfig);
    assert.notEqual(app.git('status', '--porcelain'), '');
    await assert.rejects(app.manifest(true), {code: 'ENOENT'});
  });
}
