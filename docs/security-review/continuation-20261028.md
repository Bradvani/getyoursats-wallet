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

## Retained dependency failure and correction

Integrated head `3c76948427fb71392c8eee2059c8c87c5a0414d0` passed the three browser-engine security jobs in [matrix run 40566242359](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40566242359), but its dependency job failed. The run is a failure, not an overall pass. The audit identified [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), a moderate denial-of-service issue affecting `qs` comma-array serialization through 6.16.0. The dependency path is `vite-plugin-node-polyfills → node-stdlib-browser → url → qs`. Although npm marks this path as development tooling, polyfill code can be included in browser bundles. The inspected URL formatter uses repeat-array serialization; a reachable wallet exploit was not established.

The correction updates only the locked `qs` version, tarball and integrity from 6.16.0 to the upstream patch 6.16.1. No package ranges, SDK bytes or vulnerability thresholds change. Fresh full and runtime npm audits report zero advisories. Regression cases exercise hostile object coercion in both comma paths and preserve repeated query formatting through the actual URL polyfill. The failed run and its uploaded audit evidence remain available; successor CI must be checked independently.

Two fresh empty regtest wallets were prepared on `3c76948` with the canonical recovery.3 SDK. No faucet visit, funding, claim or send occurred. Their private checkpoint is retained, but it is bound to that pre-correction source. Do not fund those historical preparation addresses or edit their source binding to reuse them on the corrected candidate. Final-package acceptance requires a newly prepared run on the corrected source.
