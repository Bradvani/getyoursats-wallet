import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {OBSERVATION_PLAN} from '../../e2e/fixtures/settled-incoming-contract.ts';

export const digest = data => createHash('sha256').update(data).digest('hex');
export const ORIGINAL_RECEIPT_SHA256 = '0b9084e2a47420b379525f70faae4141d9240e3c18bd81254e8aa5f5d15ea27f';
const STORES = ['Default/Local Storage/leveldb', 'Default/IndexedDB/http_127.0.0.1_5183.indexeddb.leveldb'];

/** Content is streamed into a hash only. No profile values are decoded or logged. */
export async function fileHash(file) {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file, {flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW});
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest('hex');
}
export async function inventory(root) {
  const files = [];
  async function visit(relative) {
    const name = path.join(root, relative), stat = fs.lstatSync(name);
    assert(!stat.isSymbolicLink(), 'Profile inventory refuses symbolic links');
    if (stat.isDirectory()) {
      files.push({path: relative, kind: 'directory'});
      for (const child of fs.readdirSync(name).sort()) await visit(path.join(relative, child));
    } else {
      assert(stat.isFile(), 'Profile inventory refuses non-regular files');
      files.push({path: relative, kind: 'file', bytes: stat.size, sha256: await fileHash(name)});
    }
  }
  await visit('');
  return files;
}
export function inventorySummary(files) {
  return {sha256: digest(JSON.stringify(files)), files: files.filter(file => file.kind === 'file').length,
    bytes: files.reduce((sum, file) => sum + (file.bytes ?? 0), 0)};
}
export function validateOriginalRoot(root) {
  assert.equal(path.basename(root), 'profiles');
  assert.equal(fs.realpathSync(root), path.resolve(root), 'Original root must not traverse symbolic links');
  const previous = fs.readFileSync(path.join(path.dirname(root), 'disposable-spark-acceptance.json'));
  assert.equal(digest(previous), ORIGINAL_RECEIPT_SHA256, 'Require the exact original disposable receipt');
  for (const plan of OBSERVATION_PLAN) {
    const profile = path.join(root, plan.profile);
    assert(fs.lstatSync(profile).isDirectory());
    assert(!fs.existsSync(path.join(profile, 'SingletonLock')) && !fs.existsSync(path.join(profile, 'SingletonSocket')),
      'Original profile must be closed');
    for (const relative of STORES) {
      const source = path.join(profile, relative);
      assert(fs.lstatSync(source).isDirectory() && fs.realpathSync(source) === source, 'Required origin store must be a real directory');
    }
  }
}

/** Copy data stores only: no startup pages, preferences, cookies, service worker,
 * extension, session restore, cache or script files are launched from originals. */
export async function copyOriginStores(original, destination) {
  assert(path.isAbsolute(original) && path.isAbsolute(destination));
  assert(!destination.startsWith(original + path.sep) && destination !== original);
  fs.mkdirSync(destination, {mode: 0o700}); // exclusive: an old clone cannot be reused
  for (const plan of OBSERVATION_PLAN) {
    for (const relative of STORES) {
      const source = path.join(original, plan.profile, relative);
      const expected = await inventory(source);
      const target = path.join(destination, plan.profile, relative);
      fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
      fs.cpSync(source, target, {recursive: true, dereference: false, errorOnExist: true, force: false});
      assert.deepEqual(await inventory(target), expected, 'Origin store copy must be exact');
    }
  }
}
