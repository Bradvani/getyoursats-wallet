import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const site = process.argv.includes('--site');
const output = resolve(root, site ? 'site' : 'dist');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => readFile(resolve(root, path));
function git(...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'release-manifest.json') continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await files(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}
const artifactFiles = [];
for (const path of await files(output)) {
  if (relative(output, path) === 'sw.js') continue;
  const bytes = await readFile(path);
  artifactFiles.push({ path: relative(output, path), bytes: bytes.length, sha256: sha256(bytes) });
}
const workerTemplate = site ? '' : (await read('public/sw.js')).toString();
if (!site && workerTemplate.split('__GETYOURSATS_RELEASE__').length !== 2) throw new Error('Invalid worker release placeholder');
const releaseId = sha256(JSON.stringify(artifactFiles) + workerTemplate).slice(0, 20);
if (!site) {
  const worker = workerTemplate.replace('__GETYOURSATS_RELEASE__', releaseId);
  await writeFile(resolve(output, 'sw.js'), worker);
  artifactFiles.push({ path: 'sw.js', bytes: Buffer.byteLength(worker), sha256: sha256(worker) });
}
const localRevision = git('rev-parse', 'HEAD');
const suppliedRevision = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GETYOURSATS_SOURCE_REVISION;
if (suppliedRevision && !/^[0-9a-f]{40}$/.test(suppliedRevision)) throw new Error('Invalid release source revision');
if (suppliedRevision && localRevision && suppliedRevision !== localRevision) throw new Error('Release source does not match checkout');
const revision = suppliedRevision || localRevision;
if (process.env.VERCEL_ENV === 'production' && !revision) throw new Error('A production build requires a source revision');
const sourceStatus = localRevision ? git('status', '--porcelain', '--untracked-files=normal') : null;
if (process.env.VERCEL_ENV === 'production' && localRevision && (sourceStatus === null || sourceStatus)) {
  throw new Error('A production build requires a clean source checkout');
}
const sdkRevision = site ? null : (await read('vendor/SOURCE_COMMIT')).toString().trim();
if (!site && !/^[0-9a-f]{40}$/.test(sdkRevision)) throw new Error('Invalid SDK source revision');
const manifest = {
  schemaVersion: 1,
  product: site ? 'getyoursats-site' : 'getyoursats-wallet',
  releaseId,
  sourceRevision: revision,
  sourceDirty: sourceStatus === null ? null : Boolean(sourceStatus),
  sdk: site ? null : {
    sourceRevision: sdkRevision,
    packageSha256: sha256(await read('vendor/breeztech-breez-sdk-spark.tgz')),
  },
  dependencyLockSha256: sha256(await read('package-lock.json')),
  nodeVersion: process.version,
  artifacts: artifactFiles,
};
await writeFile(resolve(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${manifest.product} release ${releaseId}: ${revision || 'uncommitted source'}`);
