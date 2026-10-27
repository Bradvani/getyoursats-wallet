/** Full offline package/source binding. Importing this helper never imports the SDK. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

export function verifyCanonicalInstalledSdk(options = {}) {
  assert(options !== null && typeof options === 'object' && !Array.isArray(options), 'Preflight options must be an object');
  assert.deepEqual(Object.keys(options).filter((key) => key !== 'diagnosticPackageRoot'), [],
    'Canonical repository authority cannot be overridden');
  const diagnostic = Object.hasOwn(options, 'diagnosticPackageRoot');
  let packageRoot;
  if (diagnostic) {
    assert(typeof options.diagnosticPackageRoot === 'string' && path.isAbsolute(options.diagnosticPackageRoot),
      'An explicit diagnostic copy must have an absolute package path');
    packageRoot = options.diagnosticPackageRoot;
  } else {
    assert(!Object.hasOwn(process.env, 'GYS_SDK_PACKAGE_ROOT'),
      'GYS_SDK_PACKAGE_ROOT requires an explicitly labeled diagnostic caller');
    packageRoot = path.join(repositoryRoot, 'node_modules/@breeztech/breez-sdk-spark');
    const entry = require.resolve('@breeztech/breez-sdk-spark'); // Resolution only; no SDK code executes.
    const relative = path.relative(packageRoot, entry);
    assert(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`),
      'The installed SDK must resolve inside this repository package directory');
  }
  const result = spawnSync('python3', ['-I', '-B', fileURLToPath(new URL('./verify-canonical-installed-sdk.py', import.meta.url)),
    repositoryRoot, packageRoot], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.trim() || 'Canonical installed SDK preflight failed');
  const verified = JSON.parse(result.stdout);
  assert(Number.isSafeInteger(verified.files) && verified.files > 0, 'A complete nonempty SDK inventory was verified');
  return { ...verified, mode: diagnostic ? 'explicit canonical diagnostic copy' : 'resolved installed package gate' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 2, 'The canonical installed-package CLI accepts no overrides');
  const result = verifyCanonicalInstalledSdk();
  console.log(JSON.stringify({ test: 'canonical installed SDK archive/source preflight', result: 'PASS',
    mode: result.mode, files: result.files, packageArchiveSha256: result.packageArchiveSha256,
    patchSha256: result.patchSha256, packageInventorySha256: result.packageInventorySha256,
    archiveInventorySha256: result.archiveInventorySha256,
    npmIgnoreRenames: result.npmIgnoreRenames,
    sdkImported: false, walletOperations: false }, null, 2));
}
