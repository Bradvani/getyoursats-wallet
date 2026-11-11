# Native initialization preserves existing wallet records

This application-only correction follows `a5ce7c3911803d3844c02e381ed958bdd47f5226`. It removes two automatic deletion paths in [secureStorage.ts](../../src/services/secureStorage.ts). It does not establish physical-device acceptance, change native encryption policy, or approve real-funds use.

## Finding and policy

The previous shared initialization deleted both native vault slots when the install marker was absent. If that marker existed but the F3 marker was absent, initialization deleted the biometric slot, logged a successful migration, and wrote the F3 marker without converting or verifying the saved record. Merely checking or reading a seed could therefore erase it before the selected-wallet recovery logic ran.

Initialization now performs best-effort non-secret bookkeeping only. It never calls a native seed read, write, conversion or clear method. Missing, malformed or unavailable bookkeeping is not evidence that a surviving wallet is stale, empty or recoverable elsewhere. The subsequent requested vault operation retains its existing typed success or failure result.

| Bookkeeping | Meaning after this correction |
| --- | --- |
| `glow.secureStorageInitialized` | Existing timestamp and localStorage mirror retained for compatibility. Its presence, absence and write success are not evidence of wallet ownership, an empty vault, or encryption policy. |
| `glow.secureStorageF3Migrated` | Historical value left untouched. This client neither reads it to authorize a deletion nor creates it to claim conversion. |
| Old F2 install state | An install timestamp without the F3 marker remains readable through the same plugin methods. There is no separate F2 marker in this abstraction. |
| `resetSecureStorageInit()` | Drops the in-memory bookkeeping memo so a later operation may retry the timestamp. It does not erase or select a wallet. |

The plugin interface exposes no verified legacy-record conversion. Keeping an older record does not prove that it has a newer access-control policy. The selected-tier, exact connected-identity checks and typed recovery failures from the preceding application patch remain necessary. No passkey is assumed to recover an unrelated surviving native seed.

## Explicit reset and compatibility

Explicit `clearSeed()` calls still clear only the requested tier. This patch does not change [UnlockPage's](../../src/pages/UnlockPage.tsx) confirmation and device-owner gate, or the existing account-removal flow. It adds no reset, recovery or migration API.

**Downgrading to older native application code that retains the destructive marker rules is unsafe when markers are missing.** In particular, leaving an absent F3 marker absent can cause that older code to delete the retained biometric record. This correction does not stamp a false migration success to hide that risk. A rollback target must itself preserve native records, or receive a separate verified compatibility assessment before use with them. These unit tests do not validate a downgrade or an OS uninstall/reinstall cycle.

## Regression evidence

[secureStorage.test.ts](../../src/services/secureStorage.test.ts) uses disposable in-memory native vault and Preferences substitutes. Distinct public fixture seeds occupy both vault slots: a mnemonic with a nonempty Unicode passphrase and raw seed bytes. Tests retain the exact serialized records across module restarts and assert zero initialization clear or replacement calls.

Cases cover both slot-read orders, absent markers, old F2 bookkeeping, a localStorage-only timestamp, a historical F3 value without an install timestamp, malformed bookkeeping, independent and combined marker read/write failures, and key-invalidated reads without markers. Controls also verify that initialization does not write or log a completed F3 migration, and that an explicit erase touches only its requested slot.

- Against the preceding implementation, the final targeted regression suite produced **23 failures and 56 passing controls**.
- After the correction, **195 tests passed across eight suites**, including all 79 storage cases plus selected-tier, startup/retry, app-lock, backup, funding, legacy-import and native-seed safety cases.
- TypeScript `--noEmit`, ESLint for both changed source/test files, and the diff whitespace check passed.

All native and SDK operations in these checks are substitutes. No real plugin, biometric prompt, wallet connection, funds, recovery-record deletion, email or network operation was exercised. The result verifies the application initialization boundary, not native cryptography or physical-device behavior.
