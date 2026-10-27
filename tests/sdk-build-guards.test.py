#!/usr/bin/env python3
"""Offline regression controls for the SDK source and generated-type proof guards."""
import importlib.util
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/security' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


checker = module('sdk_source_check', 'check-sdk-source.py')
packager = module('sdk_packager', 'package-seed-signer-sdk.py')


class SourceProofTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='gys-sdk-source-guard-test-')
        self.directory = Path(self.scratch.name)
        self.source = self.directory / 'source'
        self.source.mkdir()
        self.observation = self.source / 'crates/breez-sdk/core/src/sdk/observation.rs'
        self.observation.parent.mkdir(parents=True)
        self.observation.write_text('// baseline observation\n')
        (self.source / 'tracked.rs').write_text('// baseline tracked source\n')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=SDK proof fixture', '-c', 'user.email=fixture@example.invalid',
                 'commit', '-qm', 'public offline fixture')
        self.patch = self.directory / 'source.patch'

    def tearDown(self):
        self.scratch.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.source)

    def change_observation(self):
        self.observation.write_text('// reviewed observation change\n')

    def test_clean_baseline_is_accepted(self):
        checker.require_clean(self.source)

    def test_staged_baseline_cannot_pass_clean_gate(self):
        (self.source / 'tracked.rs').write_text('// staged unreviewed change\n')
        self.git('add', 'tracked.rs')
        # Reproduce the old false positive before requiring HEAD-based rejection.
        self.assertEqual(self.git('diff', '--full-index', '--binary'), b'')
        with self.assertRaisesRegex(ValueError, 'staged or unstaged'):
            checker.require_clean(self.source)

    def test_untracked_baseline_is_rejected(self):
        (self.source / 'extra.rs').write_text('// untracked source\n')
        with self.assertRaisesRegex(ValueError, 'untracked'):
            checker.require_clean(self.source)

    def test_staged_source_cannot_hide_outside_patch(self):
        self.change_observation()
        self.patch.write_bytes(self.git('diff', '--full-index', '--binary'))
        (self.source / 'tracked.rs').write_text('// staged unreviewed change\n')
        self.git('add', 'tracked.rs')
        # Both old checkers saw exactly the supplied patch, omitting the index.
        self.assertEqual(self.git('diff', '--full-index', '--binary'), self.patch.read_bytes())
        with self.assertRaisesRegex(ValueError, 'complete cumulative patch'):
            checker.check(self.source, self.patch)
        with self.assertRaisesRegex(ValueError, 'differs from the supplied patch'):
            packager.assert_source_patch(self.source, self.patch)

    def test_complete_head_diff_covers_staged_and_unstaged_changes(self):
        (self.source / 'tracked.rs').write_text('// reviewed staged change\n')
        self.git('add', 'tracked.rs')
        self.change_observation()
        self.patch.write_bytes(self.git('diff', 'HEAD', '--full-index', '--binary'))
        checker.check(self.source, self.patch)
        packager.assert_source_patch(self.source, self.patch)

    def test_declared_new_source_is_included_before_comparison(self):
        self.change_observation()
        (self.source / 'new.rs').write_text('// reviewed new module\n')
        self.git('add', '-N', 'new.rs')
        self.patch.write_bytes(self.git('diff', 'HEAD', '--full-index', '--binary'))
        self.git('reset', '-q', '--', 'new.rs')
        checker.check(self.source, self.patch)
        packager.assert_source_patch(self.source, self.patch)

    def test_undeclared_new_source_is_rejected(self):
        self.change_observation()
        self.patch.write_bytes(self.git('diff', 'HEAD', '--full-index', '--binary'))
        (self.source / 'unreviewed.rs').write_text('// absent from patch\n')
        with self.assertRaisesRegex(ValueError, 'missing from the patch'):
            checker.check(self.source, self.patch)
        with self.assertRaisesRegex(ValueError, 'Untracked SDK source'):
            packager.assert_source_patch(self.source, self.patch)


