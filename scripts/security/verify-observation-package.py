#!/usr/bin/env python3
"""Compare every installed SDK file with an already-hash-approved tar archive.

No extraction, imports, wallet values or network access. Link/special-file and
extra-installed-file rejection prevents an unbound wrapper/storage helper.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile


def verify(archive, installed):
    root = Path(installed).resolve(strict=True)
    expected = {}
    with tarfile.open(archive, 'r:gz') as package:
        for member in package.getmembers():
            name = PurePosixPath(member.name)
            if not name.parts or name.parts[0] != 'package' or any(p in ('', '.', '..') for p in name.parts):
                raise ValueError('Invalid SDK archive path')
            if member.isdir():
                continue
            if not member.isfile() or len(name.parts) < 2:
                raise ValueError('SDK archive contains a non-regular entry')
            relative = '/'.join(name.parts[1:])
            if relative in expected:
                raise ValueError('Duplicate SDK archive member')
            with package.extractfile(member) as stream:
                expected[relative] = hashlib.file_digest(stream, 'sha256').hexdigest()
    actual = {}
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            if Path(directory, name).is_symlink():
                raise ValueError('Installed SDK contains a symbolic link')
        for name in files:
            file = Path(directory, name)
            if not file.is_file():
                raise ValueError('Installed SDK contains a non-regular file')
            with file.open('rb') as stream:
                actual[file.relative_to(root).as_posix()] = hashlib.file_digest(stream, 'sha256').hexdigest()
    if not expected or actual != expected:
        raise ValueError('Installed SDK inventory/bytes differ from the exact archive')
    return {'files': len(actual), 'inventorySha256': hashlib.sha256(
        json.dumps(actual, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


if __name__ == '__main__':
    try:
        print(json.dumps(verify(sys.argv[1], sys.argv[2]), sort_keys=True))
    except Exception:
        print('Installed SDK archive comparison failed', file=sys.stderr)
        sys.exit(1)
