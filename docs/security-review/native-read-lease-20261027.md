# Native PIN policy and backup read authorization

Internal implementation review, 27 October 2026 UTC. This change does not authorize a real-funds release.

## Behavior

Native backup and funding reads can use a foreground read lease that is independent of the browser spending-session flag. The lease contains only an authorization revision. It starts locked until durable PIN policy has been checked. Confirmed absence of a PIN permits foreground reads; a configured PIN requires a current PIN or biometric authentication result.

Backgrounding, page hiding, wallet selection changes and an actual UI lock invalidate pending reads or authentication completions. The configured UI timeout still determines whether a brief background interval requires another authentication ceremony. A delayed success cannot reopen a wallet after its relevant authorization revision changed.

PIN settings are read strictly. Unsupported record shapes, versions, salt/hash lengths and derivation costs stay unavailable and preserve their original bytes. Only the previously written 100,000-iteration records and current 600,000-iteration records are accepted. A missing local mirror is a UI hint, not proof of durable PIN absence.

PIN policy reads reject during queued or active mutations. Record revisions change at mutation entry and completion. A legacy PIN upgrade must still see the exact serialized record it originally verified before it writes. These checks prevent an old PIN verification or delayed legacy upgrade from surviving a replacement.

Automatic orphan-PIN cleanup checks both the original PIN policy and native read/binding revision after its presence probes. The removal operation checks its precondition again when its queue entry starts. Unknown wallet presence, a newer PIN, an intervening lock or a binding change preserves the record.

Biometric policy changes invalidate pending authentication at entry and completion. A fresh biometric ceremony also checks the durable enabled flag, so a stale React state value cannot authorize it. PIN removal waits for the same biometric mutation queue, preventing an earlier delayed enable from restoring the flag after removal completes.

The backup screen treats PIN-policy errors as a locked state with recovery guidance and an explicit retry. It captures read authorization across asynchronous seed reads and clears displayed words, privacy acknowledgements and pending reveal results when native authorization changes. An old PIN-gate callback cannot reuse a newer render's authorization.

## Evidence and recovery

The original local implementation passed 105 cases across five suites, TypeScript, changed-file ESLint and `git diff --check`. Two policy races were independently reproduced before their fixes: transitional old-PIN verification/legacy overwrite, and stale orphan cleanup deleting a newer PIN. Internal peer review cleared the exact corrected runtime source; an independent after-fix rerun was blocked before process creation and is not claimed.

The transient workspace disappeared before that implementation was committed. The four runtime files were recovered byte for byte, verified against the hashes recorded during peer review:

| File | SHA-256 |
| --- | --- |
| `src/services/nativeReadLease.ts` | `7e815b4c3754388d67d9db4bdc86b85ab5c90e174aff5b0a68b2864cc578405a` |
| `src/services/appLock.ts` | `6c9140b3a0f9e6b23b805c2d079518545b1502885875c5675cfa4121c41d9afb` |
| `src/hooks/useAppLock.ts` | `629c5189e44fcd223c7cb8bc83a6c8d663929e7b094f05c52b7e0eb65649e06d` |
| `src/pages/BackupPage.tsx` | `d99f8adb9af17cd034f55fcf6daf67612a44aa39e2e7d5f5cf0d9f5d5f69a46e` |

The underlying checkpoint was recovered from its retained Git-tree payload. Its tree is exactly `69f3a6b284f02a6958709688709b53cfe7c519bf`, based on `76fb6140aaa3712d57c3f57c0c7c2d1303a49171`. The local reconstruction commit is an archival anchor, not a claim that the original commit identity was recovered.

Test files were reconstructed from retained baseline files, reviewed test bodies and their original intent. They are not claimed to be byte-identical to the lost test files. A fresh run against the recovered runtime source passed all 105 cases: 39 PIN-policy cases, 24 app-lock/read-lease integration cases, 13 lease cases, 5 native-presence cases and 24 backup cases. TypeScript and changed-file ESLint passed after correcting one test-only use of `Array.at` for the project's configured JavaScript target.

## Integration and limits

The original restored checkpoint retained the earlier browser-session check in the shared seed-selection helper. Follow-up `80be6abc3673a2db8cafb8d544869729bc28dfed` completes the native wiring: one entry lease remains bound through selection, vault reads, passkey fallback, exact SDK identity observation and return. Tier, wallet and connection changes revoke pending work without granting access. A fresh PIN unlock cannot revive an older interrupted read.

The native secure-storage connection also verifies an unproven supplied seed against the saved selected record before publishing a connection. Only immutable results of completed startup reads carry one-use weak provenance, bound to selection, connection and authorization revisions. A tier selected during a failed check cannot authorize a later unproven retry. The proof table does not strongly retain seed material. Internal peer review found and cleared that retry defect before the final commit.

The final native gate passed 395 cases across 11 suites, including six cases running the actual PIN policy, PIN verification, app-lock hook, read lease and read helpers with controlled native/SDK responses. The integrated application subsequently passed 1,897 unit tests with one opt-in Bitcoin Core integration test skipped. Type checking passed; lint had zero errors and eight existing warnings. The [source-specific receipt and complete compressed logs](evidence/native-integration-20261027/receipt.json) record two dependency-layout failures that were resolved without application changes or access-control bypass. That integrated run still used the earlier `0005` SDK archive; the rebuilt `0006` package requires its own final combined CI run.

The initial patch left unreadable-PIN handling in Security settings, the export gate and the unilateral-exit screen as separate work. The follow-up in [Native PIN policy consumers](native-pin-policy-consumers-20261027.md) closes those paths and their shared PIN-gate and asynchronous publication boundaries. The original `3cb98be` evidence predates that follow-up.

These tests use real WebCrypto with isolated memory Preferences and mocked native-vault/SDK boundaries. They do not establish physical iOS/Android behavior, native signer isolation, cross-process atomicity, provider execution, recovery on a second device or a safe installed-PWA rollback. The native SDK connection still uses its own signer; this lease is an app-level seed-read boundary. External review and the remaining real-funds release gates stay open.
