import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {packageRampnowReceiver, RAMPNOW_RECEIVER_SOURCE_FILES} from '../scripts/package-rampnow-receiver.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/package-rampnow-receiver.mjs', import.meta.url));
async function scratch(t) {
  const path = await mkdtemp(join(tmpdir(), 'rampnow-receiver-'));
  t.after(() => rm(path, {recursive: true, force: true}));
  return path;
}
async function fixture(t) {
  const root = await scratch(t);
  for (const file of RAMPNOW_RECEIVER_SOURCE_FILES) {
    await mkdir(dirname(join(root, file)), {recursive: true});
    await writeFile(join(root, file), '// ' + file + '\nexport const marker = "£";\n');
  }
  return root;
}

test('receiver package is deterministic and excludes repository config, wallet files and secrets', async t => {
  const repoRoot = await fixture(t);
  for (const file of ['.env', 'package.json', 'vercel.json', 'index.html', 'api/wallet.js']) {
    await writeFile(join(repoRoot, file), 'do-not-package-local-secret');
  }
  const files = await packageRampnowReceiver({repoRoot});
  assert.deepEqual(files, await packageRampnowReceiver({repoRoot}));
  assert.deepEqual(files.map(entry => entry.file), [
    'api/rampnow/webhook.js', 'package.json', 'public/404.txt', 'server/rampnow.mjs', 'server/rampnowStore.mjs', 'vercel.json',
  ]);
  for (const entry of files) {
    assert.deepEqual(Object.keys(entry), ['file', 'data', 'encoding']);
    assert.equal(entry.encoding, 'utf-8');
    assert.equal(entry.data.includes('do-not-package-local-secret'), false);
    if (RAMPNOW_RECEIVER_SOURCE_FILES.includes(entry.file)) {
      assert.equal(entry.data, await readFile(join(repoRoot, entry.file), 'utf8'));
    }
  }
  const pkg = JSON.parse(files.find(entry => entry.file === 'package.json').data);
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.engines, {node: '24.x'});
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts, undefined);
  const config = JSON.parse(files.find(entry => entry.file === 'vercel.json').data);
  assert.deepEqual(Object.keys(config.functions), ['api/rampnow/webhook.js']);
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, '');
  assert.equal(config.installCommand, '');
  assert.equal(config.outputDirectory, 'public');
  assert.deepEqual(files.filter(entry => entry.file.startsWith('public/')),
    [{file: 'public/404.txt', data: 'Not found\n', encoding: 'utf-8'}]);
  const routeFor = path => config.routes.find(route => new RegExp(route.src, 'i').test(path));
  assert.equal(routeFor('/api/rampnow/webhook').dest, '/api/rampnow/webhook.js');
  for (const path of ['/', '/package.json', '/server/rampnow.mjs', '/api/wallet', '/api/rampnow/webhook.js', '/api/rampnow/webhook/extra']) {
    assert.equal(routeFor(path).status, 404);
    assert.equal(routeFor(path).dest, '/404.txt');
    const responseFile = config.outputDirectory + routeFor(path).dest;
    assert.equal(files.find(entry => entry.file === responseFile).data, 'Not found\n');
  }
});

test('missing files and symlinks fail closed instead of including unrelated data', async t => {
  const repoRoot = await fixture(t);
  const target = join(repoRoot, 'server/rampnow.mjs');
  await rm(target);
  await assert.rejects(packageRampnowReceiver({repoRoot}), {code: 'ENOENT'});
  const secret = join(repoRoot, '.env');
  await writeFile(secret, 'private-test-value');
  await symlink(secret, target);
  await assert.rejects(packageRampnowReceiver({repoRoot}), /regular file/);
  await rm(join(repoRoot, 'server'), {recursive: true});
  const other = await scratch(t);
  await symlink(other, join(repoRoot, 'server'));
  await assert.rejects(packageRampnowReceiver({repoRoot}), /regular file/);
});

test('packaged real handler imports without dependencies and preserves method handling', async t => {
  const root = await scratch(t);
  for (const {file, data} of await packageRampnowReceiver()) {
    await mkdir(dirname(join(root, file)), {recursive: true});
    await writeFile(join(root, file), data);
  }
  const {default: handler} = await import(pathToFileURL(join(root, 'api/rampnow/webhook.js')).href);
  const res = {headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; }};
  await handler({method: 'GET'}, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
  assert.deepEqual(JSON.parse(res.body), {code: 'METHOD_NOT_ALLOWED'});
});

test('CLI writes only the files array and never serializes its environment', async t => {
  const root = await scratch(t);
  const output = join(root, 'receiver-files.json');
  const {stdout, stderr} = await exec(process.execPath, [script, output], {
    env: {...process.env, RAMPNOW_API_SECRET: 'environment-canary-never-package'},
  });
  const raw = await readFile(output, 'utf8');
  assert.deepEqual(JSON.parse(raw), await packageRampnowReceiver());
  assert.equal((raw + stdout + stderr).includes('environment-canary-never-package'), false);
  assert.equal(stdout, 'Wrote 6 receiver deployment files.\n');
  assert.equal(stderr, '');
  await assert.rejects(exec(process.execPath, [script, output]));
  assert.equal(await readFile(output, 'utf8'), raw);
});
