#!/usr/bin/env python3
"""Verify that a clean patched SDK represents every compiled source file.

New files created by git apply are untracked: git diff alone silently omits
these files. Include only files declared by the patch, reject other untracked
source, then compare the complete diff. This does not compile or connect a wallet.
"""
import argparse
from pathlib import Path
import subprocess


def check(source: Path, patch: Path):
    data = patch.read_bytes()
    paths = {line.split(b' b/', 1)[1].decode() for line in data.splitlines()
             if line.startswith(b'diff --git a/')}
    unexpected = []
    untracked = subprocess.check_output(
        ['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=source).split(b'\0')
    for raw in filter(None, untracked):
        name = raw.decode()
        if name not in paths:
            unexpected.append(name)
    if unexpected:
        raise ValueError('Source files missing from the patch: ' + ', '.join(unexpected))
    # Intent-to-add changes only the disposable source checkout index.
    subprocess.run(['git', 'add', '-N', '--', *sorted(paths)], cwd=source, check=True)
    actual = subprocess.check_output(['git', 'diff', '--full-index', '--binary'], cwd=source)
    if actual != data:
        raise ValueError('SDK source differs from its complete cumulative patch')
    observation = source / 'crates/breez-sdk/core/src/sdk/observation.rs'
    if not observation.is_file() or str(observation.relative_to(source)) not in paths:
        raise ValueError('Observation module is absent from the SDK source patch')
    subprocess.run(['git', 'diff', '--check'], cwd=source, check=True)
    print(f'Complete SDK source verified: {len(paths)} patched files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--patch', type=Path, required=True)
    args = parser.parse_args()
    check(args.source.resolve(), args.patch.resolve())
