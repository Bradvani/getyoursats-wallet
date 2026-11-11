#!/usr/bin/env python3
"""Offline cross-check of the frozen 0007 CI artifact and preserved Git commit.

This script imports no SDK, executes no package or tests, opens no wallet/profile,
and makes no network request. Git is used only to read existing objects and to
apply validated patches in disposable directories, without an index or refs.
Recorded CI assertions are distinguished from independently checked file bytes.
"""
from __future__ import annotations

import argparse
import base64
import collections
import datetime
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile

SOURCE = '1298724dfe1d95b7a0a24f19be80e6e977cec011'
SOURCE_TREE = 'fbbf531f53d0dc5b8de1196a0ecac94431d29bfc'
SDK_SOURCE = '57c5b9e5f0749f97ffe5d93bce21c994f6957cf4'
SDK_TREE = '0fad9ee69476211ee47bafb413ba75639a22014f'
PATCH_SHA256 = 'e56dde90e545646dbce6e6f3218bb67c54084f13110fcbbafdb1eccc211b3eb7'
BASELINE_SHA256 = '4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026'
PACKAGE_VERSION = '0.1.0-getyoursats.recovery.3'
RUN_ID = 40473745510
PATCH_FILE = 'vendor/patches/0007-signer-storage-identity.patch'
ADAPTER_SOURCE = 'crates/breez-sdk/wasm/js/web-storage/index.js'
ARTIFACT_PATHS = {
    'package-lock.json', 'vendor/breeztech-breez-sdk-spark.tgz',
    'vendor/getyoursats-sdk-build.json',
}
LOG_NAMES = {
    'python-proof-guards.log', 'canonical-package-guards.log', 'node-proof-guards.log',
    'native-and-wasm-build.log', 'installed-wasm-tests.log', 'typescript.log',
    'browser-install.log', 'browser-storage-cas.log',
}
ZIP_FILES = LOG_NAMES | {
    'toolchain.txt', 'base.txt', 'artifact-manifest.json', 'sdk.patch',
    'browser-storage-cas.json',
    'compiled-unverified/breeztech-breez-sdk-spark.tgz',
    'compiled-unverified/getyoursats-sdk-build.json',
    'compiled-unverified/build-source.txt', 'compiled-unverified/sha256.txt',
}
NPM_IGNORE_PATHS = {f'{directory}/.gitignore' for directory in (
    'bundler', 'deno', 'examples/node', 'examples/ssr', 'examples/web',
    'itest', 'nodejs', 'ssr', 'web',
)}
EXTENSIONS = {
    'seed-compatible-external-signers-v1', 'observation-only-wallet-state-v1',
    'signed-recovery-v1', 'explicit-incoming-claim-v1', 'bounded-mature-deposit-claim-v1',
    'strict-transfer-evidence-v1', 'bounded-deposit-observation-v1',
    'incoming-lightning-observation-v1', 'external-exit-envelope-validation-v1',
    'unreceived-deposit-continuation-v1', 'recovery-signer-envelope-v1',
    'atomic-cache-reservation-v1', 'external-signer-storage-identity-v1',
}
NATIVE_GATES = [
    ('breez-sdk-spark', 'seed_factory', 3),
    ('breez-sdk-spark', 'sdk::observation::tests::', 8),
    ('breez-sdk-spark', 'signed_recovery_', 8),
    ('breez-sdk-spark', 'incoming_claim_', 16),
    ('breez-sdk-spark', 'mature_deposit_', 68),
    ('breez-sdk-spark', 'outspend_', 6),
    ('breez-sdk-spark', 'incoming_lightning_', 15),
    ('breez-sdk-spark', 'sdk::unilateral_exit::tests::', 46),
    ('breez-sdk-spark', 'signer::single_key_signer::tests::', 3),
    ('breez-sdk-spark', 'sdk::attempt_store::tests::', 8),
    ('breez-sdk-spark', 'cached_item_compare_and_swap_', 5),
    ('spark', 'strict_transfer_', 8),
    ('spark', 'strict_htlc_', 7),
    ('spark-wallet', 'wallet::deposit_observation::tests::', 10),
    ('spark-wallet', 'wallet::direct_observation::tests::', 6),
    ('spark-wallet', 'wallet::incoming_lightning::tests::', 4),
]
WASM_GATES = [
    ('breez-sdk-spark-wasm', 'storage_cas_bridge_', 6),
    ('breez-sdk-spark-wasm', 'storage_identity_', 10),
]
MAX_FILE = 128 * 1024 * 1024
MAX_CONTENT = 512 * 1024 * 1024


