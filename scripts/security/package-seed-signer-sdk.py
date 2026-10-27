#!/usr/bin/env python3
"""Package the reviewed recovery extension and its atomic browser storage adapter.

Inputs are pinned to the original vendored package and SDK source. The generated
bindings for every exported runtime are rebuilt; an old Node binary is never
left behind while a new browser binary is installed. No wallet is connected.
"""
from __future__ import annotations
import argparse, gzip, hashlib, io, json, re, shutil, subprocess, tarfile, tempfile
from pathlib import Path

BASE_PACKAGE_SHA256 = '4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026'
BASE_SOURCE = '57c5b9e5f0749f97ffe5d93bce21c994f6957cf4'
BINDGEN_VERSION = '0.2.120'
PACKAGE_VERSION = '0.1.0-getyoursats.recovery.2'
BROWSER_STORAGE_SOURCE = 'crates/breez-sdk/wasm/js/web-storage/index.js'
BROWSER_STORAGE_TARGETS = ('web/storage/index.js', 'bundler/storage/index.js')
BASE_BROWSER_STORAGE_SHA256 = '1c4562a4b62898422d4ed11324e9622a337429cc322e030ed502eccd2fc6fc0d'
EXTENSIONS = [
    'seed-compatible-external-signers-v1', 'observation-only-wallet-state-v1',
    'signed-recovery-v1', 'explicit-incoming-claim-v1', 'bounded-mature-deposit-claim-v1',
    'strict-transfer-evidence-v1', 'bounded-deposit-observation-v1',
    'incoming-lightning-observation-v1', 'external-exit-envelope-validation-v1',
    'unreceived-deposit-continuation-v1', 'recovery-signer-envelope-v1',
    'atomic-cache-reservation-v1',
]

def assert_nonterminal_outcome(declarations: str, target: str) -> None:
    outcomes = re.findall(r'export type IncomingLightningObservationOutcome\s*=\s*([^;]+);', declarations)
    allowed = r'\s*(?:"awaitingPreimage"\s*\|\s*"unresolved"|"unresolved"\s*\|\s*"awaitingPreimage")\s*'
    if len(outcomes) != 1 or re.fullmatch(allowed, outcomes[0]) is None:
        raise ValueError(f'Incoming Lightning outcomes must remain nonterminal in {target}')


def assert_observation_models(declarations: str, target: str) -> None:
    contracts = {
        'ObserveDepositClaimResponse': ['correlation?: DepositClaimCorrelation;'],
        'DepositClaimCorrelation': ['correlationId: string;', 'intentHash: string;',
            'transferId: string;', 'sspRequestId: string;'],
        'ObserveIncomingLightningRequest': ['paymentId: string;', 'identityPubkey: string;',
            'network: Network;', 'invoice: string;', 'invoiceAmountSats: number;',
            'maxFeeSats: number;', 'minimumCreditSats: number;', 'expectedBindingHash?: string;'],
        'ObserveIncomingLightningResponse': ['paymentId: string;', 'identityPubkey: string;',
            'network: Network;', 'observedAt: number;', 'outcome: IncomingLightningObservationOutcome;',
            'binding?: IncomingLightningBinding;'],
        'IncomingLightningBinding': ['bindingHash: string;', 'sspIdentityPubkey: string;',
            'sspRequestId: string;', 'paymentHash: string;', 'creditSats: number;',
            'feeSats: number;', 'invoiceExpiresAt: number;', 'htlcExpiresAt: number;'],
    }
    for name, fields in contracts.items():
        match = re.search(r'export interface ' + name + r'\s*\{(.*?)\n\}', declarations, re.S)
        if match is None or any(field not in match.group(1) for field in fields):
            raise ValueError(f'{name} correlation contract differs in {target} declarations')
    assert_nonterminal_outcome(declarations, target)
    assert_storage_contract(declarations, target)


def assert_storage_contract(declarations: str, target: str) -> None:
    uncommented = re.sub(r'/\*[\s\S]*?\*/|//[^\r\n]*', '', declarations)
    interfaces = re.findall(r'export interface Storage\s*\{(.*?)\n\}', uncommented, re.S)
    expected = '(key:string,expected:string|null,value:string)=>Promise<boolean>'
    body = interfaces[0] if len(interfaces) == 1 else ''
    names = re.findall(r'\bcompareAndSwapCachedItem\b', body)
    signatures = re.findall(r'(?:^|[\r\n;])\s*compareAndSwapCachedItem(\?)?\s*:\s*([^;]+);', body)
    if len(names) != 1 or len(signatures) != 1 or signatures[0][0] != '?' or re.sub(r'\s+', '', signatures[0][1]) != expected:
        raise ValueError(f'Atomic storage commit contract differs in {target} declarations')


