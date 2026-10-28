#!/usr/bin/env python3
"""Bind a complete installed SDK snapshot to this checkout's canonical artifact.

This performs no extraction, SDK imports, compilation, wallet access or network
access. The authority is the repository archive, its separate manifest, and the
selected cumulative source patch. It does not certify the producer or protect
against concurrent modification by another process after verification.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile


PATCH_FILE = 'vendor/patches/0007-signer-storage-identity.patch'
SOURCE_COMMIT = '57c5b9e5f0749f97ffe5d93bce21c994f6957cf4'
BASELINE_SHA256 = '4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026'
PACKAGE_NAME = '@breeztech/breez-sdk-spark'
PACKAGE_VERSION = '0.1.0-getyoursats.recovery.3'
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_CONTENT_BYTES = 512 * 1024 * 1024
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_METADATA_BYTES = 1024 * 1024
MAX_MEMBERS = 20_000
NPM_IGNORE_PATHS = frozenset(f'{directory}/.gitignore' for directory in (
    'bundler', 'deno', 'examples/node', 'examples/ssr', 'examples/web',
    'itest', 'nodejs', 'ssr', 'web',
))


def _digest(data):
    return hashlib.sha256(data).hexdigest()


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field')
        result[key] = value
    return result


def _json(data):
    def reject_constant(_):
        raise ValueError('Non-finite JSON value')

    value = json.loads(data, object_pairs_hook=_object, parse_constant=reject_constant)
    if not isinstance(value, dict):
        raise ValueError('SDK metadata must be a JSON object')
    return value


def _sha256(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        raise ValueError('Invalid SHA256 field')
    return value


def _path(path, directory=False):
    path = Path(os.path.abspath(path))
    # Do not resolve away a substituted root or an intermediate symbolic link.
    for entry in [*reversed(path.parents), path]:
        mode = entry.lstat().st_mode
        if stat.S_ISLNK(mode):
            raise ValueError('Canonical SDK path contains a symbolic link')
        if entry != path and not stat.S_ISDIR(mode):
            raise ValueError('Canonical SDK ancestor is not a directory')
    mode = path.lstat().st_mode
    if not (stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode)):
        raise ValueError('Canonical SDK path has an unexpected file type')
    return path


def _read(path, limit):
    path = _path(path)
    if path.stat().st_size > limit:
        raise ValueError('Canonical SDK file exceeds the verification bound')
    data = path.read_bytes()
    if len(data) > limit:
        raise ValueError('Canonical SDK file exceeds the verification bound')
    return data


def _archive_inventory(data):
    files, directories, seen, metadata = {}, set(), set(), {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for number, member in enumerate(archive, start=1):
            if number > MAX_MEMBERS:
                raise ValueError('Too many canonical SDK archive members')
            name = member.name
            if not isinstance(name, str) or '\\' in name or '\0' in name or len(name) > 4096:
                raise ValueError('Invalid canonical SDK archive path')
            if member.isdir() and name.endswith('/'):
                name = name[:-1]
            parts = name.split('/')
            if parts[0] != 'package' or any(p in ('', '.', '..') for p in parts):
                raise ValueError('Invalid canonical SDK archive path')
            relative = '/'.join(parts[1:])
            if relative in seen:
                raise ValueError('Duplicate canonical SDK archive member')
            seen.add(relative)
            if not (member.isfile() or member.isdir()):
                raise ValueError('Canonical SDK archive contains a non-regular entry')
            if not relative and not member.isdir():
                raise ValueError('Canonical SDK archive root is not a directory')
            for index in range(1, len(parts) - 1):
                directories.add('/'.join(parts[1:index + 1]))
            if member.isdir():
                if relative:
                    directories.add(relative)
                continue
            if member.size < 0 or member.size > MAX_FILE_BYTES:
                raise ValueError('Canonical SDK archive member exceeds the verification bound')
            total += member.size
            if total > MAX_CONTENT_BYTES:
                raise ValueError('Canonical SDK archive content exceeds the verification bound')
            with archive.extractfile(member) as stream:
                if relative in ('package.json', 'getyoursats-build.json'):
                    if member.size > MAX_METADATA_BYTES:
                        raise ValueError('Canonical SDK metadata exceeds the verification bound')
                    content = stream.read()
                    metadata[relative] = content
                    files[relative] = _digest(content)
                else:
                    files[relative] = hashlib.file_digest(stream, 'sha256').hexdigest()
    if not files or set(files) & directories:
        raise ValueError('Canonical SDK archive has an empty or conflicting inventory')
    if set(metadata) != {'package.json', 'getyoursats-build.json'}:
        raise ValueError('Canonical SDK archive is missing its package or build metadata')
    return files, directories, metadata


def _installed_inventory(root):
    files, directories = {}, set()

    def visit(directory, prefix=''):
        with os.scandir(directory) as entries:
            for entry in entries:
                relative = f'{prefix}/{entry.name}' if prefix else entry.name
                mode = entry.stat(follow_symlinks=False).st_mode
                if stat.S_ISLNK(mode):
                    raise ValueError('Installed SDK contains a symbolic link')
                if stat.S_ISDIR(mode):
                    directories.add(relative)
                    visit(entry.path, relative)
                elif stat.S_ISREG(mode):
                    with open(entry.path, 'rb') as stream:
                        files[relative] = hashlib.file_digest(stream, 'sha256').hexdigest()
                else:
                    raise ValueError('Installed SDK contains a non-regular entry')

    visit(root)
    return files, directories


def compare_inventory(expected_files, expected_directories, actual_files, actual_directories):
    # npm renames packaged .gitignore files to .npmignore while extracting.
    # Permit only the nine reviewed baseline metadata paths, in the same
    # directory, when the archive has no .npmignore sibling and the original
    # is absent from the installation. All contents and other names stay bound.
    installed_expected = dict(expected_files)
    renames = []
    for original, digest in sorted(expected_files.items()):
        if original not in NPM_IGNORE_PATHS:
            continue
        replacement = original[:-len('.gitignore')] + '.npmignore'
        if original not in actual_files and replacement in actual_files and replacement not in expected_files:
            if actual_files[replacement] != digest:
                raise ValueError('Installed npm ignore rename has changed bytes')
            del installed_expected[original]
            installed_expected[replacement] = digest
            renames.append({'archivePath': original, 'installedPath': replacement, 'sha256': digest})
    if actual_files != installed_expected or actual_directories != expected_directories:
        raise ValueError('Installed SDK inventory or bytes differ from the exact canonical archive')
    return renames


def verify(repository_root, installed_root):
    repository = _path(repository_root, directory=True)
    installed = _path(installed_root, directory=True)
    release = _json(_read(repository / 'vendor/getyoursats-sdk-build.json', MAX_METADATA_BYTES))
    if type(release.get('schema')) is not int or release['schema'] != 1:
        raise ValueError('Unsupported canonical SDK manifest schema')
    if release.get('sdkSourceCommit') != SOURCE_COMMIT:
        raise ValueError('Canonical SDK source commit differs from the pinned source')
    if release.get('baselinePackageSha256') != BASELINE_SHA256:
        raise ValueError('Canonical SDK baseline package differs from the pinned baseline')
    if release.get('rustToolchain') != '1.95.0' or release.get('wasmBindgenVersion') != '0.2.120':
        raise ValueError('Canonical SDK build toolchain differs from the pinned toolchain')
    if not isinstance(release.get('extensions'), list) or 'external-signer-storage-identity-v1' not in release['extensions']:
        raise ValueError('Canonical SDK lacks the required signer storage identity extension')
    patch = _read(repository / PATCH_FILE, MAX_ARCHIVE_BYTES)
    patch_digest = _digest(patch)
    if patch_digest != _sha256(release.get('patchSha256')):
        raise ValueError('Canonical SDK manifest does not bind the selected source patch')
    archive_data = _read(repository / 'vendor/breeztech-breez-sdk-spark.tgz', MAX_ARCHIVE_BYTES)
    archive_digest = _digest(archive_data)
    if archive_digest != _sha256(release.get('packageSha256')):
        raise ValueError('Canonical SDK archive differs from the repository manifest')
    expected_files, expected_directories, archived_metadata = _archive_inventory(archive_data)
    manifest = _json(archived_metadata['getyoursats-build.json'])
    if manifest != {key: value for key, value in release.items() if key != 'packageSha256'}:
        raise ValueError('Embedded SDK manifest differs from the canonical repository manifest')
    metadata = _json(archived_metadata['package.json'])
    if metadata.get('name') != PACKAGE_NAME or metadata.get('version') != PACKAGE_VERSION:
        raise ValueError('Canonical SDK package identity or version differs from the selected release')
    generated = manifest.get('generatedArtifacts')
    if not isinstance(generated, dict) or not generated:
        raise ValueError('Canonical SDK generated artifact inventory is missing')
    for relative, digest in generated.items():
        if expected_files.get(relative) != _sha256(digest):
            raise ValueError('Canonical SDK generated artifact metadata differs from archive bytes')
    actual_files, actual_directories = _installed_inventory(installed)
    renames = compare_inventory(expected_files, expected_directories, actual_files, actual_directories)
    inventory_digest = _digest(json.dumps(actual_files, sort_keys=True, separators=(',', ':')).encode())
    archive_inventory_digest = _digest(json.dumps(expected_files, sort_keys=True, separators=(',', ':')).encode())
    return {
        'packageRoot': str(installed), 'manifest': manifest, 'metadata': metadata,
        'packageArchiveSha256': archive_digest, 'patchSha256': patch_digest,
        'packageInventorySha256': inventory_digest, 'files': len(expected_files),
        'archiveInventorySha256': archive_inventory_digest,
        'npmIgnoreRenames': renames,
    }


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('Expected the repository and installed package directories')
        print(json.dumps(verify(sys.argv[1], sys.argv[2]), sort_keys=True))
    except Exception as error:
        print(f'Canonical installed SDK preflight failed: {error}', file=sys.stderr)
        sys.exit(1)
