import {lstat, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const RAMPNOW_RECEIVER_SOURCE_FILES = Object.freeze([
  'api/rampnow/webhook.js',
  'server/rampnow.mjs',
  'server/rampnowStore.mjs',
]);
const json = value => JSON.stringify(value, null, 2) + '\n';

/** A source deployment allowlist, never a repository walk or environment export. */
export async function packageRampnowReceiver({repoRoot = REPO_ROOT} = {}) {
  const root = await realpath(repoRoot);
  const files = [];
  for (const file of RAMPNOW_RECEIVER_SOURCE_FILES) {
    // Reject symlinks even in parent directories: an allowed filename must not
    // become a way to package an unrelated file or a local credential file.
    let source = root;
    const parts = file.split('/');
    for (let i = 0; i < parts.length; i++) {
      source = resolve(source, parts[i]);
      const stat = await lstat(source);
      if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
        throw new Error('Receiver source must be a regular file: ' + file);
      }
    }
    const data = new TextDecoder('utf-8', {fatal: true}).decode(await readFile(source));
    files.push({file, data, encoding: 'utf-8'});
  }
  files.push({file: 'package.json', data: json({
    name: 'gys-rampnow-sandbox-webhook', private: true, type: 'module', engines: {node: '24.x'},
  }), encoding: 'utf-8'});
  files.push({file: 'public/404.txt', data: 'Not found\n', encoding: 'utf-8'});
  files.push({file: 'vercel.json', data: json({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    buildCommand: '',
    installCommand: '',
    outputDirectory: 'public',
    functions: {'api/rampnow/webhook.js': {maxDuration: 30, includeFiles: 'server/{rampnow,rampnowStore}.mjs'}},
    routes: [
      {src: '^/api/rampnow/webhook$', dest: '/api/rampnow/webhook.js'},
      {src: '^/.*$', dest: '/404.txt', status: 404},
    ],
  }), encoding: 'utf-8'});
  return files.sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error('Usage: node scripts/package-rampnow-receiver.mjs /scratch/receiver-files.json');
  const output = resolve(args[0]);
  const withinRoot = relative(await realpath(REPO_ROOT), output);
  if (!withinRoot || (!withinRoot.startsWith('..' + sep) && !isAbsolute(withinRoot))) {
    throw new Error('Write the deployment payload to scratch outside the repository.');
  }
  const files = await packageRampnowReceiver();
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, json(files), {flag: 'wx', mode: 0o600});
  process.stdout.write('Wrote ' + files.length + ' receiver deployment files.\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    // Avoid exposing source contents, environment values or arbitrary paths.
    process.stderr.write('Receiver packaging failed. Supply a new scratch JSON path outside the repository and check the three source files.\n');
    process.exitCode = 1;
  });
}
