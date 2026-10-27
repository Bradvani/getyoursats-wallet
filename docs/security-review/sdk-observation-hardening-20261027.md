# SDK observation and signing-envelope hardening, 27 October 2026

**Source-specific historical receipt.** This record covers SDK tree `a1400c1851d4a6e2c274133be0d86d272d6f4586` and patch `f00e39b8`. It predates reconciliation with the concurrent `0005` continuation, atomic attempt reservations and the native wallet-retention follow-up. Its 171 native tests and local package checks do not validate those later changes.

This is an internal engineering receipt for a separate SDK build candidate. It does not authorize production deployment, enable receiving routes, certify the wallet or close the real-funds release gate. The application candidate keeps its existing interlock and unsupported receive containment.

The work restores the exact pinned SDK environment, verifies the original extension, then adds stricter evidence reads and signing-envelope validation. It does not submit a deposit, release a preimage, execute an incoming claim, construct a funded exit or retry the retained uncertain deposit.

## Exact source and build identities

| Item | Identity |
| --- | --- |
| Upstream SDK | `breez/spark-sdk@57c5b9e5f0749f97ffe5d93bce21c994f6957cf4` |
| Original cumulative 0004 patch | SHA-256 `280e182624968ddb5755103d28dd0a9a07f867c37cd6b7f0d4ff9c1025da3f55` |
| Revised complete SDK source tree | `a1400c1851d4a6e2c274133be0d86d272d6f4586` |
| Revised cumulative 0004 patch | SHA-256 `f00e39b8013d239a1560ceaf1ac0369fa6519a0ab6f0bd3bd3d271c0ee7e05c8` |
| SDK `Cargo.lock` | SHA-256 `a4ff9d25f17511301751298d67caa1cd123d2ad220013f14875034ba1311b0b9`, unchanged |
| Rust / Cargo | `1.95.0` / `1.95.0` |
| wasm-bindgen | `0.2.120` |
| Local host compiler / protobuf | Ubuntu Clang `18.1.3`, LLVM ar `18.1.3`, protoc `3.21.12` |
| App build-support base | `f5c319882d172ec2710a712aa02f15497b6eb2e7` |
| New package version | `0.1.0-getyoursats.observation.1` |

The complete source snapshot covers 32 files, including the original extension. It was frozen and reviewed before compilation. The source checker compares the entire working tree against `HEAD`, including staged changes and files added by the patch. The build rejects a dirty initial baseline; source checks run before and after compilation, and package generation checks the exact source again. The retained source tree is an identity for those bytes; it is not an assertion that a new SDK source commit was published upstream.

The Rust components and wasm-bindgen binary were obtained from their official pinned releases. Host compiler tools were extracted into isolated scratch from checksummed official Ubuntu snapshot packages dated 28 August 2026. The application dependency versions and SDK lockfile were not upgraded. All local compilation and tests use the restored dependency cache without hosted protocol operations.

## Original extension reconstruction

The original cumulative patch was reconstructed first, before the new source changes. Its six focused native gates passed **52 tests**: seed factory 3, observation 8, signed recovery 8, incoming claims 16, mature deposits 11 and outspend handling 6. The release WASM build and regeneration of web, Node, bundler and Deno bindings completed.

The actual reconstructed WASM also passed 36 mnemonic identity comparisons, 108 raw-seed identity/derivation comparisons, 18 signer lifetime/revocation assertions, the then-existing 12 generated-artifact/API checks and 17 browser PBKDF2 comparisons. These tests did not connect a wallet. The optional Node SQLite adapter emitted its unavailable-module warning in the isolated verification setup; no storage operation was used by these checks.

| Original-extension artifact | SHA-256 |
| --- | --- |
| Historical installed archive | `cbb19e1e16760d63e8cba74a33e21ec75dac6684bc8d389da6c9921b8ba58505` |
| Historical generated WASM | `886b8d0be34acf32569ba9b79171f7fb7b86865b93e8b0b331f55e25ead176d8` |
| Local reconstructed archive | `ca7a377ffc6c9f55c2d925caaf7fb0cfea7025e0ddf0b02cf165be4ab1dcfb00` |
| Local reconstructed raw WASM | `e6e2edb7c05ab726d8c9ebb7b594999d58020a7723d3fbd56d860eedf079db96` |
| Local reconstructed generated WASM | `d1c8a8feabf0e14ace78f5be30f03cac62728b009edbd1810be26f62136d7878` |