def check(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git_hash(kind, data):
    return hashlib.sha1(kind.encode() + b' ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        check(key not in result, 'Duplicate JSON field: ' + key)
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError('Non-finite JSON value: ' + value)


def decode_json(data):
    value = json.loads(data, object_pairs_hook=strict_object, parse_constant=reject_constant)
    check(isinstance(value, dict), 'Expected a JSON object')
    return value


def sha256_value(value):
    check(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value), 'Invalid SHA256 value')
    return value


def safe_path(value):
    check(isinstance(value, str) and value and '\\' not in value, 'Invalid relative path')
    check(not any(ord(c) < 32 for c in value), 'Control character in path')
    parts = value.split('/')
    check(all(p not in ('', '.', '..', '.git') for p in parts), 'Unsafe relative path: ' + value)
    check(not PurePosixPath(value).is_absolute(), 'Absolute path is forbidden')
    return value


def git(repo, *args):
    # Ignore inherited worktree/index/object-store overrides. Never fetch objects.
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update({'GIT_TERMINAL_PROMPT': '0', 'GIT_NO_LAZY_FETCH': '1', 'GIT_OPTIONAL_LOCKS': '0'})
    forbidden_transports = ['protocol.allow=never'] + [f'protocol.{name}.allow=never'
                           for name in ('file', 'http', 'https', 'git', 'ssh', 'ext')]
    return subprocess.check_output(
        ['git', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
         *(part for setting in forbidden_transports for part in ('-c', setting)), *args],
        cwd=repo, env=env, stderr=subprocess.PIPE, timeout=120,
    )


def git_tree_entries(repo, commit):
    entries = {}
    for row in git(repo, 'ls-tree', '-rz', '--full-tree', commit).split(b'\0'):
        if not row:
            continue
        metadata, path = row.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        name = safe_path(path.decode('utf-8'))
        check(name not in entries and kind in ('blob', 'commit'), 'Unexpected Git tree entry')
        check(mode in ('100644', '100755', '120000', '160000'), 'Unsupported Git entry mode')
        entries[name] = (mode, oid)
    return entries


def tree_id(entries):
    """Compute Git's tree ID from complete leaf entries, without writing objects."""
    root = {}
    for path, entry in entries.items():
        cursor = root
        parts = path.split('/')
        for part in parts[:-1]:
            cursor = cursor.setdefault(part, {})
            check(isinstance(cursor, dict), 'File/directory collision in tree')
        check(parts[-1] not in cursor, 'Duplicate tree leaf')
        cursor[parts[-1]] = entry

    def visit(node):
        data = bytearray()
        for name, entry in sorted(node.items(), key=lambda item:
                                  (item[0] + ('/' if isinstance(item[1], dict) else '')).encode()):
            mode, oid = ('40000', visit(entry)) if isinstance(entry, dict) else entry
            data.extend(mode.encode() + b' ' + name.encode() + b'\0' + bytes.fromhex(oid))
        return git_hash('tree', bytes(data))
    return visit(root)


def apply_in_disposable(repo, source, patch, expected_paths=None):
    text = patch.decode('utf-8')
    sections = re.split(r'(?=^diff --git )', text, flags=re.M)
    check(not sections[0].strip(), 'Unexpected patch preamble')
    rows = []
    for section in sections[1:]:
        match = re.match(r'diff --git a/([^\r\n]+) b/([^\r\n]+)\n', section)
        check(match and match[1] == match[2], 'Rename or ambiguous patch header')
        path = safe_path(match[1])
        index = re.search(r'^index ([0-9a-f]{40})\.\.([0-9a-f]{40})(?: (100644|100755))?$', section, re.M)
        check(index is not None and index[2] != '0' * 40, 'Missing full blob IDs or unsupported deletion')
        check(not re.search(r'^(?:old mode|new mode|deleted file mode|rename |copy )', section, re.M),
              'Unsupported patch metadata')
        addition = re.search(r'^new file mode (100644|100755)$', section, re.M)
        check((index[1] == '0' * 40) == bool(addition), 'Inconsistent added-file metadata')
        mode = addition[1] if addition else index[3]
        check(mode in ('100644', '100755'), 'Missing patch file mode')
        rows.append((path, index[1], index[2], mode))
    paths = [row[0] for row in rows]
    check(paths and len(paths) == len(set(paths)), 'Empty patch or duplicate path')
    if expected_paths is not None:
        check(set(paths) == expected_paths, 'Patch does not change exactly the three permitted artifacts')
    before = git_tree_entries(repo, source)
    check(tree_id(before) == git(repo, 'rev-parse', source + '^{tree}').decode().strip(),
          'Baseline Git tree inventory mismatch')
    after = dict(before)
    payloads = {}
    with tempfile.TemporaryDirectory(prefix='gys-sdk-0007-cross-check-') as temporary:
        root = Path(temporary)
        checkout = root / 'checkout'
        checkout.mkdir()
        patch_path = root / 'delta.patch'
        patch_path.write_bytes(patch)
        for path, old, _, mode in rows:
            if old == '0' * 40:
                check(path not in before, 'Added file already exists')
                continue
            check(before.get(path) == (mode, old), 'Patch baseline blob or mode mismatch: ' + path)
            data = git(repo, 'cat-file', 'blob', old)
            check(git_hash('blob', data) == old, 'Baseline blob bytes mismatch')
            destination = checkout / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(0o755 if mode == '100755' else 0o644)
        git(checkout, 'apply', '--check', str(patch_path))
        git(checkout, 'apply', str(patch_path))
        actual = set()
        for path in checkout.rglob('*'):
            check(not path.is_symlink(), 'Patch created a symbolic link')
            if path.is_dir():
                continue
            check(path.is_file(), 'Patch created a non-regular file')
            actual.add(path.relative_to(checkout).as_posix())
        check(actual == set(paths), 'Patch created unexpected files')
        for path, _, new, mode in rows:
            data = (checkout / path).read_bytes()
            check(git_hash('blob', data) == new, 'Reconstructed blob mismatch: ' + path)
            check(bool((checkout / path).stat().st_mode & 0o111) == (mode == '100755'),
                  'Reconstructed mode mismatch: ' + path)
            payloads[path] = data
            after[path] = (mode, new)
    changed = {p for p in set(before) | set(after) if before.get(p) != after.get(p)}
    check(changed == set(paths), 'Patch claims an unchanged or omitted path')
    return after, payloads


def read_zip(path, expected_digest, artifact_dir):
    check(path.is_file() and path.stat().st_size <= MAX_FILE, 'Missing or oversized artifact ZIP')
    data = path.read_bytes()
    check(digest(data) == expected_digest, 'Artifact ZIP SHA256 differs from supplied expected value')
    files, seen, total = {}, set(), 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        check(len(archive.infolist()) <= 30, 'Unexpected artifact member count')
        for info in archive.infolist():
            name = info.filename.rstrip('/') if info.is_dir() else info.filename
            safe_path(name)
            check(info.filename not in seen, 'Duplicate ZIP member')
            seen.add(info.filename)
            mode = (info.external_attr >> 16) & 0xffff
            check(not stat.S_ISLNK(mode), 'ZIP symlink is forbidden')
            check(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR), 'Special ZIP member')
            check(not (info.flag_bits & 1), 'Encrypted artifact member is unsupported')
            if info.is_dir():
                check(name == 'compiled-unverified', 'Unexpected ZIP directory')
                continue
            check(stat.S_IFMT(mode) in (0, stat.S_IFREG), 'Non-regular ZIP file')
            check(name in ZIP_FILES and info.file_size <= MAX_FILE, 'Unexpected or oversized artifact member')
            total += info.file_size
            check(total <= MAX_CONTENT, 'Artifact expands beyond the permitted bound')
            files[name] = archive.read(info)  # zipfile verifies CRC on complete reads.
            check(len(files[name]) == info.file_size, 'ZIP member size mismatch')
    check(set(files) == ZIP_FILES, 'Incomplete or unexpected uploaded evidence inventory')
    if artifact_dir is not None:
        actual = set()
        for path in artifact_dir.rglob('*'):
            check(not path.is_symlink(), 'Extracted evidence contains a symlink')
            if path.is_dir():
                continue
            check(path.is_file(), 'Extracted evidence contains a special file')
            relative = path.relative_to(artifact_dir).as_posix()
            check(relative in files and path.read_bytes() == files[relative], 'Extracted bytes differ from ZIP')
            actual.add(relative)
        check(actual == ZIP_FILES, 'Extracted evidence inventory differs from ZIP')
    return files


