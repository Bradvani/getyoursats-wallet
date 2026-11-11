# Payment and exit recovery progress, 27 October 2026

**Source-specific historical receipt.** This document describes concurrent source `e827e4a0bdc89245d8539a314e3dc81bdfdccfab` and cumulative patch `0005`. The subsequent integration must retain strict raw receipt checks and use atomic same-store reservations before executing continuation. The get/compare/set/readback sequence described here does not establish that exclusivity. Results below apply only to their recorded source.

This is implementation evidence, not product acceptance or independent security approval. PR #43 remains draft and production-blocked. The live welcome-card dismissal from main `07ddf16068cc5bd7ed09397e221800ad7b12d767` is retained in this candidate, based on security HEAD `f5c319882d172ec2710a712aa02f15497b6eb2e7`.

## Implemented boundaries

- A new SDK `continueMatureDepositClaim` operation can act only on an existing durable intent with unchanged wallet, network, outpoint, amount and fee ceiling. Fresh authorization is required. It never calls static-deposit submission again. Only a positively correlated transfer in `SenderKeyTweaked`, with no persisted receiving attempt or conflicting refund/claim mandate, can cross the receiving boundary. The boundary is stored and read back before receiving. An uncertain receiving attempt remains blocked. Completed transfers are re-observed before returning settlement. The application capability gateway deliberately does not expose this experimental operation.
- Deposit intent decoding rejects missing, duplicate, unknown or malformed fields. SSP and operator receipts must match transfer ID, wallet, outpoint, both network fields and economics. A real SQLite close/reopen test confirms the receiving-attempt marker survives restart. Read-back and an in-process guard are not a cross-device transactional lock or a proof of provider non-execution.
- Exit PSBT callbacks must preserve the entire unsigned transaction, input UTXOs, sighash metadata and pre-existing signatures. Tests cover changed destination, amount, outpoint, sequence, version, locktime and funding metadata. Positive tests use the built-in signer for both P2WPKH and Taproot. This enforces transaction integrity at the callback boundary, not consensus validity or a complete approved exit construction contract.
- Application exit funding now derives from the original SDK seed variant. Raw bytes are used directly as BIP32 seed material; mnemonic passphrases are preserved. Original seed material is not changed or converted into different recovery words. The flow retains an unlocked flag instead of keeping another mnemonic string merely as a boolean guard.

## Reproducible source and validation

