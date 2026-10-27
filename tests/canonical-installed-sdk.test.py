#!/usr/bin/env python3
"""Offline synthetic-package controls. No real SDK is imported or initialized."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    'canonical_sdk', ROOT / 'scripts/security/verify-canonical-installed-sdk.py')
SDK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SDK)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


class CanonicalInstalledSdkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='gys-canonical-proof-')
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name) / 'repository'
        self.package = self.repo / 'node_modules/@breeztech/breez-sdk-spark'
        self.package.mkdir(parents=True)
        (self.repo / 'vendor/patches').mkdir(parents=True)
        self.patch = b'diff --git a/reviewed.rs b/reviewed.rs\nreviewed synthetic source fixture\n'
        (self.repo / SDK.PATCH_FILE).write_bytes(self.patch)
        self.files = {}
        for target in ('web', 'nodejs', 'bundler', 'deno'):
            self.files[f'{target}/breez_sdk_spark_wasm.js'] = b"throw new Error('synthetic SDK must not execute');\n"
            self.files[f'{target}/breez_sdk_spark_wasm_bg.wasm'] = b'offline fake binary, never compiled or initialized'
            self.files[f'{target}/snippets/reviewed-helper/index.js'] = b'export const fixture = true;\n'
        self.files['web/storage/index.js'] = b'export const storageFixture = true;\n'
        self.files['bundler/storage/index.js'] = self.files['web/storage/index.js']
        self.files['ssr/index.js'] = b'export const ssrFixture = true;\n'
        self.files['README.md'] = b'Public synthetic test package only.\n'
        self.files['package.json'] = encoded({'name': SDK.PACKAGE_NAME,
            'version': SDK.PACKAGE_VERSION, 'type': 'module', 'main': 'web/breez_sdk_spark_wasm.js'})
        self.manifest = {'schema': 1, 'sdkSourceCommit': SDK.SOURCE_COMMIT,
            'baselinePackageSha256': SDK.BASELINE_SHA256, 'patchSha256': digest(self.patch),
            'rustToolchain': '1.95.0', 'wasmBindgenVersion': '0.2.120',
            'extensions': ['external-signer-storage-identity-v1'],
            'generatedArtifacts': {name: digest(data) for name, data in self.files.items()
                if '/breez_sdk_spark_wasm' in name or '/snippets/' in name}}
        self.files['getyoursats-build.json'] = encoded(self.manifest)
        self.canonicalize()
        self.install()

    def canonicalize(self, extra_members=()):
        archive = self.repo / 'vendor/breeztech-breez-sdk-spark.tgz'
        with tarfile.open(archive, 'w:gz') as package:
            for name, data in sorted(self.files.items()):
                item = tarfile.TarInfo(f'package/{name}')
                item.size = len(data)
                package.addfile(item, io.BytesIO(data))
            for member, data in extra_members:
                package.addfile(member, io.BytesIO(data) if data is not None else None)
        release = {**self.manifest, 'packageSha256': digest(archive.read_bytes())}
        (self.repo / 'vendor/getyoursats-sdk-build.json').write_bytes(encoded(release))

    def install(self):
        for name, data in self.files.items():
            file = self.package / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)

    def verify(self, root=None):
        return SDK.verify(self.repo, root or self.package)

    def reject(self, message=None, root=None):
        with self.assertRaisesRegex(ValueError, message or '.'):
            self.verify(root)

    def modify_installed_wrapper_and_self_manifest(self):
        relative = 'web/breez_sdk_spark_wasm.js'
        changed = b"throw new Error('substituted executable wrapper');\n"
        (self.package / relative).write_bytes(changed)
        forged = copy.deepcopy(self.manifest)
        forged['generatedArtifacts'][relative] = digest(changed)
        (self.package / 'getyoursats-build.json').write_bytes(encoded(forged))
        # This reproduces the former partial verifier's positive result: the
        # wrapper matches its self-reported checksum while canonical WASM and
        # patch checks remain true. The new full canonical check must reject.
        release = json.loads((self.repo / 'vendor/getyoursats-sdk-build.json').read_bytes())
        self.assertEqual(digest((self.package / relative).read_bytes()), forged['generatedArtifacts'][relative])
        wasm = 'web/breez_sdk_spark_wasm_bg.wasm'
        self.assertEqual(digest((self.package / wasm).read_bytes()), release['generatedArtifacts'][wasm])
        self.assertEqual(forged['patchSha256'], release['patchSha256'])

    def test_accepts_exact_complete_package_without_importing_sdk(self):
        result = self.verify()
        self.assertEqual(result['files'], len(self.files))
        self.assertEqual(result['manifest'], self.manifest)
        self.assertEqual(result['metadata']['version'], SDK.PACKAGE_VERSION)
        self.assertEqual(result['patchSha256'], digest(self.patch))
        self.assertEqual(len(result['packageInventorySha256']), 64)

    def test_rejects_wrapper_and_self_manifest_forgery_that_old_guard_accepted(self):
        self.modify_installed_wrapper_and_self_manifest()
        self.reject('inventory or bytes')

    def test_rejects_modified_helpers_in_all_four_runtime_targets(self):
        for target in ('web', 'nodejs', 'bundler', 'deno'):
            with self.subTest(target=target):
                relative = f'{target}/snippets/reviewed-helper/index.js'
                (self.package / relative).write_bytes(b'export const unreviewed = true;\n')
                self.reject('inventory or bytes')
                (self.package / relative).write_bytes(self.files[relative])

    def test_rejects_modified_storage_and_ssr_helpers(self):
        for relative in ('web/storage/index.js', 'bundler/storage/index.js', 'ssr/index.js'):
            with self.subTest(relative=relative):
                (self.package / relative).write_bytes(b'changed helper')
                self.reject('inventory or bytes')
                (self.package / relative).write_bytes(self.files[relative])

    def test_rejects_extra_file_and_empty_directory(self):
        extra = self.package / 'unreviewed.js'
        extra.write_bytes(b'extra')
        self.reject('inventory or bytes')
        extra.unlink()
        extra.mkdir()
        self.reject('inventory or bytes')

    def test_rejects_missing_file(self):
        (self.package / 'README.md').unlink()
        self.reject('inventory or bytes')

    def ignore_fixture(self, sibling=False):
        self.files['web/.gitignore'] = b'canonical ignore fixture\n'
        if sibling:
            self.files['web/.npmignore'] = self.files['web/.gitignore']
        self.canonicalize()
        self.install()

    def test_accepts_and_records_exact_npm_ignore_filename_normalization(self):
        self.ignore_fixture()
        unchanged = self.verify()
        self.assertEqual(unchanged['npmIgnoreRenames'], [])
        (self.package / 'web/.gitignore').rename(self.package / 'web/.npmignore')
        normalized = self.verify()
        self.assertEqual(normalized['npmIgnoreRenames'], [{
            'archivePath': 'web/.gitignore', 'installedPath': 'web/.npmignore',
            'sha256': digest(self.files['web/.gitignore'])}])
        self.assertEqual(normalized['files'], unchanged['files'])
        self.assertNotEqual(normalized['packageInventorySha256'], unchanged['packageInventorySha256'])
        self.assertEqual(normalized['archiveInventorySha256'], unchanged['archiveInventorySha256'])

    def test_rejects_changed_bytes_during_npm_ignore_normalization(self):
        self.ignore_fixture()
        (self.package / 'web/.gitignore').rename(self.package / 'web/.npmignore')
        (self.package / 'web/.npmignore').write_bytes(b'changed ignore contents')
        self.reject('rename has changed bytes')

    def test_rejects_both_installed_names_for_one_canonical_ignore(self):
        self.ignore_fixture()
        (self.package / 'web/.npmignore').write_bytes(self.files['web/.gitignore'])
        self.reject('inventory or bytes')

    def test_rejects_ambiguous_archive_siblings_as_a_rename(self):
        self.ignore_fixture(sibling=True)
        self.verify()  # Exact unmodified names remain a valid canonical inventory.
        (self.package / 'web/.gitignore').unlink()
        self.reject('inventory or bytes')

    def test_rejects_unrelated_rename_and_cross_directory_ignore_move(self):
        original = self.package / 'README.md'
        original.rename(self.package / '.npmignore')
        self.reject('inventory or bytes')
        (self.package / '.npmignore').rename(original)
        self.ignore_fixture()
        (self.package / 'web/.gitignore').rename(self.package / 'nodejs/.npmignore')
        self.reject('inventory or bytes')

    def test_rejects_unreviewed_npm_ignore_mapping_directory(self):
        self.files['unreviewed/.gitignore'] = b'canonical but not an approved rename\n'
        self.canonicalize()
        self.install()
        self.verify()
        (self.package / 'unreviewed/.gitignore').rename(self.package / 'unreviewed/.npmignore')
        self.reject('inventory or bytes')

    def test_rejects_installed_file_symbolic_link_even_to_identical_bytes(self):
        file = self.package / 'README.md'
        other = self.repo / 'identical.md'
        file.replace(other)
        file.symlink_to(other)
        self.reject('symbolic link')

    def test_rejects_installed_directory_symbolic_link(self):
        directory = self.package / 'web/snippets'
        other = self.repo / 'snippets'
        directory.replace(other)
        directory.symlink_to(other, target_is_directory=True)
        self.reject('symbolic link')

    def test_rejects_package_root_and_intermediate_symbolic_links(self):
        alias = self.repo / 'alias'
        alias.symlink_to(self.package, target_is_directory=True)
        self.reject('symbolic link', alias)
        intermediate = self.repo / 'indirect'
        intermediate.symlink_to(self.package.parent, target_is_directory=True)
        self.reject('symbolic link', intermediate / self.package.name)

    def test_rejects_installed_nonregular_file_without_opening_it(self):
        os.mkfifo(self.package / 'fifo')
        self.reject('non-regular')

    def test_rejects_repository_authority_symlinks(self):
        for relative in ('vendor/breeztech-breez-sdk-spark.tgz',
                         'vendor/getyoursats-sdk-build.json', SDK.PATCH_FILE):
            with self.subTest(relative=relative):
                file = self.repo / relative
                other = self.repo / f'original-{file.name}'
                file.replace(other)
                file.symlink_to(other)
                self.reject('symbolic link')
                file.unlink()
                other.replace(file)

    def test_rejects_selected_source_patch_mismatch(self):
        (self.repo / SDK.PATCH_FILE).write_bytes(b'a different cumulative source')
        self.reject('selected source patch')

    def test_rejects_archive_substitution(self):
        archive = self.repo / 'vendor/breeztech-breez-sdk-spark.tgz'
        archive.write_bytes(archive.read_bytes() + b'unreviewed bytes')
        self.reject('archive differs')

    def test_rejects_repository_manifest_that_differs_from_embedded_manifest(self):
        release_file = self.repo / 'vendor/getyoursats-sdk-build.json'
        release = json.loads(release_file.read_bytes())
        release['unreviewedClaim'] = True
        release_file.write_bytes(encoded(release))
        self.reject('Embedded SDK manifest')

    def test_rejects_old_source_version_or_missing_extension(self):
        for field, invalid in (('sdkSourceCommit', '0' * 40), ('schema', True),
                               ('rustToolchain', 'latest'), ('extensions', [])):
            with self.subTest(field=field):
                self.canonicalize()
                file = self.repo / 'vendor/getyoursats-sdk-build.json'
                release = json.loads(file.read_bytes())
                release[field] = invalid
                file.write_bytes(encoded(release))
                self.reject()

    def test_rejects_canonical_archive_with_previous_package_version(self):
        metadata = json.loads(self.files['package.json'])
        metadata['version'] = '0.1.0-getyoursats.recovery.2'
        self.files['package.json'] = encoded(metadata)
        self.canonicalize()
        self.install()
        self.reject('package identity or version')

    def test_rejects_internally_incorrect_generated_digest(self):
        self.manifest['generatedArtifacts']['web/breez_sdk_spark_wasm.js'] = '0' * 64
        self.files['getyoursats-build.json'] = encoded(self.manifest)
        self.canonicalize()
        self.install()
        self.reject('generated artifact metadata')

    def test_rejects_duplicate_json_fields_in_repository_manifest(self):
        file = self.repo / 'vendor/getyoursats-sdk-build.json'
        file.write_bytes(b'{"schema":1,"schema":1}')
        self.reject('Duplicate JSON')

    def test_rejects_duplicate_json_fields_in_archive_manifest(self):
        self.files['getyoursats-build.json'] = b'{"schema":1,"schema":1}'
        self.canonicalize()
        self.install()
        self.reject('Duplicate JSON')

    def test_rejects_ambiguous_and_escaping_archive_paths(self):
        for name in ('package/web/../escape.js', '/package/escape.js', 'other/file.js',
                     'package//file.js', 'package/./file.js', 'package/web\\file.js'):
            with self.subTest(name=name):
                member = tarfile.TarInfo(name)
                member.size = 1
                self.canonicalize([(member, b'x')])
                self.reject('archive path')

    def test_rejects_duplicate_archive_members(self):
        member = tarfile.TarInfo('package/README.md')
        member.size = len(self.files['README.md'])
        self.canonicalize([(member, self.files['README.md'])])
        self.reject('Duplicate canonical')

    def test_rejects_archive_links_and_special_entries(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE):
            with self.subTest(kind=kind):
                member = tarfile.TarInfo('package/unexpected')
                member.type = kind
                member.linkname = 'package/README.md'
                self.canonicalize([(member, None)])
                self.reject('non-regular entry')

    def test_rejects_archive_file_directory_collision(self):
        member = tarfile.TarInfo('package/README.md/child')
        member.size = 1
        self.canonicalize([(member, b'x')])
        self.reject('conflicting inventory')

    def node(self, expression, env=None, arguments=None):
        directory = self.repo / 'scripts/security'
        directory.mkdir(parents=True, exist_ok=True)
        for name in ('verify-canonical-installed-sdk.mjs', 'verify-canonical-installed-sdk.py'):
            shutil.copyfile(ROOT / 'scripts/security' / name, directory / name)
        script = self.repo / 'run.mjs'
        script.write_text("import {verifyCanonicalInstalledSdk} from './scripts/security/verify-canonical-installed-sdk.mjs';\n" + expression)
        environment = dict(os.environ)
        environment.pop('GYS_SDK_PACKAGE_ROOT', None)
        environment.update(env or {})
        return subprocess.run(['node', str(script), *(arguments or [])], cwd=self.repo,
            env=environment, capture_output=True, text=True, timeout=20, check=False)

    def test_node_default_resolves_canonical_package_without_evaluating_sdk(self):
        result = self.node('console.log(JSON.stringify(verifyCanonicalInstalledSdk()));')
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['files'], len(self.files))
        self.assertEqual(receipt['packageRoot'], str(self.package))
        self.assertEqual(receipt['mode'], 'resolved installed package gate')
        self.assertFalse((self.repo / 'scripts/security/__pycache__').exists())

    def test_node_tampering_is_rejected_before_a_following_synthetic_import(self):
        self.modify_installed_wrapper_and_self_manifest()
        result = self.node("verifyCanonicalInstalledSdk(); await import('@breeztech/breez-sdk-spark');")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('inventory or bytes', result.stderr)
        self.assertNotIn('substituted executable wrapper', result.stderr)

    def test_node_environment_cannot_replace_normal_installed_package(self):
        result = self.node('verifyCanonicalInstalledSdk();', {'GYS_SDK_PACKAGE_ROOT': str(self.package)})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('explicitly labeled diagnostic', result.stderr)

    def test_node_explicit_diagnostic_copy_receives_identical_canonical_checks(self):
        diagnostic = self.repo / 'diagnostic-copy'
        shutil.copytree(self.package, diagnostic)
        expression = 'console.log(JSON.stringify(verifyCanonicalInstalledSdk({diagnosticPackageRoot:' + json.dumps(str(diagnostic)) + '})));'
        accepted = self.node(expression)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertEqual(json.loads(accepted.stdout)['mode'], 'explicit canonical diagnostic copy')
        (diagnostic / 'web/breez_sdk_spark_wasm.js').write_bytes(b'another artifact')
        rejected = self.node(expression)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('inventory or bytes', rejected.stderr)

    def test_node_repository_authority_override_is_rejected(self):
        result = self.node('verifyCanonicalInstalledSdk({repositoryRoot:process.cwd()});')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('authority cannot be overridden', result.stderr)

    def test_node_normal_mode_rejects_symlink_package_substitution(self):
        other = self.repo / 'elsewhere'
        self.package.replace(other)
        self.package.symlink_to(other, target_is_directory=True)
        result = self.node('verifyCanonicalInstalledSdk();')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('repository package directory', result.stderr)

    def test_node_cli_rejects_overrides_before_verification(self):
        self.node('')  # Copy the helper only; this does not call the verifier.
        script = self.repo / 'scripts/security/verify-canonical-installed-sdk.mjs'
        result = subprocess.run(['node', str(script), '--diagnostic', str(self.package)],
            capture_output=True, text=True, timeout=20, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('CLI accepts no overrides', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
