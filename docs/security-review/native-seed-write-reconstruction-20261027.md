# Native seed write preservation, reconstructed 2026-10-27

## Provenance

This change reconstructs the central storage work that was completed before the original workspace was removed. It is newly reconstructed and tested source, not an assertion of byte-for-byte recovery of the lost commits.

| Historical checkpoint | Commit | Tree | Historical verification |
| --- | --- | --- | --- |
| Non-destructive initialization | 69018789d2075f10a3e5cb1306b52800b70d3b28 | 0f0a6d1616ea0257e01c4d630f06bbdc0182159e | Already present in the restored base |
| Create-or-same device writes | cc07b5f3fa62d5749662cc4fa2fbbdea5ea98c47 | d975862b8f44aa7226c20111f721ac437f6984da | 244 cases in 8 suites |
| Exact native error authority | 54abd98344eb581462391e231606070b5c5635a1 | 46ce37f1697d13047a23baefc1211866695f0b44 | 140 storage cases |

The latter two original Git objects and final source bytes were unavailable after cleanup. The surviving historical test logs and recorded identifiers are separate evidence. Those old counts do not validate this reconstruction.

The reconstruction starts at restored commit `27f51ae2a0a22ceb38aee4ef0b3ef1c018d39b84`, exact source tree `69f3a6b284f02a6958709688709b53cfe7c519bf`. Only `src/services/secureStorage.ts`, its tests and this document change. The native read lease, hooks, connection guards, native plugin API, SDK and production settings are unchanged by this patch.

## Storage contract

`deviceOnlyStorage.storeSeed` validates and snapshots incoming seed data before any asynchronous work. A mnemonic must have a string mnemonic and a string or absent passphrase. A raw seed must keep its tagged array representation with integer bytes from 0 to 255. Shape validation does not reinterpret raw bytes, normalize mnemonic text or claim that a mnemonic is cryptographically valid.

Device writes and explicitly requested device clears share one JavaScript singleton queue. Every queued create freshly retrieves the saved device record. Only the native plugin's exact supported string code `NO_STORED_SEED` authorizes writing. A failed presence probe, free-text message, array, boxed string, coercible object or unknown native code cannot supply that authority.

A valid matching seed returns successfully without rewriting its existing envelope, timestamp or additional metadata. A different seed returns the application error `SEED_CONFLICT`. A malformed record returns `INVALID_STORED_SEED`; other native read errors retain their supported typed code or `UNKNOWN`. These failures leave both vault slots intact.

Seed equality compares the literal mnemonic and passphrase, or the raw byte sequence and variant. Only `null` and `undefined` normalize to an absent passphrase. Empty-string versus absent passphrase conservatively conflicts, even though the SDK may derive the same BIP39 identity. Unicode, whitespace and seed variants are not converted.

A native write can commit and lose its acknowledgement. The caller receives the error, no compensating clear or blind retry occurs, and the next queued create reads the retained record. Explicit clear waits for an earlier create so a delayed write cannot resurrect a seed after that clear. Callers continue to own explicit reset confirmation and recovery policy.

The [native initialization preservation contract](native-initialization-preservation-20261027.md) remains in force: missing or unavailable bookkeeping does not authorize erasure or claim a cryptographic migration. The retired bound tier stays readable in place.

## Fresh verification of this reconstruction

The added storage regressions first ran against the restored implementation and reproduced **69 failures with 84 controls passing**. With this reconstructed implementation, **153 storage cases passed**.

The focused caller suite then passed **292 cases across 8 files**, covering storage, native tier selection, PIN policy, funding derivation, native startup/retry, native application lock, Backup and native seed safety. TypeScript with `--noEmit`, changed-file ESLint and `git diff --check` passed.

Commands:

```sh
node_modules/.bin/vitest run src/services/secureStorage.test.ts --reporter=dot
node_modules/.bin/vitest run src/services/secureStorage.test.ts src/services/nativeSeedSelection.test.ts src/services/appLock.test.ts src/features/unilateral-exit/funding.test.ts src/hooks/useBreezSdk.nativeRecovery.test.tsx src/hooks/useAppLock.nativeRecovery.test.tsx src/pages/BackupPage.test.tsx src/getyoursats/nativeSeedSafety.test.ts --reporter=dot
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint src/services/secureStorage.ts src/services/secureStorage.test.ts --report-unused-disable-directives
git diff --check
```

Negative controls cover conflicting passphrases and variants, exact-envelope retention across restart, malformed raw bytes and native responses, 15 malformed or unsupported native error claims, mutable input snapshots, concurrent same/different creates, committed writes with lost acknowledgements, uncommitted write failures, read-failure recovery, and delayed or failed explicit clears. The existing populated-vault and missing-marker controls remain included.

## Boundaries

The queue serializes this JavaScript singleton only. The current plugin has no compare-and-swap or conditional-create API, so the patch does not establish atomic safety across other WebViews, processes or direct plugin callers. No native protocol guarantee is invented.

Fresh checks use mocked native storage and authentication. They do not establish physical-device behavior, Keychain/Keystore concurrency, funded-wallet acceptance, SDK settlement guarantees or an independent external audit. Final integration with the separately recovered native read lease must be verified on the combined source. No funded wallet, seed creation in a real native vault, email, deployment or external mutation occurred during this reconstruction.
