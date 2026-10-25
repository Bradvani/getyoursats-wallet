#!/usr/bin/env python3
"""Package the reviewed seed-signer extension without changing storage adapters.

Inputs are pinned to the original vendored package and SDK source. The generated
bindings for every exported runtime are rebuilt; an old Node binary is never
left behind while a new browser binary is installed. No wallet is connected.
"""
from __future__ import annotations
import argparse, gzip, hashlib, io, json, shutil, subprocess, tarfile, tempfile
from pathlib import Path

BASE_PACKAGE_SHA256 = '4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026'
BASE_SOURCE = '57c5b9e5f0749f97ffe5d93bce21c994f6957cf4'
BINDGEN_VERSION = '0.2.120'

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(*args: str, cwd: Path | None = None) -> str:
    return subprocess.check_output(args, cwd=cwd, text=True).strip()

def package(args: argparse.Namespace) -> None:
    source, baseline, wasm, bindgen, output, patch = map(Path,
        (args.source, args.baseline, args.wasm, args.bindgen, args.output, args.patch))
    if digest(baseline) != BASE_PACKAGE_SHA256:
        raise ValueError('Unrecognized baseline SDK package; refusing an unreviewed adapter mix')
    if run('git', 'rev-parse', 'HEAD', cwd=source) != BASE_SOURCE:
        raise ValueError('SDK checkout does not match the reviewed source commit')
    if run(str(bindgen), '--version') != f'wasm-bindgen {BINDGEN_VERSION}':
        raise ValueError('WASM binding generator version does not match Cargo.lock')
    if not wasm.is_file():
        raise ValueError('Compiled WASM is missing')
    source_diff = subprocess.check_output(['git', 'diff', '--full-index', '--binary'], cwd=source)
    if source_diff != patch.read_bytes():
        raise ValueError('Compiled source worktree differs from the supplied patch')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='gys-sdk-package-') as scratch:
        root = Path(scratch)
        with tarfile.open(baseline, 'r:gz') as archive:
            members = archive.getmembers()
            if sum(m.size for m in members) > 1024**3:
                raise ValueError('Unexpected package expansion size')
            for entry in members:
                name = Path(entry.name)
                if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != 'package':
                    raise ValueError('Unsafe package path')
                if not (entry.isfile() or entry.isdir()):
                    raise ValueError('Links and device entries are not permitted in the SDK package')
            archive.extractall(root, filter='data')
        pkg = root / 'package'
        generated = {}
        for target in ('web', 'nodejs', 'bundler', 'deno'):
            dest = pkg / target
            # Preserve the reviewed storage and module-entry adapters, replacing
            # only generated bindgen outputs and source snippets.
            for item in dest.glob('breez_sdk_spark_wasm*'):
                item.unlink()
            shutil.rmtree(dest / 'snippets', ignore_errors=True)
            subprocess.run([str(bindgen), str(wasm), '--target', target,
                '--out-dir', str(dest), '--out-name', 'breez_sdk_spark_wasm'], check=True)
            for suffix in ('.js', '.d.ts', '_bg.wasm'):
                file = dest / ('breez_sdk_spark_wasm' + suffix)
                generated[str(file.relative_to(pkg))] = digest(file)
            if 'defaultExternalSignersFromSeed' not in (dest / 'breez_sdk_spark_wasm.d.ts').read_text():
                raise ValueError(f'Seed factory absent from {target} declarations')
        node = pkg / 'nodejs/index.mjs'
        text = node.read_text()
        if text.count('  defaultExternalSigners,') != 1:
            raise ValueError('Unexpected baseline Node ESM adapter')
        node.write_text(text.replace('  defaultExternalSigners,',
            '  defaultExternalSigners,\n  defaultExternalSignersFromSeed,'))
        ssr = pkg / 'ssr/index.js'
        ssr.write_text(ssr.read_text() + '\nexport function defaultExternalSignersFromSeed(...args) {\n'
            "  if (!_module) _notInitialized('defaultExternalSignersFromSeed');\n"
            '  return _module.defaultExternalSignersFromSeed(...args);\n}\n')
        metadata = json.loads((pkg / 'package.json').read_text())
        metadata['version'] = '0.1.0-getyoursats.seed.1'
        (pkg / 'package.json').write_text(json.dumps(metadata, indent=2)+'\n')
        manifest = {
            'schema': 1, 'sdkSourceCommit': BASE_SOURCE,
            'patchSha256': digest(patch), 'baselinePackageSha256': BASE_PACKAGE_SHA256,
            'cargoLockSha256': digest(source / 'Cargo.lock'),
            'rustToolchain': '1.95.0', 'wasmBindgenVersion': BINDGEN_VERSION,
            'cargoProfile': 'release (upstream profile, wasm-opt disabled)',
            'rawCompiledWasmSha256': digest(wasm), 'generatedArtifacts': generated,
            'securityClaim': 'same-wallet software signer factory; not isolated or hardware-backed',
        }
        (pkg / 'getyoursats-build.json').write_text(json.dumps(manifest, indent=2)+'\n')
        # Deterministic archive: no local usernames, build timestamps or paths.
        with output.open('wb') as file, gzip.GzipFile(fileobj=file, mode='wb', filename='', mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w') as archive:
                for path in sorted(pkg.rglob('*')):
                    if not path.is_file():
                        continue
                    data = path.read_bytes()
                    info = tarfile.TarInfo('package/' + str(path.relative_to(pkg)))
                    info.size, info.mode, info.mtime = len(data), 0o644, 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    archive.addfile(info, io.BytesIO(data))
        manifest['packageSha256'] = digest(output)
        output.with_name('getyoursats-sdk-build.json').write_text(json.dumps(manifest, indent=2)+'\n')
        print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('source','baseline','wasm','bindgen','output','patch'):
        parser.add_argument('--'+key, required=True)
    package(parser.parse_args())
