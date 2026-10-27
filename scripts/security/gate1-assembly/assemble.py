#!/usr/bin/env python3
"""Reconstruct a fixed integration tree. No wallet, SDK or network calls except git.

This assembler is not included in the candidate tree. It cannot change production,
existing branches, release interlocks or the three pinned input commits. The
workflow publishes only after the final tree equals EXPECTED_TREE.
"""
from pathlib import Path
import base64
import gzip
import hashlib
import os
import re
import subprocess
import sys

BASE = '5cff021037ad9aa1a984bc33ed97bcc407e3b27e'
MAIN = '37abc88bd113d6c519911fd6773dc74ce603282a'
PAYMENTS = '98211bf90ec740c89091906230338097e81db237'
EXPECTED_TREE = '35daca92718d78b384847b341bbe00d990796a3d'
EXPECTED_PATCH = 'd72398a16952cca524ac27f31ed465cfdb7ad87f76745b6ef150c93a0d6fcf79'
EXPECTED_ENCODED = '2ca9cfb0dc5e667c2f14f2a9751d28cf77cceaa1b261fa19d8a76fa71d49b1bd'
TRANSPORT_REVISION = 'f75e30a7386fbe13138268cd449b94f8ad233e4b1fc48f67ba3c37ac327ed7b3'


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(['git', *args], text=True, capture_output=True, check=check)


def conflicts() -> set[str]:
    return set(git('diff', '--name-only', '--diff-filter=U').stdout.splitlines())


def merge(ref: str, expected: set[str]) -> None:
    outcome = git('merge', '--no-commit', '--no-ff', ref, check=False)
    if outcome.returncode not in (0, 1) or conflicts() != expected:
        raise RuntimeError('Unexpected merge boundary: ' + outcome.stdout + outcome.stderr)


def checkpoint(message: str) -> None:
    git('add', '-A')
    git('diff', '--check', '--cached')
    git('commit', '-m', message)