def package_inventory(data):
    hashes, sizes, retained, seen, directories = {}, {}, {}, set(), set()
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            check(len(seen) < 20000 and member.name not in seen, 'Duplicate or excessive package member')
            seen.add(member.name)
            name = member.name.rstrip('/') if member.isdir() else member.name
            safe_path(name)
            check(name == 'package' or name.startswith('package/'), 'Unexpected package root')
            check(member.isfile() or member.isdir(), 'Package symlinks and special files are forbidden')
            if name == 'package':
                check(member.isdir(), 'Package root is not a directory')
                continue
            relative = safe_path(name[len('package/'):])
            parent = PurePosixPath(relative).parent
            while str(parent) != '.':
                check(str(parent) not in hashes, 'Package parent is a regular file')
                directories.add(str(parent))
                parent = parent.parent
            if member.isdir():
                check(relative not in hashes, 'Package directory collides with a file')
                directories.add(relative)
                continue
            check(member.name.startswith('package/') and 0 <= member.size <= MAX_FILE, 'Invalid package member')
            total += member.size
            check(total <= MAX_CONTENT, 'Package expands beyond the permitted bound')
            check(relative not in hashes and relative not in directories, 'Duplicate or colliding package path')
            payload = archive.extractfile(member).read()
            check(len(payload) == member.size, 'Package member size mismatch')
            hashes[relative], sizes[relative] = digest(payload), len(payload)
            if relative in ('package.json', 'getyoursats-build.json'):
                check(len(payload) <= 1024 * 1024, 'Oversized package metadata')
                retained[relative] = payload
    check(set(retained) == {'package.json', 'getyoursats-build.json'}, 'Missing package metadata')
    return hashes, sizes, retained


