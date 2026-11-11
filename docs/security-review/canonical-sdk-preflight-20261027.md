# Canonical installed SDK provenance preflight

This change closes an artifact-authority gap in the installed SDK checks. The
former standalone namespace verifier compared the imported JavaScript wrapper
to the installed package's own manifest, while its repository check covered
only the WASM bytes. A modified wrapper and matching installed checksum could
therefore satisfy that partial check. The regression suite reproduces those
former positive checks, then requires the complete canonical preflight to reject
the same package before a following synthetic import can execute.

`scripts/security/verify-canonical-installed-sdk.mjs` exports the synchronous
`verifyCanonicalInstalledSdk({ diagnosticPackageRoot } = {})`. Its authority is
fixed to the helper's checkout. Normal mode resolves the repository-local
installed package. An explicitly selected diagnostic copy must satisfy all the
same checks; an environment variable cannot replace the normal installed gate.
The command-line entry accepts no overrides.

The Python backend runs with `-I -B`. Before any SDK import, it checks the actual
selected `0007` patch digest, repository archive digest, pinned source and build
metadata, exact embedded/repository manifest equality, and every installed
file and directory against that archive. It rejects extra or missing content,
changed bytes, symbolic links, special entries, ambiguous archive names and
duplicate metadata fields. The selected release is `recovery.3`; an older
archive cannot satisfy this source gate. Both the existing signer verifier and
observation-extension verifier call the shared guard before importing SDK code.
The standalone namespace verifier uses this same API in the integration branch.

## npm metadata normalization

A real retained installation established that npm renamed nine archive
`.gitignore` files to `.npmignore` while preserving their exact bytes. The
preflight permits only these reviewed metadata paths: `bundler`, `deno`,
`examples/node`, `examples/ssr`, `examples/web`, `itest`, `nodejs`, `ssr`, and
`web`. A rename must stay in the same directory, the original installed name
must be absent, the archive must not have a `.npmignore` sibling, and the digest
must be identical. Unexpected names, both installed names, ambiguous archive
siblings, other directories, changed contents and cross-directory moves fail.
No executable filename receives normalization.

Every mapping is reported in `npmIgnoreRenames`. `archiveInventorySha256` hashes
the original archive-name map; `packageInventorySha256` hashes the actual
installed-name map. Each is the SHA256 of compact sorted JSON mapping relative
file paths to SHA256 values. They differ when npm has renamed metadata files.

## Verification and evidence

The frozen source passed `python3 -B tests/canonical-installed-sdk.test.py`
with **36 tests and no failures or skips**, and the existing
`node tests/sdk-build-guards.test.mjs` with **29 tests and no failures or skips**.
The new tests use synthetic packages whose JavaScript deliberately throws if
evaluated. They do not import, initialize or connect the real SDK. An initial
sandbox attempt hit Node-to-Python `EPERM`; its failed log is retained. The
unchanged original controls and the final controls subsequently passed with
local process spawning permitted.

The separate real-install diagnostic compared all **125 files** from retained
`0005` archive `f3cb177c5cb38cd3222b8279e8a9c5815f788d5ccd611a9e8a29d5caefb4bf37`:
116 same-name files and nine exact metadata renames. The full successor gate
still rejected that package for the missing signer-storage identity extension.
This diagnostic did not evaluate SDK code and is not `0007` runtime acceptance.
The original strict-inventory rejection and the clarification of archive-name
versus installed-name digests are also retained.

Exact source and log hashes are in
[`evidence/canonical-sdk-preflight-20261027/proof.json`](evidence/canonical-sdk-preflight-20261027/proof.json).
Internal peer review cleared this source delta, including the final explicit
no-bytecode invocation. The reviewer did not independently rerun the tests.

This guard relies on the reviewed checkout and canonical archive as authority.
It does not authenticate an independently supplied checkout, prevent a separate
process from changing files after verification, or establish runtime, hosted
provider, physical-device or qualified independent security acceptance. The
historical `0006` patch and blocked observation-package helper remain unchanged.
The candidate's release interlock and provider-execution blocks remain in place.