Pinned upstream SDK: `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. The cumulative patch is `vendor/patches/0005-operation-recovery-source.patch`; apply it once to that clean upstream checkout, not on top of patch 0004. All 17 modified SDK files are covered by the source checker. Rust 1.95.0 and wasm-bindgen 0.2.120 are pinned. The existing workflow independently compiles all four runtime bindings and preserves the generated archive, manifest and lockfile on the security branch.

Local native suites passed: seed factory 3, observation 8, signed recovery 8, incoming claims 16, mature deposits 25, outspend 6 and exit signing 28. These are filtered suites, not the complete upstream suite. Application exit tests passed 233 cases across 13 files; the focused funding/driver/gateway suite passed 184 cases. TypeScript and focused lint passed before final packaging. Final artifact checks are recorded below when completed.

The earlier handoff incorrectly described deposit observation as a one-page query. The pinned upstream implementation already automatically paginates without an explicit paging argument. Offset pagination is not an atomic snapshot and absence still never permits retry.

## Outstanding release blockers

1. Lightning transfer binding is not established. In public operator revision [`buildonspark/spark@0b3a32a`](https://github.com/buildonspark/spark/blob/0b3a32a05c9ac06cc411683551dd1f1bde9d0caa/spark/so/handler/lightning_handler.go#L1951), `ValidatePreimage` selects by payment hash, receiver identity and status, then resolves the linked transfer. It does not validate the supplied transfer-ID field. The SDK currently supplies an empty field. This source inspection does not establish which revision or enforcement configuration is deployed. Setting that field alone is therefore insufficient evidence of a bounded Lightning contract; deployed enforcement must be established before activation.
2. Lost static-deposit submission without a positive receipt and interrupted receiving after its stored attempt boundary remain unresolved. Missing history or an unspent funding output cannot authorize a new claim. The previously quarantined regtest outpoint and its journal remain untouched.
3. Fresh/rebuilt exit construction still needs durable intent and result lookup, intermediate signing checkpoints, lineage, exact funding/descendant restrictions and total fee/minimum payout bounds. The new callback checks do not supply these contracts.
4. Full funded product acceptance, interrupted deposit/exit recovery, physical Android/iPhone migration, rollback acceptance and independent security review remain required. Direct Spark settlement and same-profile restart on the final CI artifact are now verified below; they do not cover these remaining paths.

No production promotion is authorized by this document. No real funds or user secrets were used in these offline tests.

## Final local artifact checkpoint

Source update published as `e827e4a0bdc89245d8539a314e3dc81bdfdccfab`, tree `504ee6c787031dfb991c05c1265b320d4959842f`, exactly matching local source commit `f787cb9a82c71ccb260d5a7c0775a048333ac821`. The independently rebuilt SDK workflow is [run 40430048955](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40430048955); it was still running at this checkpoint. Its artifact must be checked separately before acceptance is attributed to it.

The local compiled archive SHA-256 is `35caab4481e30f68bc1165b0037cfbec27b8131383c38d61d48443ec8f361b0a`; cumulative source patch SHA-256 is `0881588afefe212b426854b06dc2b0956c1084bfec9b1981677d93642276baa4`. All four regenerated runtimes passed installed artifact checks. The full application suite passed **1,510 tests**, with **one skipped**. All **seven local browser security tests** passed. TypeScript, preview build and lint completed successfully (lint retained eight warnings and no errors). A production build was explicitly attempted and refused by the existing interlock. Structured evidence is in [operation-sdk-local-validation-20261027.json](evidence/operation-sdk-local-validation-20261027.json).

Fresh disposable-wallet connectivity initially failed because the local browser did not trust the execution environment's network CA. After adding only the CA already supplied to the environment to the local browser trust database and using the configured network proxy, two fresh regtest wallets connected with TLS verification enabled. No certificate-verification bypass was used. Funding and settlement are not established by that connection. The fixture now records sanitized failed-request host/error codes and source-tree/dirty-state metadata.

## Independent CI artifact and genuine direct Spark acceptance

All seven workflows passed for source `e827e4a`: Tests, CodeQL, GetYourSats checks, browser smoke, browser security checkpoint, release security engine matrix and SDK build. The SDK workflow committed its archive, lockfile and manifest as **`76fb6140aaa3712d57c3f57c0c7c2d1303a49171`**, tree `93798dca27800e905fe6548134260fff756b65be`. Its package hash is **`f3cb177c5cb38cd3222b8279e8a9c5815f788d5ccd611a9e8a29d5caefb4bf37`** and browser WASM hash is `fc9bc11b2ef30494aabd6f72c4817be1008b707814b93bb9d91f5cb2dc80d910`. This differs from the local compiler artifact; those hashes are not interchangeable. The exact CI package was installed and independently checked locally: 1,510 application tests passed, one skipped, seven browser security tests passed, all installed-WASM checks passed, TypeScript passed and the preview build passed. See [CI-artifact validation](evidence/operation-sdk-ci-validation-20261027.json).

The new disposable wallets received **1,000 regtest sats**. The initial 100-sat send returned `UncertainPaymentError` while the recipient had an unclaimed transfer. Its SDK payment entry alone was not accepted as settlement: the application journal remained `unknown`. The original failure receipt is preserved in [disposable-spark-operation-20261027.json](evidence/disposable-spark-operation-20261027.json).

The bounded continuation fixture verifies both original wallet identities, the exact SDK package, the original operation ID, amount, zero-fee ceiling and recipient commitment. It never repeats the original send. It explicitly claims the known incoming transfer, reconciles the sender with fresh observations, restarts the recipient, and submits a separately approved 50-sat return. A durable return-attempt marker prevents accidental harness replay. The original acceptance script now handles a positively identified pending send by continuing receiving and reconciliation, never by resubmitting.

**PASS: direct Spark settlement, exact-operation reconciliation, same-profile restart and return transfer on the CI artifact.**

| Operation | Transfer ID | Verified outcome |
| --- | --- | --- |
| Faucet funding | `01a17af2-82f5-7b40-ae7e-d961eac979b7` | 1,000 sats received, zero fee, incoming journal settled |
| A to B | `cc62e536-6124-4abd-9f72-c4c33f75f8ad` | 100 sats received, zero fee, outgoing journal completed |
| B to A | `117da763-c299-49af-b9d6-e6181cf00693` | 50 sats received, zero fee, outgoing journal completed |

Final balances are **A: 950 test sats, B: 50 test sats**. The recipient retained the same identity and its 100-sat balance across a stop/reload/reconnect before returning 50 sats. Both outgoing journals are completed and all three incoming journals are settled. No operation journal was cleared, no unknown outcome was forced terminal and the original send was not resubmitted. The [complete reconciliation receipt](evidence/disposable-spark-reconciliation-20261027.json) records exact states and fixture hashes. This is genuine public-regtest acceptance with disposable software wallets, not a physical-device test or independent security approval. Retained profiles are closed; do not send real funds to these addresses.

## Next funded exit scenario

A read-only cooperative Bitcoin exit preflight on the same verified wallets obtained an executable 500-sat regtest payout quote. The slow tier quoted 750 sats provider fee plus 1,200 sats chain fee: **2,450 sats total** against sender A's **950-sat** balance. No withdrawal or deposit claim was submitted. See [cooperative-exit-preflight-20261027.json](evidence/cooperative-exit-preflight-20261027.json). The quote is short-lived and must be refreshed before any authorization. A 2,000-test-sat top-up would provide a modest buffer for this next scenario, subject to a fresh quote and an explicit fee ceiling. This cooperative-exit test is distinct from the still-missing durable fresh/rebuilt unilateral-exit contract.
