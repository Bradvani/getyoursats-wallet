# Reconciled SDK and wallet retention work, 27 October 2026

## Decision and provenance

**The SDK source is frozen for an isolated build. Application retention verification is in progress. PR #43 remains draft and production-blocked.** The local results below do not approve the final SDK, enable an unsupported route or establish real-funds readiness. This record must be completed with the compiled package and final CI identities before it is used as release evidence.

The integration preserves these distinct histories:

| Source | What it contributes |
| --- | --- |
| Main `07ddf16068cc5bd7ed09397e221800ad7b12d767` | The deployed welcome-card dismissal and verified-backup behavior |
| Candidate `e827e4a0bdc89245d8539a314e3dc81bdfdccfab` | Original-seed exit funding, experimental deposit continuation and exit signer metadata checks |
| Compiled candidate `76fb6140aaa3712d57c3f57c0c7c2d1303a49171` | The concurrent `0005` package build, retained as source-specific history |
| SDK tree `a1400c1851d4a6e2c274133be0d86d272d6f4586`, patch `f00e39b8` | Strict raw/full-ID evidence, bounded deposit correlation, nonterminal Lightning observation and checked exit envelopes |

The [earlier observation receipt](sdk-observation-hardening-20261027.md) and [concurrent recovery receipt](operation-recovery-progress-20261027.md) keep their original source identities. Their passing tests do not transfer to the combined source. The new cumulative patch is `vendor/patches/0006-reconciled-recovery-source.patch`, applied once to clean upstream `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. It is not applied on top of `0004` or `0005`.

The third source freeze has tree `69c6f813538494a44b25888df3f6fe9923105b2e` and patch SHA-256 `526a66a84989313aa91a391e2681635d147bfa934d8d8310358e19725609e195`. Its 45 changed paths retain the upstream dependency lock with SHA-256 `a4ff9d25f17511301751298d67caa1cd123d2ad220013f14875034ba1311b0b9`. All 221 selected native tests passed across 16 groups, with the complete source checked before and after execution. Twenty Python and 29 Node proof-guard regressions also passed. The six actual WASM bridge tests passed, followed by production WASM compilation without the test feature. Final generated bindings and installed-package browser tests remain pending at this checkpoint.

The verifier checks all four shipped WASM targets for test-runner and fixture exports. A negative control against the actual test binary confirms that required wallet methods do not conceal additional test exports. Production compilation and test compilation remain separate artifacts.

## Attempt ownership and retained uncertainty

The concurrent continuation cannot safely use ordinary cache get/compare/set/readback as an execution lock. Two SDK instances can both pass that sequence, and a delayed initial provider reply can overwrite a newer receiving marker. The combined implementation therefore requires a real compare-and-swap operation for attempt reservation and phase changes, with no fallback to ordinary writes.

The initial intent must win an absent-record reservation before submission. A provider-ID update must replace only the exact original bytes. Receiving must win a transition from the exact eligible intent to its attempted marker before processing. A storage failure, mismatch, lost acknowledgement or cancelled call cannot authorize processing, clear uncertainty or resubmit the economic operation. Exact readback is an additional check after atomic acknowledgement, not a substitute for atomicity.

| Storage path | Intended supported boundary |
| --- | --- |
| Native SQLite | Conditional insert/update against the exact prior value with full synchronous durability |
| Browser IndexedDB | One strict-durability readwrite transaction; success acknowledged only after commit |
| Synced storage wrapper | Forward the atomic operation to the same underlying store |
| WASM/custom JavaScript storage | Explicit `null` for absence and a real boolean acknowledgement; missing method or malformed result fails closed |
| Node SQLite, PostgreSQL, MySQL and other unimplemented adapters | Explicit unsupported error before claim submission or receiving processing |

This coordinates instances sharing one persistent database. It does not coordinate separate devices, restored database copies or provider execution. Realtime synchronization of other records is not a distributed attempt lock. Those limits remain release gates.

Strict receipt validation, bounded discovery and a fresh complete transfer read remain required alongside reservation. The continuation cannot use missing history, an unspent output or an expired prior authorization as evidence that an earlier operation did not execute. Its backend must not expose static-deposit resubmission. The application capability gateway keeps the experimental continuation unavailable.

## Browser adapter verification

The browser storage addition preserves the existing schema and migrations. Both retained baseline adapters are byte-identical to the pinned upstream before this change: SHA-256 `1c4562a4b62898422d4ed11324e9622a337429cc322e030ed502eccd2fc6fc0d`, 99,284 bytes. The revised adapter has SHA-256 `1e9be66757efedb89624faebaf4e6e176ce2c3bb5be2b3cc492bbaeac7fc1349`, 101,819 bytes. Packaging must explicitly copy and hash it in both `web/storage/index.js` and `bundler/storage/index.js`; regenerating WASM does not update these JavaScript files.

Nine local Chromium tests passed against that source adapter with no failed, flaky or skipped result. They cover two independent connections and two tabs, single-winner phase changes, delayed stale replies, close/reopen persistence, abort after request success, commit-before-acknowledgement ordering, malformed inputs and records, unsupported strict durability and exact string comparison. A negative control reproduces two winners with the earlier non-atomic pattern.

The [source-specific receipt](evidence/sdk-storage-cas-20261027/receipt.json) preserves the test log, report and baseline comparison. This is not an installed-package result or a physical power-loss test. The isolated builder requires the same tests against the actual installed adapter in Chromium, Firefox and WebKit. The final PR browser workflow repeats that gate and retains its JSON report outside the directory later Playwright runs clear.

## Original wallet identity and native retention

The application follow-up rejects malformed present mnemonic passphrases before BIP39 coercion or native storage replacement. String passphrases and the SDK's nullish absent representation retain their existing meaning. Malformed stored data receives a distinct non-destructive error instead of being treated as proof of an invalidated OS key.

Native startup, retry, backup and exit-funding reads are being reconciled around one selected storage tier and the active SDK identity. Existing seed records must not be automatically deleted to choose a tier or after an unlock failure. A failed presence/read probe is not evidence of an empty wallet, and unknown presence must not silently remove the existing PIN. Explicit, confirmed reset remains a separate user action.

Review found two additional automatic deletion paths in shared native initialization: an absent install marker cleared both vault tiers, while an absent F3 marker cleared the biometric tier and recorded migration completion. Neither marker proves that the saved wallet can be recovered elsewhere or that deletion was authorized. The [initialization correction](native-initialization-preservation-20261027.md) now performs timestamp bookkeeping only, with 195 focused application tests passing at that source revision. It preserves existing F3 metadata without fabricating conversion; an older native rollback target that retains the destructive rules remains unsafe.

A further preflight blocks native label, RP and credential switches before changing the current connection when either saved slot is present or its state is unknown. Onboarding cannot connect over such records, and the two early switch-time vault clears are removed. Forty focused selected-wallet and hook tests passed at this checkpoint. Additional work is in progress to bind native backup/funding access to the actual native PIN/biometric lifecycle and to reject replacement of an existing different seed at the storage boundary. These source-specific test counts overlap; they are not additive totals or physical-device evidence.

The selected tier and active public SDK binding may be retained for coordination; the helper must not retain seed material. Identity checks use the existing seed-compatible SDK signer factory and must reject a changed connection or selected tier across asynchronous reads. Physical iOS/Android behavior remains unaccepted until it is tested on the final application and native plugin versions.

## Remaining execution and release gates

The merged exit checks preserve the complete unsigned transaction, funding and previous-output metadata, existing finalization, sighash metadata and checked fee arithmetic. They do not establish arbitrary signature/consensus validity or implement durable fresh/rebuilt exit construction.

Incoming Lightning observation remains nonterminal and does not release a preimage. The deployed provider's full transfer/execution contract, funded valueless settlement and interruption recovery still need acceptance. Independent qualified review, physical recovery/migration and original-origin update/rollback are also required. No test count, package build or source review in this record substitutes for those gates.

The isolated build workflow uses a read-only build token, an exact source checkout and a separate preservation job. The preservation job must verify the source branch still equals the reviewed build base, accept only the compiled archive, manifest and dependency lock, then make a non-force update to that isolated branch. It does not promote production or rewrite PR #43 automatically.

## Restored source and fresh build requirement

A repository write stalled without acknowledgement while the temporary workspace was removed. The intended tree and isolated branch were then checked through GitHub and were absent. No successful publication or CI run was inferred from that call. A retained 58-file export reconstructed exact application tree `69f3a6b284f02a6958709688709b53cfe7c519bf` on top of `76fb614`; concurrent published acceptance commit `6c695aa6ce3f39a3fb2f0915e10df1ffa0b80129` was subsequently merged without replacing its receipts or source.

The final local SDK archive and its final execution receipts were removed with that workspace. The retained checkpoint records archive SHA-256 `f492891443ba78c21ff790338b508871fb57bf067658e2db25bff489c0854f59`, generated WASM SHA-256 `2d639ee86127b7b16fee337e7528c5731dc9a662e3712bcbc7734d8993aa59d5` and successful local installed checks, including nine Chromium adapter cases. Those original files are unavailable for independent reinspection. These recorded outcomes are historical context, not the evidence for the next release artifact.

The exact cumulative SDK patch, build support and surviving proof-control logs were recovered. The isolated CI build must regenerate the package and all four runtimes, rerun the native/WASM/installed gates and retain fresh receipts before the archive is considered a candidate artifact. Cross-host byte identity is not claimed. The native retention follow-ups are separately committed and tested; their reconstruction boundaries are recorded in the linked native review notes. The final application read-lease wiring and combined candidate CI remain pending at this build-source checkpoint.