def json_log_objects(text):
    decoder = json.JSONDecoder(object_pairs_hook=strict_object, parse_constant=reject_constant)
    objects, consumed_until = [], 0
    for match in re.finditer(r'^\{', text, re.M):
        if match.start() < consumed_until:
            continue
        value, end = decoder.raw_decode(text, match.start())
        check(isinstance(value, dict), 'Unexpected log JSON record')
        check(end == len(text) or text[end] in '\r\n', 'Unexpected text following log JSON')
        objects.append(value)
        consumed_until = end
    return objects


def inventory_digest(files):
    return digest(json.dumps(files, sort_keys=True, separators=(',', ':')).encode())


def verify_installed_records(log, files, embedded_bytes, sidecar, repo):
    records = json_log_objects(log)
    def single(name):
        values = [r for r in records if r.get('test') == name]
        check(len(values) == 1 and values[0].get('result') == 'PASS', 'Missing or failed receipt: ' + name)
        return values[0]
    canonical = single('canonical installed SDK archive/source preflight')
    namespace = single('installed external-signer storage identity')
    check(canonical.get('mode') == namespace.get('mode') == 'resolved installed package gate',
          'Installed verification used a diagnostic override')
    check(canonical.get('sdkImported') is False and canonical.get('walletOperations') is False,
          'Canonical preflight scope differs')
    renamed = dict(files)
    mappings = canonical.get('npmIgnoreRenames')
    check(isinstance(mappings, list) and len(mappings) <= 9, 'Invalid npm rename inventory')
    seen = set()
    for item in mappings:
        check(isinstance(item, dict) and set(item) == {'archivePath', 'installedPath', 'sha256'}, 'Malformed npm rename')
        original, replacement = item['archivePath'], item['installedPath']
        check(original in NPM_IGNORE_PATHS and original not in seen, 'Unreviewed or duplicate npm rename')
        check(replacement == original[:-len('.gitignore')] + '.npmignore', 'npm rename changes directory')
        check(original in files and replacement not in files, 'npm rename lacks a unique archive source')
        check(files[original] == sha256_value(item['sha256']), 'npm rename changes bytes')
        seen.add(original)
        del renamed[original]
        renamed[replacement] = item['sha256']
    check(mappings == sorted(mappings, key=lambda item: item['archivePath']), 'Noncanonical rename order')
    for record in (canonical, namespace):
        check(record.get('packageArchiveSha256') == sidecar['packageSha256'], 'Recorded archive hash mismatch')
        check(record.get('patchSha256') == PATCH_SHA256, 'Recorded source patch hash mismatch')
        check(record.get('archiveInventorySha256') == inventory_digest(files), 'Recorded archive inventory mismatch')
        check(record.get('packageInventorySha256') == inventory_digest(renamed), 'Recorded installed inventory mismatch')
        check(record.get('npmIgnoreRenames') == mappings, 'Receipts disagree on npm renames')
    check(canonical.get('files') == namespace.get('canonicalFileCount') == len(files), 'Recorded file count mismatch')
    check(namespace.get('packageVersion') == PACKAGE_VERSION and namespace.get('sdkSourceCommit') == SDK_SOURCE,
          'Namespace receipt package/source mismatch')
    check(namespace.get('installedManifestSha256') == digest(embedded_bytes), 'Namespace manifest hash mismatch')
    check(namespace.get('wasmSha256') == files['web/breez_sdk_spark_wasm_bg.wasm'], 'Namespace WASM hash mismatch')
    harness = git(repo, 'show', SOURCE + ':scripts/security/verify-signer-storage-identity.mjs')
    check(namespace.get('harnessSha256') == digest(harness), 'Namespace harness differs from frozen source')
    expected_counts = {'networkAttempts': 0, 'storageOpenAttempts': 0, 'signingOrOtherSignerCalls': 0,
                       'successfulPathCases': 18, 'constructorChecks': 58,
                       'identityFailureControls': 12, 'treeFactoryControls': 4}
    check(namespace.get('counts') == expected_counts, 'Namespace receipt control counts differ')
    api = single('installed observation/recovery API, generated correlation models and artifact integrity')
    check(api.get('generatedTargets') == api.get('productionWasmTargetsWithoutTestExports') == 4,
          'Recorded API verification omits a production binding')
    check(api.get('walletOperationsInvoked') is False, 'Recorded API verification invoked wallet operations')
    check(set(api.get('extensions', [])) == EXTENSIONS, 'Recorded API extensions differ')
    return {'canonical': canonical, 'namespace': namespace,
            'archiveInventorySha256': inventory_digest(files),
            'mappedInstalledInventorySha256': inventory_digest(renamed),
            'scope': 'Cross-check of recorded installed/runtime receipts; no installed package or SDK was executed here'}


