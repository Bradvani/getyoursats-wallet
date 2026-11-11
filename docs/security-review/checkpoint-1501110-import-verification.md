# Checkpoint 1501110: import verification and independent test rerun

Verification date: 25 October 2026 UTC.

## Source identity

- Prerequisite: `7db662970a889e3fda7bc4c88b74fe1dab778599`.
- Imported first commit: `347059952d63dc2a3488ae9ec1792f67a0412538`.
- Imported checkpoint: `1501110a4f06f26fffc4dcefb1d0085b36920a7e`.
- Source tree: `99eec743417d3ab746115467b580d3aec8673359`.
- Source branch: `release/browser-pwa-security-localization-20261025`.
- Original uploaded patch: `GetYourSats-7db6629-to-1501110.patch`, 84,710 bytes, 1,209 lines.
- Recomputed patch SHA-256: `3ee367d65ebec903c7d2d8c226d686391e26fddf7b94d3f99b4f9a5a09bfb0b7`, exactly matching the supplied SHA256SUMS manifest.
- All 17 final changed files match the patch's full-index Git blob hashes.
- Imported with `git am --committer-date-is-author-date` using the original Codex committer identity. Both original commit IDs reproduced exactly.
- The Git bundle was not used and its checksum was not independently rechecked. The checksum-verified patch supplied the complete source.

## Independently repeated checks

Executed in an isolated Vercel Sandbox worktree at the exact checkpoint above, with that worktree's own dependency installation:

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts` | Completed |
| `npx vitest run src/security` | 56 passed, 0 failed |
| `npx vitest run` | 855 passed, 0 failed |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed; pre-existing warnings are not security approval |
| `npm run build` | Passed; existing build warnings remain |
| `git diff --check` | Passed |
| Working tree after verification | Clean |

The 56 security tests are included in the 855-test full suite, not additional tests. These results were rerun, not merely copied from the supplied handoff.

## Remote preservation

A one-time GitHub transport workflow verified the patch SHA-256 again, reproduced the same commits and tree, and created the continuation branch only after confirming it was absent. It did not force-update any existing branch, merge a pull request or modify main. The transport branch was deleted after successful publication. Workflow run: `40221202680`.

This evidence document is the only subsequent change on the continuation branch. It does not alter the verified application source at `1501110`.

## Limits and release decision

**NO-GO for production remains in force.** This import is not independent security approval. The tests use disposable fixtures and mocked SDK responses. No real-user wallet, funded transfer, physical-device authentication or settlement was performed. No production deployment or wallet migration was made.

Continue from `docs/security-review/operation-gateway-handoff.md`. Outstanding requirements include completing and accurately gating unsupported routes, durable operation records and uncertain-payment reconciliation, signer lifecycle and internal SDK coverage, non-destructive damaged-vault recovery and rollback, independent review of the installed WASM artifact, real-device acceptance and separately authorized disposable-wallet settlement tests.

The observer remains a secondary consistency check. The browser policy must not be marketed as independent hardware-backed signing or protection from a compromised same-origin application.