def regular_file(root: Path, relative: str) -> Path:
    current = root
    for component in Path(relative).parts:
        current /= component
        if current.is_symlink():
            raise ValueError(f'Storage adapter path cannot contain a symbolic link: {relative}')
    if not current.is_file():
        raise ValueError(f'Storage adapter must be a regular file: {relative}')
    return current


def install_browser_storage_adapter(package_root: Path, source: Path) -> dict:
    """Replace exactly the two baseline browser adapters with reviewed source."""
    replacement = regular_file(source, BROWSER_STORAGE_SOURCE)
    destinations = [regular_file(package_root, target) for target in BROWSER_STORAGE_TARGETS]
    # Verify both baselines before writing either; a different retained adapter
    # may contain identity/schema changes that this source must not overwrite.
    if any(digest(destination) != BASE_BROWSER_STORAGE_SHA256 for destination in destinations):
        raise ValueError('Unrecognized baseline browser storage adapter; refusing replacement')
    data = replacement.read_bytes()
    for destination in destinations:
        destination.write_bytes(data)
    return {
        'sourceFile': BROWSER_STORAGE_SOURCE,
        'sourceSha256': digest(replacement),
        'baselineSha256': BASE_BROWSER_STORAGE_SHA256,
        'artifacts': {target: digest(package_root / target) for target in BROWSER_STORAGE_TARGETS},
    }


def assert_source_patch(source: Path, patch: Path) -> None:
    if subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=source).strip():
        raise ValueError('Untracked SDK source is not covered by the patch; run check-sdk-source.py')
    source_diff = subprocess.check_output(['git', 'diff', 'HEAD', '--full-index', '--binary'], cwd=source)
    if source_diff != patch.read_bytes():
        raise ValueError('Compiled source worktree differs from the supplied patch')

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
    assert_source_patch(source, patch)
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
        storage_adapters = install_browser_storage_adapter(pkg, source)
        generated = {}
        for target in ('web', 'nodejs', 'bundler', 'deno'):
            dest = pkg / target
            # Retain module-entry and non-browser storage adapters. The two
            # browser adapters above are explicitly replaced and separately bound.
            for item in dest.glob('breez_sdk_spark_wasm*'):
                item.unlink()
            shutil.rmtree(dest / 'snippets', ignore_errors=True)
            subprocess.run([str(bindgen), str(wasm), '--target', target,
                '--out-dir', str(dest), '--out-name', 'breez_sdk_spark_wasm'], check=True)
            for file in sorted(dest.glob('breez_sdk_spark_wasm*')):
                if not file.is_file():
                    raise ValueError('Unexpected generated binding directory')
                generated[str(file.relative_to(pkg))] = digest(file)
            for file in sorted((dest / 'snippets').rglob('*')):
                if file.is_file():
                    generated[str(file.relative_to(pkg))] = digest(file)
            declarations = (dest / 'breez_sdk_spark_wasm.d.ts').read_text()
            for expected in ('defaultExternalSignersFromSeed', 'observeWalletState', 'observePayment', 'signRefundDeposit', 'verifyRefundTransaction', 'inspectRecoveryTransaction', 'claimIncomingTransfer', 'observeIncomingTransfer', 'claimMatureDepositOnce', 'observeDepositClaim', 'observeIncomingLightning', 'continueMatureDepositClaim'):
                if expected not in declarations:
                    raise ValueError(f'{expected} absent from {target} declarations')
            assert_observation_models(declarations, target)
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
        metadata['version'] = PACKAGE_VERSION
        (pkg / 'package.json').write_text(json.dumps(metadata, indent=2)+'\n')
        manifest = {
            'schema': 1, 'sdkSourceCommit': BASE_SOURCE,
            'patchSha256': digest(patch), 'baselinePackageSha256': BASE_PACKAGE_SHA256,
            'cargoLockSha256': digest(source / 'Cargo.lock'),
            'rustToolchain': '1.95.0', 'wasmBindgenVersion': BINDGEN_VERSION,
            'cargoProfile': 'release (upstream profile, wasm-opt disabled)',
            'rawCompiledWasmSha256': digest(wasm), 'generatedArtifacts': generated,
            'storageAdapters': storage_adapters,
            'securityClaim': 'same-wallet software signing, bounded observations and same-store atomic attempt reservations; continuation never resubmits a static deposit; not provider or cross-device exactly-once, isolated or hardware-backed; no real-funds release approval',
            'buildReproducibility': 'tar and gzip headers are normalized; compiled payloads may embed Cargo or build paths and are not asserted byte-identical across hosts',
            'extensions': EXTENSIONS,
        }
        (pkg / 'getyoursats-build.json').write_text(json.dumps(manifest, indent=2)+'\n')
        # Normalize tar/gzip header ownership, timestamps and archive paths.
        # This does not remove paths embedded in compiled WASM or promise
        # bit-for-bit compiler reproducibility across different build hosts.
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