class OutcomeProofTests(unittest.TestCase):
    @staticmethod
    def declaration(expression):
        return f'export type IncomingLightningObservationOutcome = {expression};\n'

    def test_exact_nonterminal_union_is_accepted(self):
        for expression in ['"awaitingPreimage" | "unresolved"', ' "unresolved"\n | "awaitingPreimage" ']:
            with self.subTest(expression=expression):
                packager.assert_nonterminal_outcome(self.declaration(expression), 'fixture')

    def test_unquoted_type_widening_is_rejected_after_old_false_positive(self):
        for extra in ['string', 'any', 'unknown', 'undefined', 'OtherOutcome', 'never']:
            expression = f'"awaitingPreimage" | "unresolved" | {extra}'
            with self.subTest(extra=extra):
                self.assertEqual(set(re.findall(r'"([^"]+)"', expression)), {'awaitingPreimage', 'unresolved'})
                with self.assertRaisesRegex(ValueError, 'remain nonterminal'):
                    packager.assert_nonterminal_outcome(self.declaration(expression), 'fixture')

    def test_duplicate_or_terminal_declaration_is_rejected(self):
        valid = self.declaration('"awaitingPreimage" | "unresolved"')
        for declaration in [valid + valid, '',
                            self.declaration('"awaitingPreimage" | "unresolved" | "completed"'),
                            self.declaration('"awaitingPreimage" | "unresolved" & OtherOutcome')]:
            with self.subTest(declaration=declaration):
                with self.assertRaisesRegex(ValueError, 'remain nonterminal'):
                    packager.assert_nonterminal_outcome(declaration, 'fixture')


class StorageContractProofTests(unittest.TestCase):
    @staticmethod
    def declaration(expression):
        return f'export interface Storage {{\n compareAndSwapCachedItem?: {expression};\n}}\n'

    def test_exact_atomic_commit_contract_is_accepted(self):
        packager.assert_storage_contract(self.declaration(
            '(key: string, expected: string | null, value: string) => Promise<boolean>'), 'fixture')

    def test_missing_or_widened_commit_contract_is_rejected(self):
        valid = '(key: string, expected: string | null, value: string) => Promise<boolean>'
        for expression in [valid.replace('boolean', 'boolean | string'),
                           valid.replace('string | null', 'string | undefined'),
                           valid.replace('Promise<boolean>', 'boolean'),
                           valid.replace('Promise<boolean>', 'Promise<any>')]:
            with self.subTest(expression=expression):
                with self.assertRaisesRegex(ValueError, 'Atomic storage'):
                    packager.assert_storage_contract(self.declaration(expression), 'fixture')
        with self.assertRaisesRegex(ValueError, 'Atomic storage'):
            packager.assert_storage_contract('export interface Storage {\n}\n', 'fixture')

    def test_similar_member_name_is_not_the_atomic_storage_method(self):
        valid = self.declaration('(key: string, expected: string | null, value: string) => Promise<boolean>')
        altered = valid.replace('compareAndSwapCachedItem', 'notcompareAndSwapCachedItem')
        self.assertEqual(len(re.findall(r'compareAndSwapCachedItem\?\s*:\s*([^;]+);', altered)), 1)
        with self.assertRaisesRegex(ValueError, 'Atomic storage'):
            packager.assert_storage_contract(altered, 'fixture')

    def test_comment_cannot_supply_a_missing_atomic_storage_method(self):
        signature = '(key: string, expected: string | null, value: string) => Promise<boolean>'
        altered = f'export interface Storage {{\n /* compareAndSwapCachedItem?: {signature}; */\n}}\n'
        self.assertEqual(len(re.findall(r'compareAndSwapCachedItem\?\s*:\s*([^;]+);', altered)), 1)
        with self.assertRaisesRegex(ValueError, 'Atomic storage'):
            packager.assert_storage_contract(altered, 'fixture')

    def test_second_required_member_cannot_widen_the_optional_method(self):
        valid = self.declaration('(key: string, expected: string | null, value: string) => Promise<boolean>')
        altered = valid.replace('\n}', '\n compareAndSwapCachedItem: (key: any) => Promise<any>;\n}')
        self.assertEqual(len(re.findall(r'compareAndSwapCachedItem\?\s*:\s*([^;]+);', altered)), 1)
        with self.assertRaisesRegex(ValueError, 'Atomic storage'):
            packager.assert_storage_contract(altered, 'fixture')


class BrowserStorageProofTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='gys-sdk-storage-proof-')
        self.directory = Path(self.scratch.name)
        self.source = self.directory / 'source'
        self.package = self.directory / 'package'
        self.baseline = b'// public retained adapter fixture\n'
        self.replacement = b'// public reviewed atomic adapter fixture\n'
        self.source_file = self.source / packager.BROWSER_STORAGE_SOURCE
        self.source_file.parent.mkdir(parents=True)
        self.source_file.write_bytes(self.replacement)
        for target in packager.BROWSER_STORAGE_TARGETS:
            file = self.package / target
            file.parent.mkdir(parents=True)
            file.write_bytes(self.baseline)
        self.baseline_guard = mock.patch.object(packager, 'BASE_BROWSER_STORAGE_SHA256',
            hashlib.sha256(self.baseline).hexdigest())
        self.baseline_guard.start()

    def tearDown(self):
        self.baseline_guard.stop()
        self.scratch.cleanup()

    def test_exact_two_baseline_adapters_are_replaced_and_bound(self):
        manifest = packager.install_browser_storage_adapter(self.package, self.source)
        digest = hashlib.sha256(self.replacement).hexdigest()
        self.assertEqual(manifest['sourceSha256'], digest)
        self.assertEqual(manifest['baselineSha256'], hashlib.sha256(self.baseline).hexdigest())
        self.assertEqual(manifest['sourceFile'], packager.BROWSER_STORAGE_SOURCE)
        self.assertEqual(manifest['artifacts'], {target: digest for target in packager.BROWSER_STORAGE_TARGETS})
        for target in packager.BROWSER_STORAGE_TARGETS:
            self.assertEqual((self.package / target).read_bytes(), self.replacement)

    def test_different_retained_adapter_blocks_both_replacements(self):
        target = self.package / packager.BROWSER_STORAGE_TARGETS[1]
        target.write_bytes(b'// unreviewed identity or migration customization\n')
        before = {p: (self.package / p).read_bytes() for p in packager.BROWSER_STORAGE_TARGETS}
        with self.assertRaisesRegex(ValueError, 'baseline browser storage'):
            packager.install_browser_storage_adapter(self.package, self.source)
        self.assertEqual(before, {p: (self.package / p).read_bytes() for p in packager.BROWSER_STORAGE_TARGETS})

    def test_missing_baseline_adapter_is_rejected(self):
        (self.package / packager.BROWSER_STORAGE_TARGETS[1]).unlink()
        with self.assertRaisesRegex(ValueError, 'regular file'):
            packager.install_browser_storage_adapter(self.package, self.source)
        self.assertEqual((self.package / packager.BROWSER_STORAGE_TARGETS[0]).read_bytes(), self.baseline)

    def test_source_symlink_cannot_supply_unbound_bytes(self):
        outside = self.directory / 'outside.js'
        self.source_file.rename(outside)
        self.source_file.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'symbolic link'):
            packager.install_browser_storage_adapter(self.package, self.source)

    def test_baseline_adapter_symlink_is_rejected_even_with_matching_digest(self):
        target = self.package / packager.BROWSER_STORAGE_TARGETS[0]
        outside = self.directory / 'outside.js'
        target.rename(outside)
        target.symlink_to(outside)
        self.assertEqual(packager.digest(target), packager.BASE_BROWSER_STORAGE_SHA256)
        with self.assertRaisesRegex(ValueError, 'symbolic link'):
            packager.install_browser_storage_adapter(self.package, self.source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