def verify_browser(data, sidecar, sizes, repo):
    report = decode_json(data)
    ci = report['config']['metadata']['ci']
    check(ci['commitHash'] == SOURCE and ci['buildHref'].endswith('/' + str(RUN_ID)), 'Browser report source/run mismatch')
    check(report['errors'] == [], 'Browser report contains errors')
    check({k: report['stats'][k] for k in ('expected', 'skipped', 'unexpected', 'flaky')} ==
          {'expected': 27, 'skipped': 0, 'unexpected': 0, 'flaky': 0}, 'Browser totals differ')
    source = git(repo, 'show', SOURCE + ':e2e/tests/sdk-storage-cas.spec.ts').decode()
    titles = set(re.findall(r"^test\('([^']+)'", source, re.M))
    check(len(titles) == 9, 'Frozen browser test inventory differs')
    counts, seen, attestations = collections.Counter(), set(), {}
    def specs(suite):
        yield from suite.get('specs', [])
        for child in suite.get('suites', []):
            yield from specs(child)
    for suite in report['suites']:
        for spec in specs(suite):
            check(spec['ok'] is True and spec['title'] in titles, 'Unexpected or failed browser spec')
            for test in spec['tests']:
                engine = test['projectName']
                check(engine in ('chromium', 'firefox', 'webkit'), 'Unexpected browser engine')
                key = (engine, spec['title'])
                check(key not in seen, 'Duplicate browser case')
                seen.add(key)
                check(test['expectedStatus'] == 'passed' and test['status'] == 'expected', 'Non-passing browser expectation')
                check(len(test['results']) == 1, 'Browser case used retry or has no result')
                result = test['results'][0]
                check(result['status'] == 'passed' and result['retry'] == 0 and result['errors'] == [], 'Browser result failed')
                counts[engine] += 1
                for attachment in result.get('attachments', []):
                    if attachment['name'] != 'adapter-identity':
                        continue
                    check(engine not in attestations, 'Duplicate browser adapter attestation')
                    identity = decode_json(base64.b64decode(attachment['body'], validate=True))
                    check(identity == {'source': 'installed-sdk',
                          'sha256': sidecar['storageAdapters']['artifacts']['web/storage/index.js'],
                          'bytes': sizes['web/storage/index.js']}, 'Browser adapter differs from archive/source')
                    attestations[engine] = identity
    check(dict(counts) == {'chromium': 9, 'firefox': 9, 'webkit': 9}, 'Browser per-engine totals differ')
    check(set(attestations) == set(counts), 'Missing browser adapter attestation')
    return {'casesPassed': 27, 'byEngine': dict(counts), 'durationMs': report['stats']['duration'],
            'adapterAttestations': attestations, 'reportSha256': digest(data)}