All eight generated JavaScript/declaration entry files matched the recorded original-extension outputs. The WASM bytes did **not** match. Section inspection found identical type/import/function/table/global/export/element sections and differences in memory, code, data and producer sections. The binaries embed different Cargo build paths, and the official bindgen release records its source suffix in producer metadata. These observations explain concrete sources of difference, but do not establish complete semantic equivalence or bit-for-bit reproducibility. Passing functional checks has a narrower meaning than binary identity.

The packager now explicitly describes its determinism as normalization of tar and gzip header ownership, timestamps and paths. It does not claim to remove paths embedded in compiled payloads.

## Implemented source changes

### Strict operator evidence before projection

The regular SDK transfer and HTLC helpers can discard malformed records beside valid ones and normalize raw response offsets. They also discard transfer network, authoritative participant summaries and leaf assignment identifiers. A strict observer cannot establish uniqueness or exact economic binding after that information is lost.

New dedicated read adapters preserve the original pagination value, reject invalid/default/nonadvancing continuations, and require every raw row to validate and convert. Transfer pages are bounded to 100 rows, with an additional local limit of 1,000 leaves per observed transfer. Raw transfer validation supports exactly one sender and receiver, matching canonical identities and edge identifiers, the configured network, supported protocol/status values, complete assigned leaf membership, checked value totals and matching backed leaf outputs. Unsupported or contradictory shapes remain unresolved.

The single-receiver status mapping was checked against the public operator source, including intermediate claim states. Exact-ID reads use the existing `QueryTransfersById` protocol method through a new small client wrapper. They require a terminal response and reject duplicates or foreign identifiers. An unavailable method causes an error; there is no fallback to weaker participant-projected evidence.

