# Continuation from c47ffed

This continuation starts at `c47ffeda0550f08e3cda994bba06c9745adbdc3a` and integrates the current product source from main `826bbd713abebb0d18f4a8b2d64173b4acdee1b2` plus the separately reviewed passkey support release in [PR #63](https://github.com/Bradvani/getyoursats-wallet/pull/63), source `f2e0c747fbc56bdb6a684a3d5863903a38c83f5c`. PR #58 is not included or modified.

## Integration

The current payment receipt, fiat and motion components are retained. Browser route restrictions and the production interlock remain intact. The incoming-payment notice respects both the native app lock and browser session lock, and resets its presentation state on wallet identity changes. An App-level regression exercises visible, locked, unlocked and disconnected states. Browser smoke retains the SDK storage-reservation suite and includes the new main payment suites and passkey guide in all three engines.

The compiled SDK is unchanged: canonical `0007` / `recovery.3`, archive SHA-256 `32715449ed2e670740befe31f0a466b2adc0ab83651f410295a7cb34af55440c`, patch SHA-256 `e56dde90e545646dbce6e6f3218bb67c54084f13110fcbbafdb1eccc211b3eb7`. No historical funded result is transferred to this package.

## Disposable acceptance provenance

The Spark acceptance runner now verifies every installed SDK file against the canonical package and source proof before launching a browser. It refuses dirty source and records the exact source commit/tree, archive, patch, installed inventory, fixture files and local origin.

A fresh run exclusively creates a private evidence directory. It cannot replace an existing run, including an empty directory. Resume requires the exact saved binding and both existing, nonsymlinked profile directories. Missing provenance, changed source/package/origin and redirected profiles fail before a wallet opens. This deliberately refuses old unbound profiles; it is not a migration mechanism. The blocked historical observation harness remains blocked.

`GYS_ACCEPTANCE_PREPARE_ONLY=1` prepares two new empty disposable regtest wallets and closes them without visiting a faucet, requesting funding, claiming or sending. Its result is `READY_FOR_MANUAL_REGTEST_FUNDING`, never a settlement pass. After the user funds the reported address with valueless regtest sats, the same frozen source and evidence directory can resume with `GYS_ACCEPTANCE_RESUME=1`. If a send has already started, the sequence refuses to repeat it; preserve the operation for exact reconciliation. Do not substitute a different source checkout to get past the binding.

An optional `GYS_ACCEPTANCE_PROXY` configures the browser transport. TLS verification is never disabled. Test profiles and secrets stay outside Git and published evidence.

## Local verification and limits

- Integration application run: 2,007 passed, one opt-in test skipped across 170 files. The subsequently added locked-notice case passed in the 13-case App setup suite. These overlapping runs are not added together.
- All 248 Node tests passed, including 12 new acceptance-directory preservation and provenance cases.
- Seven browser security cases passed with the official Chrome for Testing executable.
- TypeScript, build and lint passed; lint retains eight existing warnings.
- Canonical installed SDK, signer/storage/observation checks, source proof controls, 36 canonical-package regression controls and 17 browser PBKDF2 comparisons passed.
- The exact expected production-interlock error was verified. Dirty-source acceptance was rejected before a profile opened.

These are local integration checks, not exact-head remote CI or funded acceptance. Read the new commit's workflows separately. No new wallet funding, transfer, deposit claim or exit had been performed when this checkpoint was written. Physical-device recovery, provider contract evidence, legacy storage ownership/migration, uncertain deposit outcomes, fresh/rebuilt unilateral exits, original-origin rollout and qualified independent approval remain open as recorded in [the release gates](reconciled-release-gates-20261027.md).

The support release is independent of these security gates. Publishing support instructions must not be represented as production approval for this SDK or security branch.
