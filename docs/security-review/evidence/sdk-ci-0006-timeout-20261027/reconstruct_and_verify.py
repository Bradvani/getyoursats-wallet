"""Read artifacts and reconstruct a disposable checkout; never import SDK code."""
import base64
import collections
import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import zipfile

REPO = Path('/tmp/getyoursats-sdk-isolated-build')
EVIDENCE = Path('/tmp/gys-sdk-0006-ci-evidence')
ZIP = Path('/tmp/gys-sdk-0006-timeout-evidence.zip')
OUT = Path('/tmp/gys-sdk-0006-independent-check')
SOURCE = 'c4236476b9d7bb52ae0da278ea2171a7018fa979'
EXPECTED_ARCHIVE = 'a140f22e7314bfd8cccc679da18111225bb4b91df23453857be11e3ee5b1bfec'
EXPECTED_ZIP = '4cf54d1a95cc8e79c990bf88144eb4587a7c50529be8661fa694a3c0af407c0e'
PATHS = {'package-lock.json', 'vendor/breeztech-breez-sdk-spark.tgz', 'vendor/getyoursats-sdk-build.json'}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git_blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def git(*args, cwd=REPO):
    return subprocess.check_output(['git', *args], cwd=cwd)

def snapshot(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise AssertionError('Unexpected source symlink')
        if path.is_file():
            result[path.relative_to(root).as_posix()] = digest(path.read_bytes())
    return result

assert digest(ZIP.read_bytes()) == EXPECTED_ZIP
with zipfile.ZipFile(ZIP) as archive:
    names = archive.namelist()
    assert len(names) == len(set(names)) == 12
    assert archive.testzip() is None
    for name in names:
        path = PurePosixPath(name)
        assert not path.is_absolute() and '..' not in path.parts
        assert digest(archive.read(name)) == digest((EVIDENCE / name).read_bytes()), name
assert (EVIDENCE / 'base.txt').read_text().strip() == SOURCE

patch_bytes = (EVIDENCE / 'sdk.patch').read_bytes()
patch = patch_bytes.decode('utf-8')
headers = re.findall(r'^diff --git a/([^\r\n]+) b/([^\r\n]+)$', patch, re.M)
assert len(headers) == 3 and all(a == b for a, b in headers)
assert {a for a, _ in headers} == PATHS
assert not re.search(r'^(?:old mode|new mode|new file mode|deleted file mode|rename |copy )', patch, re.M)
indexes = re.findall(r'^index ([a-f0-9]{40})\.\.([a-f0-9]{40}) 100644$', patch, re.M)
assert len(indexes) == 3

# git archive makes a filesystem checkout of the exact object without adding a
# worktree registration, creating a branch, updating refs, or running hooks.
checkout = Path(tempfile.mkdtemp(prefix='gys-sdk-0006-reconstructed-', dir='/tmp'))
baseline_tar = OUT / 'source-c423.tar'
git('archive', '--format=tar', '--output=' + str(baseline_tar), SOURCE)
with tarfile.open(baseline_tar, 'r:') as archive:
    archive.extractall(checkout, filter='data')
before = snapshot(checkout)
for ((path, _), (old_blob, _)) in zip(headers, indexes):
    assert git_blob((checkout / path).read_bytes()) == old_blob
git('apply', '--check', str(EVIDENCE / 'sdk.patch'), cwd=checkout)
git('apply', str(EVIDENCE / 'sdk.patch'), cwd=checkout)
after = snapshot(checkout)
assert set(before) == set(after)
changed = {path for path in before if before[path] != after[path]}
assert changed == PATHS
for ((path, _), (_, new_blob)) in zip(headers, indexes):
    assert git_blob((checkout / path).read_bytes()) == new_blob

package_path = checkout / 'vendor/breeztech-breez-sdk-spark.tgz'
package_bytes = package_path.read_bytes()
assert digest(package_bytes) == EXPECTED_ARCHIVE
sidecar_bytes = (checkout / 'vendor/getyoursats-sdk-build.json').read_bytes()
assert sidecar_bytes == (EVIDENCE / 'artifact-manifest.json').read_bytes()
sidecar = json.loads(sidecar_bytes)
assert sidecar['packageSha256'] == EXPECTED_ARCHIVE
assert digest((checkout / 'vendor/patches/0006-reconciled-recovery-source.patch').read_bytes()) == sidecar['patchSha256']

file_hashes = {}
small_files = {}
with tarfile.open(package_path, 'r:gz') as archive:
    members = archive.getmembers()
    assert len({member.name for member in members}) == len(members)
    assert sum(member.size for member in members) < 1024**3
    for member in members:
        path = PurePosixPath(member.name)
        assert not path.is_absolute() and '..' not in path.parts and path.parts[0] == 'package'
        assert member.isfile() or member.isdir()
        if member.isdir():
            continue
        data = archive.extractfile(member).read()
        relative = '/'.join(path.parts[1:])
        file_hashes[relative] = digest(data)
        if relative in {'package.json', 'getyoursats-build.json'}:
            small_files[relative] = data
embedded = json.loads(small_files['getyoursats-build.json'])
assert embedded == {key: value for key, value in sidecar.items() if key != 'packageSha256'}
assert small_files['getyoursats-build.json'] == (json.dumps(embedded, indent=2) + '\n').encode()
for path, expected in embedded['generatedArtifacts'].items():
    assert file_hashes[path] == expected, path
for path, expected in embedded['storageAdapters']['artifacts'].items():
    assert file_hashes[path] == expected, path
metadata = json.loads(small_files['package.json'])
assert metadata['version'] == '0.1.0-getyoursats.recovery.2'
lock = json.loads((checkout / 'package-lock.json').read_bytes())
lock_sdk = lock['packages']['node_modules/@breeztech/breez-sdk-spark']
assert lock_sdk['version'] == metadata['version']
assert lock_sdk['resolved'] == 'file:vendor/breeztech-breez-sdk-spark.tgz'
assert lock_sdk['integrity'] == 'sha512-' + base64.b64encode(hashlib.sha512(package_bytes).digest()).decode()

build_log = (EVIDENCE / 'native-and-wasm-build.log').read_text()
gates = [json.loads(line) for line in build_log.splitlines() if line.startswith('{"rustGate":')]
assert len(gates) == 17 and len({(gate['crate'], gate['rustGate']) for gate in gates}) == 17
summaries = re.findall(r'^test result: ok\. (\d+) passed; (\d+) failed;', build_log, re.M)
assert len(summaries) == len(gates)
for (passed, failed), gate in zip(summaries, gates):
    assert int(passed) == gate['passed'] and int(failed) == 0
native_gates = [gate for gate in gates if gate['crate'] != 'breez-sdk-spark-wasm']
wasm_gates = [gate for gate in gates if gate['crate'] == 'breez-sdk-spark-wasm']
assert sum(gate['passed'] for gate in native_gates) == 221
assert len(native_gates) == 16
assert len(wasm_gates) == 1 and wasm_gates[0]['rustGate'] == 'storage_cas_bridge_' and wasm_gates[0]['passed'] == 6

browser_bytes = (EVIDENCE / 'browser-storage-cas.json').read_bytes()
browser = json.loads(browser_bytes)
assert browser['config']['metadata']['ci']['commitHash'] == SOURCE
assert browser['config']['metadata']['ci']['buildHref'].endswith('/40466031487')
assert browser['errors'] == []
assert {key: browser['stats'][key] for key in ('expected','skipped','unexpected','flaky')} == {'expected':27,'skipped':0,'unexpected':0,'flaky':0}

def iter_specs(suite):
    yield from suite.get('specs', [])
    for child in suite.get('suites', []):
        yield from iter_specs(child)

engine_counts = collections.Counter()
adapter_attestations = {}
for suite in browser['suites']:
    for spec in iter_specs(suite):
        assert spec['ok'] is True
        for test in spec['tests']:
            assert test['expectedStatus'] == 'passed' and test['status'] == 'expected'
            assert len(test['results']) == 1
            result = test['results'][0]
            assert result['status'] == 'passed' and result['retry'] == 0 and result['errors'] == []
            engine_counts[test['projectName']] += 1
            for attachment in result.get('attachments', []):
                if attachment['name'] == 'adapter-identity':
                    identity = json.loads(base64.b64decode(attachment['body'], validate=True))
                    assert identity['source'] == 'installed-sdk'
                    assert identity['sha256'] == embedded['storageAdapters']['artifacts']['web/storage/index.js']
                    assert identity['bytes'] == 101819
                    assert test['projectName'] not in adapter_attestations
                    adapter_attestations[test['projectName']] = identity
assert dict(engine_counts) == {'chromium':9,'firefox':9,'webkit':9}
assert set(adapter_attestations) == set(engine_counts)

installer = (EVIDENCE / 'browser-install.log').read_text()
slow_download = 'Fetched 119 MB in 27min 11s (72.9 kB/s)'
assert slow_download in installer and 'http://azure.archive.ubuntu.com/ubuntu' in installer
assert (EVIDENCE / 'typescript.log').stat().st_size == 0

receipt = {
    'schema':1,
    'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'purpose':'Independent offline reconstruction of artifacts from a cancelled diagnostic CI run',
    'result':'ARTIFACT RECONSTRUCTION AND RECORDED SUBTEST COUNTS VERIFIED; OVERALL CI REMAINS CANCELLED',
    'workflow':{'runId':40466031487,'jobId':122061530504,'url':'https://github.com/Bradvani/getyoursats-wallet/actions/runs/40466031487/job/122061530504','overallConclusion':'cancelled','preserveJob':'skipped','overallStatusSource':'GitHub status reported by root; no network re-query performed'},
    'source':{'commit':SOURCE,'tree':git('rev-parse',SOURCE+'^{tree}').decode().strip(),'sdkSourceCommit':embedded['sdkSourceCommit'],'sdkPatchSha256':embedded['patchSha256']},
    'inputEvidence':{'zipSha256':EXPECTED_ZIP,'zipRegularFiles':len(names),'allExtractedFilesMatchZip':True,'sdkPatchSha256':digest(patch_bytes),'sdkPatchBytes':len(patch_bytes)},
    'reconstruction':{'method':'git archive to a disposable filesystem checkout followed by git apply; no repository refs changed','patchAppliesCleanly':True,'exactChangedPaths':sorted(changed),'oldAndNewGitBlobsMatchPatch':True,'baselineFileInventoryCount':len(before),'noOtherFileChanges':True,'reconstructedArtifacts':{path:{'sha256':after[path],'bytes':(checkout/path).stat().st_size} for path in sorted(changed)}},
    'package':{'version':metadata['version'],'archiveSha256':EXPECTED_ARCHIVE,'regularFileCount':len(file_hashes),'allArchiveMembersSafeAndUnique':True,'sidecarMatchesUploadedManifestBytes':True,'embeddedManifestEqualsSidecarWithoutArchiveHash':True,'generatedArtifactHashesVerified':len(embedded['generatedArtifacts']),'browserAdapterHashesVerified':len(embedded['storageAdapters']['artifacts']),'lockfileSha512MatchesArchive':True,'webWasmSha256':embedded['generatedArtifacts']['web/breez_sdk_spark_wasm_bg.wasm']},
    'recordedResults':{'nativeCasesPassed':221,'nativeGateGroups':16,'wasmBridgeCasesPassed':6,'wasmGateGroups':1,'rustGateRecords':gates,'browserCasesPassed':27,'browserByEngine':dict(engine_counts),'browserUnexpected':0,'browserSkipped':0,'browserFlaky':0,'browserReportErrors':0,'browserDurationMs':browser['stats']['duration'],'browserAdapterAttestations':adapter_attestations,'browserReportSha256':digest(browser_bytes),'typescriptLogEmpty':True},
    'timingEvidence':{'directlyObservedInDownloadedBrowserInstallLog':slow_download,'archiveTransport':'HTTP azure.archive.ubuntu.com','initial45_6MbDownloadTiming':'Reported by root from job logs, not present in this 12-file artifact set'},
    'limits':['No SDK code imported or executed','No tests, browser, provider, profile or network operations rerun','No git branch or remote refs changed and no artifacts published','The cancelled workflow is not a passing CI run','Preservation job did not run; reconstruction is diagnostic only','This is cumulative0006/recovery.2 and retains the known external-signer namespace defect','New0007 identity controls are not covered by this historical run','No production or funded-release approval'],
}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
(OUT/'local-checkout-path.txt').write_text(str(checkout)+'\n')
print(json.dumps({'receipt':str(OUT/'receipt.json'),'receiptSha256':digest((OUT/'receipt.json').read_bytes()),'checkout':str(checkout),'packageSha256':EXPECTED_ARCHIVE,'native':221,'wasm':6,'browser':dict(engine_counts),'overall':'cancelled','preserve':'skipped'},indent=2))