def patch_bytes() -> bytes:
    encoded = ''.join(Path(__file__).with_name('adjustments.patch.gz.b64').read_text().split())
    digest = hashlib.sha256(encoded.encode('ascii')).hexdigest()
    if digest == TRANSPORT_REVISION:
        # Correct five identified text-transport transcription errors only.
        # The received input, repaired encoding, decompressed patch and final
        # source tree each have a separate mandatory hash. No fuzzy repair.
        corrections = [
            ('bGWMkvFN5z+B987nrdGxGxJwhaUdGJPnbjf7nc', 'bGWMkvFN5z+B987nrdGxJwhaUdGJPnbjf7nc'),
            ('NfhUHpsS3y+IXzfKY3CofFp7uw/n8f/X45N1se', 'NfhUHpsS3y+IXzfKY3fFp7uw/n8f/X45N1se'),
            ('7kT3Mj388dHZkbHZ0bGkXfjJ9NH5e9/PjXzyy/X', '7kT3Mj388dHZkbHZ0b+fjJ9NH5e9/PjXzyy/X'),
            ('Dx5ojx5ozw1Up4cL0+RAdoZ8jyom3dYq/WWhPt', 'Dx5ojx5ozw1Up4cL0+doZ8jyom3dYq/WWhPt'),
            ('A+XPBeuPXlRzXlYnrxZZnhyDryspMxHSp2KVE', 'A+XPBeuPXlRzXlYnrxZnhyDryspMxHSp2KVE'),
        ]
        for original, replacement in corrections:
            if encoded.count(original) != 1:
                raise RuntimeError('Transport correction does not match exactly')
            encoded = encoded.replace(original, replacement)
    if hashlib.sha256(encoded.encode('ascii')).hexdigest() != EXPECTED_ENCODED:
        raise RuntimeError('Encoded adjustment integrity check failed')
    result = gzip.decompress(base64.b64decode(encoded, validate=True))
    if hashlib.sha256(result).hexdigest() != EXPECTED_PATCH:
        raise RuntimeError('Adjustment patch integrity check failed')
    return result


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('Usage: assemble.py <new-worktree-directory>')
    root = Path.cwd()
    target = Path(sys.argv[1]).resolve()
    if target.exists():
        raise RuntimeError('Refusing to replace an existing worktree')
    adjustments = patch_bytes()
    for commit in (BASE, MAIN, PAYMENTS):
        git('fetch', '--no-tags', 'origin', commit)
        if git('rev-parse', commit).stdout.strip() != commit:
            raise RuntimeError('Input commit differs')
    git('worktree', 'add', '--detach', str(target), BASE)
    os.chdir(target)
    git('config', 'user.name', 'GetYourSats candidate assembly')
    git('config', 'user.email', '150425543+Bradvani@users.noreply.github.com')
    git('update-ref', 'refs/remotes/origin/gate1-main', MAIN)
    git('update-ref', 'refs/remotes/origin/gate1-payments', PAYMENTS)
    first = {
        '.gitignore', 'src/components/PaymentDetailsDialog.tsx',
        'src/components/StableBalanceToggleFlow.tsx',
        'src/features/receive/ReceivePaymentDialog.tsx',
        'src/features/receive/SparkAddressDisplay.tsx',
        'src/features/send/SendPaymentDialog.tsx',
        'src/features/send/steps/AmountStep.tsx',
    }
    merge('origin/gate1-main', first)
    pattern = re.compile(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> origin/gate1-main\n', re.S)
    for name in sorted(first):
        if name.endswith('StableBalanceToggleFlow.tsx'):
            continue
        def resolve(match: re.Match) -> str:
            left, right = match.group(1), match.group(2)
            if name.endswith('SparkAddressDisplay.tsx'):
                return left.replace("'Could not create a Spark receive address. No payment request is available.'", "t('Could not create a Spark receive address. No payment request is available.')").replace('            Try again', "            {t('Try again')}")
            if name.endswith('AmountStep.tsx') and 'disabled=' in left:
                return left.replace("'Balance is updating. Try again in a moment.'", "t('Balance is updating. Try again in a moment.')")
            return left + right
        path = Path(name)
        content = pattern.sub(resolve, path.read_text())
        if '<<<<<<<' in content:
            raise RuntimeError('Unresolved conflict: ' + name)
        path.write_text(content)
    name = 'src/components/StableBalanceToggleFlow.tsx'
    content = git('show', MAIN + ':' + name).stdout
    content = "import {isRestrictedBrowserWallet} from '../security/browserReleasePolicy';\nimport {DialogContainer,DialogCard} from './ui';\n" + content
    content = content.replace(' const {language}=usePresentation();', ' const unavailable=isRestrictedBrowserWallet(wallet);\n const {language}=usePresentation();')
    content = content.replace('  if(executing.current)return;', '  if(unavailable||executing.current)return;')
    content = content.replace("  if(executing.current||step!=='review'", "  if(unavailable||executing.current||step!=='review'")
    content = content.replace(" if(step==='intro')", ''' if(unavailable)return <DialogContainer><DialogCard maxWidth="sm">
  <h3 className="text-lg font-bold text-spark-text-primary">Balance conversion unavailable</h3>
  <p className="my-4 text-sm text-spark-text-secondary">Balance conversion is temporarily unavailable in this preview. Your assets have not been converted.</p>
  <button type="button" onClick={onCancel} className="min-h-11 w-full rounded-xl border border-spark-border text-spark-text-primary">Close</button>
 </DialogCard></DialogContainer>;
 if(step==='intro')''')
    Path(name).write_text(content)
    checkpoint('merge: reconcile current production with Gate 1 security controls')
    second = {
        'src/features/receive/ReceivePaymentDialog.tsx',
        'src/features/receive/SparkAddressDisplay.tsx',
        'src/features/send/directSparkSend.test.tsx',
        'src/features/send/steps/ConfirmStep.tsx',
        'src/features/send/workflows/SparkWorkflow.tsx',
    }
    merge('origin/gate1-payments', second)
    pattern = re.compile(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> origin/gate1-payments\n', re.S)
    for name in sorted(second):
        def resolve(match: re.Match) -> str:
            left, right = match.group(1), match.group(2)
            if name.endswith('ConfirmStep.tsx'):
                return right
            if name.endswith('SparkAddressDisplay.tsx') and 'LoadingSpinner' in left:
                return right
            if name.endswith('directSparkSend.test.tsx'):
                if 'as unknown as' in left:
                    return right
                if 'expect(' in left:
                    return left + right
            return left
        path = Path(name)
        content = pattern.sub(resolve, path.read_text())
        if '<<<<<<<' in content:
            raise RuntimeError('Unresolved conflict: ' + name)
        path.write_text(content)
    checkpoint('merge: include direct payments and strict fee quotes without weakening security containment')
    patch = root / 'gate1-adjustments-verified.patch'
    patch.write_bytes(adjustments)
    git('apply', '--check', str(patch))
    git('apply', '--index', str(patch))
    if git('write-tree').stdout.strip() != EXPECTED_TREE:
        raise RuntimeError('Reconstructed candidate tree differs from the tested tree')
    checkpoint('fix(security): reconcile Gate 1 feedback and enforce exact-candidate verification')
    for commit in (BASE, MAIN, PAYMENTS):
        git('merge-base', '--is-ancestor', commit, 'HEAD')
    if git('status', '--porcelain').stdout or git('rev-parse', 'HEAD^{tree}').stdout.strip() != EXPECTED_TREE:
        raise RuntimeError('Candidate changed after its final integrity check')
    print('CANDIDATE_COMMIT=' + git('rev-parse', 'HEAD').stdout.strip())
    print('CANDIDATE_TREE=' + EXPECTED_TREE)


if __name__ == '__main__':
    main()
