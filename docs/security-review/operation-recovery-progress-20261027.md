# Payment and exit recovery progress, 27 October 2026

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
4. Genuine funded acceptance on the final artifact, interruption recovery, physical Android/iPhone migration, rollback acceptance and independent security review remain required. Unit tests and faucet request acknowledgments are not settlement evidence.

No production promotion is authorized by this document. No real funds or user secrets were used in these offline tests.