def workflow_scope(args):
    if args.workflow_run_json is None and args.workflow_jobs_json is None:
        return {'runId': RUN_ID, 'overallConclusion': None, 'buildConclusion': None,
                'preserveConclusion': None, 'recordedWorkflowSucceeded': None,
                'statusSource': 'Not supplied; no network query; artifact matches do not imply passing CI'}
    check(args.workflow_run_json is not None and args.workflow_jobs_json is not None,
          'Supply both workflow run and jobs snapshots, or neither')
    run_bytes, jobs_bytes = args.workflow_run_json.read_bytes(), args.workflow_jobs_json.read_bytes()
    run, jobs = decode_json(run_bytes), decode_json(jobs_bytes)
    check(run['id'] == RUN_ID and run['head_sha'] == SOURCE, 'Workflow snapshot source/run mismatch')
    selected = {}
    for job in jobs['jobs']:
        check(job['run_id'] == RUN_ID and job['head_sha'] == SOURCE, 'Job snapshot source/run mismatch')
        if job['name'] in ('build', 'preserve'):
            check(job['name'] not in selected, 'Duplicate build/preserve job; supply one exact attempt')
            selected[job['name']] = job
    check(set(selected) == {'build', 'preserve'}, 'Workflow snapshot omits build/preserve job')
    passed = run['status'] == 'completed' and run['conclusion'] == 'success' and all(
        job['status'] == 'completed' and job['conclusion'] == 'success' for job in selected.values())
    return {'runId': RUN_ID, 'overallConclusion': run['conclusion'],
            'buildConclusion': selected['build']['conclusion'], 'preserveConclusion': selected['preserve']['conclusion'],
            'recordedWorkflowSucceeded': passed, 'runSnapshotSha256': digest(run_bytes),
            'jobsSnapshotSha256': digest(jobs_bytes),
            'statusSource': 'Operator-supplied GitHub JSON snapshots; no network query or independent authenticity verification'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path, help='Local app Git repository containing source and preserved commit objects')
    parser.add_argument('--sdk-repo', required=True, type=Path, help='Local SDK Git repository containing pinned upstream objects; its working tree is not used')
    parser.add_argument('--zip', required=True, type=Path, help='Downloaded GitHub artifact ZIP')
    parser.add_argument('--expected-zip-sha256', required=True, help='Expected ZIP digest supplied by the operator')
    parser.add_argument('--artifact-dir', type=Path, help='Optional previously extracted directory, checked byte-for-byte against ZIP')
    parser.add_argument('--preserved-commit', required=True, help='Full 40-character compiled-artifact bot commit, already available locally')
    parser.add_argument('--workflow-run-json', type=Path, help='Optional saved GitHub run response; requires jobs snapshot too')
    parser.add_argument('--workflow-jobs-json', type=Path, help='Optional saved GitHub jobs response for the exact run attempt')
    parser.add_argument('--output', required=True, type=Path, help='New output directory; existing paths are never overwritten')
    args = parser.parse_args()
    check(re.fullmatch(r'[0-9a-f]{40}', args.preserved_commit), 'Preserved commit must be a full SHA')
    expected_zip = sha256_value(args.expected_zip_sha256)
    check(not args.output.exists(), 'Output directory already exists; choose a new path')
    check(git(args.repo, 'rev-parse', SOURCE + '^{tree}').decode().strip() == SOURCE_TREE, 'Frozen app tree differs')
    check(git(args.repo, 'rev-parse', args.preserved_commit + '^{commit}').decode().strip() == args.preserved_commit,
          'Preserved commit object is unavailable or different')
    header = git(args.repo, 'cat-file', '-p', args.preserved_commit).decode().split('\n\n', 1)[0]
    check(re.findall(r'^parent ([0-9a-f]{40})$', header, re.M) == [SOURCE], 'Preserved commit is not an exact child of frozen source')
    check('author github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>' in header,
          'Unexpected preserved-commit author metadata')
    evidence = read_zip(args.zip, expected_zip, args.artifact_dir)
    check(evidence['base.txt'].decode().strip() == SOURCE, 'Uploaded preservation base differs')
    check(evidence['compiled-unverified/build-source.txt'].decode().strip() == SOURCE, 'Pre-verification package base differs')
    cumulative = git(args.repo, 'show', SOURCE + ':' + PATCH_FILE)
    check(digest(cumulative) == PATCH_SHA256, 'Frozen cumulative SDK source patch differs')
    sdk_entries, sdk_changed = apply_in_disposable(args.sdk_repo, SDK_SOURCE, cumulative)
    check(tree_id(sdk_entries) == SDK_TREE, 'Patched SDK tree differs from reviewed 0007 tree')
    app_entries, artifacts = apply_in_disposable(args.repo, SOURCE, evidence['sdk.patch'], ARTIFACT_PATHS)
    preserved_entries = git_tree_entries(args.repo, args.preserved_commit)
    check(app_entries == preserved_entries, 'Preserved commit differs from reconstructed three-artifact tree')
    check(tree_id(app_entries) == git(args.repo, 'rev-parse', args.preserved_commit + '^{tree}').decode().strip(),
          'Preserved Git tree bytes differ')
    for path, data in artifacts.items():
        check(data == git(args.repo, 'show', args.preserved_commit + ':' + path), 'Preserved artifact differs: ' + path)
    archive = artifacts['vendor/breeztech-breez-sdk-spark.tgz']
    manifest_bytes = artifacts['vendor/getyoursats-sdk-build.json']
    check(manifest_bytes == evidence['artifact-manifest.json'] == evidence['compiled-unverified/getyoursats-sdk-build.json'],
          'Uploaded, pre-verification, reconstructed and preserved manifests disagree')
    check(archive == evidence['compiled-unverified/breeztech-breez-sdk-spark.tgz'],
          'Pre-verification package differs from preserved package')
    checksum_lines = evidence['compiled-unverified/sha256.txt'].decode().splitlines()
    checksum_matches = [re.fullmatch(r'([0-9a-f]{64})  (vendor/[^\r\n]+)', line) for line in checksum_lines]
    check(len(checksum_matches) == 2 and all(checksum_matches), 'Malformed pre-verification checksum record')
    checksum_rows = [match.groups() for match in checksum_matches]
    check(dict((p, h) for h, p in checksum_rows) == {
        'vendor/breeztech-breez-sdk-spark.tgz': digest(archive),
        'vendor/getyoursats-sdk-build.json': digest(manifest_bytes)}, 'Pre-verification checksum record differs')
    sidecar = decode_json(manifest_bytes)
    check(type(sidecar.get('schema')) is int and sidecar['schema'] == 1, 'Unexpected manifest schema')
    check(sidecar['sdkSourceCommit'] == SDK_SOURCE and sidecar['patchSha256'] == PATCH_SHA256, 'Manifest source differs')
    check(sidecar['packageSha256'] == digest(archive) and sidecar['baselinePackageSha256'] == BASELINE_SHA256,
          'Manifest package/baseline digest differs')
    check(sidecar['rustToolchain'] == '1.95.0' and sidecar['wasmBindgenVersion'] == '0.2.120', 'Manifest toolchain differs')
    check(sidecar['cargoProfile'] == 'release (upstream profile, wasm-opt disabled)', 'Manifest profile differs')
    check(len(sidecar['extensions']) == len(EXTENSIONS) and set(sidecar['extensions']) == EXTENSIONS, 'Manifest extension set differs')
    sha256_value(sidecar['rawCompiledWasmSha256'])  # Recorded, not a supplied raw compiler artifact.
    cargo_lock = sdk_changed.get('Cargo.lock')
    if cargo_lock is None:
        cargo_lock = git(args.sdk_repo, 'show', SDK_SOURCE + ':Cargo.lock')
    check(sidecar['cargoLockSha256'] == digest(cargo_lock), 'SDK Cargo lock digest differs')
    files, sizes, metadata_bytes = package_inventory(archive)
    embedded = decode_json(metadata_bytes['getyoursats-build.json'])
    check(embedded == {k: v for k, v in sidecar.items() if k != 'packageSha256'}, 'Embedded manifest differs')
    check(metadata_bytes['getyoursats-build.json'] == (json.dumps(embedded, indent=2) + '\n').encode(), 'Embedded manifest serialization differs')
    metadata = decode_json(metadata_bytes['package.json'])
    check(metadata['name'] == '@breeztech/breez-sdk-spark' and metadata['version'] == PACKAGE_VERSION, 'Package name/version differs')
    generated_paths = {f'{target}/breez_sdk_spark_wasm{suffix}' for target in ('web', 'nodejs', 'bundler', 'deno')
                       for suffix in ('.js', '.d.ts', '_bg.wasm', '_bg.wasm.d.ts')} | {'bundler/breez_sdk_spark_wasm_bg.js'}
    check(set(sidecar['generatedArtifacts']) == generated_paths, 'Generated binding inventory differs')
    for path, expected in sidecar['generatedArtifacts'].items():
        check(files.get(safe_path(path)) == sha256_value(expected), 'Generated artifact hash differs: ' + path)
    check(len({files[f'{target}/breez_sdk_spark_wasm_bg.wasm'] for target in ('web', 'nodejs', 'bundler', 'deno')}) == 1,
          'The four target WASM payloads differ')
    adapter = sdk_changed.get(ADAPTER_SOURCE)
    check(adapter is not None, 'Cumulative SDK patch omits the reviewed storage adapter')
    expected_adapters = {'sourceFile': ADAPTER_SOURCE, 'sourceSha256': digest(adapter),
                         'baselineSha256': digest(git(args.sdk_repo, 'show', SDK_SOURCE + ':' + ADAPTER_SOURCE)),
                         'artifacts': {p: digest(adapter) for p in ('web/storage/index.js', 'bundler/storage/index.js')}}
    check(sidecar['storageAdapters'] == expected_adapters, 'Storage adapter manifest differs from reviewed source')
    for path, expected in expected_adapters['artifacts'].items():
        check(files.get(path) == expected and sizes[path] == len(adapter), 'Packaged browser adapter differs')
    lock = decode_json(artifacts['package-lock.json'])['packages']['node_modules/@breeztech/breez-sdk-spark']
    check(lock['version'] == PACKAGE_VERSION and lock['resolved'] == 'file:vendor/breeztech-breez-sdk-spark.tgz', 'SDK lock version/path differs')
    check(lock['integrity'] == 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode(), 'SDK lock integrity differs')
    build_log = evidence['native-and-wasm-build.log'].decode()
    build_records = json_log_objects(build_log)
    gates = [r for r in build_records if 'rustGate' in r]
    check(all(set(r) == {'rustGate', 'crate', 'passed'} and type(r['passed']) is int for r in gates), 'Malformed Rust gate record')
    check([(r['crate'], r['rustGate'], r['passed']) for r in gates] == NATIVE_GATES + WASM_GATES, 'Rust gate inventory/count differs')
    summaries = re.findall(r'^test result: ok\. (\d+) passed; (\d+) failed;', build_log, re.M)
    check([(int(p), int(f)) for p, f in summaries] == [(r['passed'], 0) for r in gates], 'Raw test summaries differ from gate records')
    build_manifests = [r for r in build_records if 'rawCompiledWasmSha256' in r]
    check(build_manifests == [sidecar], 'Build log manifest differs from preserved manifest')
    toolchain = evidence['toolchain.txt'].decode()
    check(re.search(r'^rustc 1\.95\.0(?: |$)', toolchain, re.M) and
          re.search(r'^wasm-bindgen 0\.2\.120$', toolchain, re.M), 'Recorded toolchain differs')
    installed = verify_installed_records(evidence['installed-wasm-tests.log'].decode(), files,
                                        metadata_bytes['getyoursats-build.json'], sidecar, args.repo)
    browser = verify_browser(evidence['browser-storage-cas.json'], sidecar, sizes, args.repo)
    check(evidence['typescript.log'] == b'', 'TypeScript log is not the expected empty success output')
    scope = workflow_scope(args)
    receipt = {
        'schema': 1, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'result': 'OFFLINE ARTIFACT CROSS-CHECK PASSED', 'releaseApproved': False,
        'verifierSha256': digest(Path(__file__).read_bytes()),
        'workflow': {**scope, 'url': f'https://github.com/Bradvani/getyoursats-wallet/actions/runs/{RUN_ID}'},
        'source': {'commit': SOURCE, 'tree': SOURCE_TREE, 'sdkCommit': SDK_SOURCE,
                   'sdkPatchedTree': SDK_TREE, 'sdkPatchSha256': PATCH_SHA256,
                   'sdkChangedPaths': len(sdk_changed)},
        'preservation': {'commit': args.preserved_commit, 'parent': SOURCE, 'tree': tree_id(app_entries),
                         'exactChangedPaths': sorted(ARTIFACT_PATHS),
                         'matchesUploadedPatchAndCompiledUnverifiedCopy': True},
        'inputEvidence': {'zipSha256': expected_zip, 'regularFiles': len(evidence),
                          'extractedCopyChecked': args.artifact_dir is not None,
                          'files': {p: {'bytes': len(data), 'sha256': digest(data)} for p, data in sorted(evidence.items())}},
        'package': {'version': PACKAGE_VERSION, 'archiveSha256': digest(archive), 'bytes': len(archive),
                    'manifestSha256': digest(manifest_bytes), 'regularFiles': len(files),
                    'generatedArtifactsVerified': len(generated_paths), 'storageAdaptersVerified': 2,
                    'webWasmSha256': files['web/breez_sdk_spark_wasm_bg.wasm'],
                    'embeddedManifestMatches': True, 'lockSha512Matches': True},
        'recordedResults': {'nativeGateGroups': 16, 'nativeCasesPassed': 221,
                            'wasmGateGroups': 2, 'wasmStorageCasPassed': 6, 'wasmIdentityPassed': 10,
                            'rustGates': gates, 'browser': browser, 'installed': installed,
                            'typescriptLogEmpty': True},
        'limits': [
            'This script checks supplied artifacts, Git objects and recorded CI assertions; it is not a fresh compilation or runtime test',
            'No SDK/package import, test/browser/provider/profile operation or network request was performed',
            'No Git refs, index or object database were changed; patch application used disposable directories',
            'Overall workflow success is not inferred from matching artifacts or a bot-authored commit',
            'Optional GitHub status snapshots are operator-supplied evidence, not independently authenticated by this offline script',
            'Installed inventory and namespace assertions are matched to archive/source hashes; the original installed filesystem is not available here',
            'The raw compiler WASM hash is a recorded manifest value; only packaged bindings are supplied for independent byte checks',
            'Existing eight-hex-character storage names do not prove full-key ownership or safe legacy migration',
            'No production, funded/device/provider acceptance or independent security approval is asserted',
        ],
    }
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    (args.output / 'archive-inventory.json').write_text(json.dumps(files, indent=2, sort_keys=True) + '\n')
    conclusion = scope['overallConclusion'] if scope['overallConclusion'] is not None else 'not supplied'
    preserve = scope['preserveConclusion'] if scope['preserveConclusion'] is not None else 'not supplied'
    narrative = f'''# SDK 0007 offline artifact cross-check

**Internal artifact cross-check passed. Release approval: no.**

The supplied [run {RUN_ID}](https://github.com/Bradvani/getyoursats-wallet/actions/runs/{RUN_ID}) status is `{conclusion}`; its preserve-job status is `{preserve}`. Matching package bytes and a preserved commit do not independently establish successful CI.

Application source `{SOURCE}` and reviewed SDK tree `{SDK_TREE}` were reproduced from existing Git objects and the pinned cumulative patch. Preserved commit `{args.preserved_commit}` is an exact child of that application source and changes only the package archive, build manifest and dependency lock. The reconstructed files, uploaded patch and `compiled-unverified` copy agree byte-for-byte. The package SHA256 is `{digest(archive)}`; all 17 generated artifact hashes, both source-bound browser adapters, embedded manifest and lockfile SHA512 agree.

The recorded log contains 221 passing native cases across 16 groups, six actual WASM storage CAS cases and ten actual WASM identity cases. The browser report records nine passes in each of Chromium, Firefox and WebKit, without retries, skips, failures or flakes. Installed preflight and namespace receipts agree with the archive inventory, explicitly reported npm ignore-file renames and frozen verifier source. These are cross-checks of recorded CI assertions; this script did not rerun those checks or inspect the original installed filesystem.

No SDK was imported, wallet/profile accessed, provider contacted, package executed, or Git ref changed. Legacy storage ownership, execution/recovery contracts, physical-device checks and independent review remain separate release boundaries. The complete values and limitations are in [receipt.json](receipt.json).
'''
    (args.output / 'receipt.md').write_text(narrative)
    print(json.dumps({'receipt': str(args.output / 'receipt.json'),
                      'receiptSha256': digest((args.output / 'receipt.json').read_bytes()),
                      'packageSha256': digest(archive), 'preservedCommit': args.preserved_commit,
                      'recordedNative': 221, 'recordedWasmCas': 6, 'recordedWasmIdentity': 10,
                      'recordedBrowserByEngine': browser['byEngine'], 'workflowStatus': scope,
                      'releaseApproved': False}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, zipfile.BadZipFile, tarfile.TarError) as error:
        print(f'Offline successor cross-check failed: {error}', file=sys.stderr)
        raise SystemExit(1)