This distinction is necessary because the separately pinned public operator source receiver-projects participant-filtered history, even when an SDK requests all participants. Its proto does not yet expose that newer flag. The by-ID handler explicitly marshals the full participant set. Source evidence: [full-ID handler and terminal set](https://github.com/buildonspark/spark/blob/0b3a32a05c9ac06cc411683551dd1f1bde9d0caa/spark/so/handler/transfer_handler.go#L2082-L2158), [history pagination and ID-count advancement](https://github.com/buildonspark/spark/blob/0b3a32a05c9ac06cc411683551dd1f1bde9d0caa/spark/so/handler/transfer_handler_mimo.go#L180-L239), [participant/leaf serialization](https://github.com/buildonspark/spark/blob/0b3a32a05c9ac06cc411683551dd1f1bde9d0caa/spark/so/ent/transfer_extension.go#L121-L197), [receiver status mapping](https://github.com/buildonspark/spark/blob/0b3a32a05c9ac06cc411683551dd1f1bde9d0caa/spark/so/mimo/receiver_axis.go#L7-L31). This source reference is not proof of the version deployed by a live operator.

### Deposit correlation and existing pre-claim reads

An uncertain deposit without a retained transfer identifier is observed through at most 100 explicit pages of 100 rows. Failed, empty-continuing, duplicated, stalled, capped or malformed pages cannot return partial success. A candidate receipt is then read again by exact full transfer ID; its provider request identity and economics must remain consistent.

The approved wallet, network, outpoint, funding amount, credit and fee ceiling remain bound to the original stored intent. Funding and credit use exact satoshi units before payment projection, so rounding or a saturated negative fee cannot hide contradictory provider evidence. The original attempt bytes and `receivingAttempted` marker are preserved. Positional arrays, scalar values, unknown or duplicate fields and damaged typed records are rejected.

The observer saves only content-addressed correlation evidence with an intent hash, transfer ID and SSP request ID. It checks storage readback and rechecks the original marker. This cache record is never read as settlement, non-execution or retry authority. A cancellation after the write but before acknowledgment still requires new provider reads. Missing evidence remains unresolved. Read-after-write is not atomic compare-and-swap, and the design does not claim cross-instance execution locking.

The existing mature-deposit path now uses the same strict exact read before its receiving step. The first SSP submission and its one-attempt marker are unchanged. Direct incoming claims use an exact full operator read, strict optional SSP metadata and a complete empty HTLC result before the existing claim step; both the pre-claim and post-claim observation paths use this read. Signing, submission and route enablement are not expanded.

Offset pagination is not an atomic provider snapshot. Backfills, deletions and equal-time reordering can still affect a scan. A positive fresh receipt can improve reconciliation; absence cannot prove that a prior submission did not execute.

### Incoming Lightning observation

The new exported `observeIncomingLightning` method binds one transfer to the wallet/network, invoice and payment hash, gross invoice amount, minimum net credit, maximum fee, SSP identity/request, HTLC and invoice expiry, and operator/HTLC/provider state. It stores a content-addressed binding and permits callers to pin the expected binding hash on later observations. Exact raw operator and HTLC evidence is checked before projection.

Both public outcomes are nonterminal: `awaitingPreimage` and `unresolved`. The method does not claim a transfer, release a preimage or authorize execution. Cached bindings do not replace a fresh read. Provider authentication may establish an authenticated read session; this does not introduce a funds-moving protocol operation. No live authentication or hosted reads were performed by the local tests.

The existing broad preimage-release API still does not implement the required complete bounded receive contract. Incoming Lightning and mainnet receive creation remain contained in the application.

### External exit signing envelopes

Both external PSBT callback paths now validate the exact unsigned transaction, input/prevout metadata and supported witness envelope, preserve already-finalized inputs, and use checked arithmetic for affected fee totals. A callback cannot silently substitute another transaction or funding set through these paths.

This is envelope validation. It does not validate consensus execution or every signature's sighash, persist a durable full build/partial result, authorize all internal leaf-signing steps, or create the missing explicit rebuild lineage. Fresh and rebuilt exits remain blocked pending that larger contract.

## Internal review and verification boundaries

The first source review exposed raw cursor normalization, lossy row conversion and dropped network/participant information. Dedicated raw adapters and full-ID reads address those findings. A later precompile review found a funding-below-credit case that could normalize into an apparently valid zero fee, and the stored-intent parser could accept positional arrays. Both were corrected before centralized compilation, with explicit adversarial and preservation controls. The revised complete source was checked by a separate task peer against all 32 file hashes and the unchanged lockfile. This is internal peer review, not an independent security audit.

The shared build script runs 14 focused native gates and rejects a filter that selects zero tests, omits its success summary, fails the process or produces an unexpected multiple-summary result. Five separate shell-driver controls cover those cases. These controls are not added to native SDK test counts.

The first centralized compile attempt stopped after 136 passing core tests because three test fixtures used a `SecretKey` constructor unavailable in the pinned `secp256k1 0.29.1`. The correction changed only those three constructor calls in two test files, retaining the same 32-byte inputs and assertions. A peer confirmed all runtime source hashes were unchanged. This failed attempt remains in the evidence; it is not counted as a complete pass.

The final frozen source passed **171 unique native tests across all 14 required gates**:

| Crate | Filter | Passing tests |
| --- | --- | ---: |
| `breez-sdk-spark` | `seed_factory` | 3 |
| `breez-sdk-spark` | `sdk::observation::tests::` | 8 |
| `breez-sdk-spark` | `signed_recovery_` | 8 |
| `breez-sdk-spark` | `incoming_claim_` | 16 |
| `breez-sdk-spark` | `mature_deposit_` | 36 |
| `breez-sdk-spark` | `outspend_` | 6 |
| `breez-sdk-spark` | `incoming_lightning_` | 15 |
| `breez-sdk-spark` | `sdk::unilateral_exit::tests::` | 41 |
| `breez-sdk-spark` | `signer::single_key_signer::tests::` | 3 |
| `spark` | `strict_transfer_` | 8 |
| `spark` | `strict_htlc_` | 7 |
| `spark-wallet` | `wallet::deposit_observation::tests::` | 10 |
| `spark-wallet` | `wallet::direct_observation::tests::` | 6 |
| `spark-wallet` | `wallet::incoming_lightning::tests::` | 4 |

Cargo replayed stale compiler-error text from the failed attempt during one later invocation even though the new test binary passed. The stale diagnostic record was retained. The affected test-target fingerprint and executable were then invalidated and rebuilt. A fresh compilation passed the same 8 strict transfer and 7 strict HTLC tests with no compiler errors. These 15 overlap the 171; they are not additional coverage. The original failed log, subsequent full run and clean confirmation are retained separately.

The release WASM build passed on the unchanged final source. All four binding targets were regenerated. The isolated package passed 36 mnemonic identity comparisons, 108 seed/derivation comparisons, 18 application signer lifetime/revocation assertions and 17 browser PBKDF2 comparisons. The installed verifier checked ten methods in both actual Node and initialized browser JavaScript, the new method's actual browser WASM export, five model contracts in all four declarations, and the exact inventory and SHA-256 of all 17 generated files. This build emitted no snippet files; regression fixtures separately exercise recursive snippet inventory. The optional Node SQLite adapter warning remains outside these checks because they do not use storage or construct a wallet.

| Local combined artifact | SHA-256 |
| --- | --- |
| Raw release WASM | `72ad6571525be7c03ea997ecff89b6406468665cdf289088818b28452a37e269` |
| Generated WASM, all four targets | `a72c3295496c8a706ffcc2ac0f9085d612911b35324b66e972efcf400c2392ae` |
| Isolated local archive | `c555e57462ddfd2f902946ee96823b78fed457813da7c5513e40dc3e9f0fa5cc` |

A build-proof review then identified three acceptance-script gaps: staged source could be omitted from an index-relative diff, an outcome union could include an unquoted broad type, and a generated helper or snippet could be omitted from a manifest that checked only listed files. The corrected guards compare against `HEAD`, require the complete two-literal outcome expression, and compare manifest keys to the entire generated-file inventory before checking digests. Symlinks and path traversal are rejected. **Ten Python and sixteen Node regression cases passed**, including controls that demonstrate the old false positives before the new rejection. A separate task peer reran both suites successfully. Guarded repackaging produced the same local archive bytes; the SDK runtime source did not change.

Continuing build checks are `python3 tests/sdk-build-guards.test.py` and `node tests/sdk-build-guards.test.mjs`. The shared build script contains the same native gate function and fourteen filters used locally. The API verification report explicitly states that network calls are not instrumented; it invokes no wallet build, connection, observation, claim or payment methods. Historical static `networkCalls: 0` fields in the unchanged identity/PBKDF2 scripts are descriptions of their intended scope, not measured transport counts.

Machine-readable identities, review resolutions, attempt history, test logs with original digests and any text normalization, and the local generated-artifact manifest are retained in [the evidence receipt](evidence/sdk-observation-20261027/receipt.json). This source/build-support change does **not** replace the repository's existing SDK archive or dependency lock. The local archive is not committed. A separate pinned Actions build must produce and preserve the canonical archive, manifest and lock together before integration into the existing candidate. Its eventual hashes may differ from this local build and must be verified on their own bytes.

## Narrow deployed-method availability check

After the native and WASM checks, the parent task made exactly two bounded anonymous read requests to coordinator zero's `query_transfers_by_id` endpoint using the REGTEST enum. At 00:49:33 UTC on 27 October, an unknown UUID returned HTTP 200, gRPC status 0, zero transfers and offset `-1`; an empty-ID control returned HTTP 200 and gRPC status 3. No session, claim or funds-moving request was created. The [sanitized availability receipt](evidence/sdk-observation-20261027/query-transfers-preflight.json) records those limits and responses.

This establishes that the method and empty terminal response were available at that endpoint and time. It does not prove full-field compatibility for an owned transfer, authenticated SDK access, provider economics, or the deployed operator revision. The public operator commit cited above is a source reference only. Full provider and funded-state acceptance remain open.

## Remaining release work

Three SDK execution contracts remain open: authoritative continuation/terminal evidence after lost deposit acknowledgments, one exact bounded Lightning claim and preimage release, and durable fresh/rebuilt unilateral exit construction. The current read improvements do not fill those contracts by inference.

The final compiled package also needs exact-version provider acceptance, restart/interruption coverage, independent qualified review and physical-device/recovery acceptance. No hosted funding, claim, payment, broadcast, exit, faucet retry or old uncertain-attempt reset occurred in this engineering run. Earlier regtest receipts remain evidence for their original binaries only. The original uncertain deposit and all original operation markers are preserved.
