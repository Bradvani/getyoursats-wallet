# SDK engineering handoff: bounded incoming payments and exit construction

Read-only assessment completed 26 October 2026, 22:49 UTC; application-discovery follow-up integrated later that day. This is an internal implementation handoff for the security candidate, not a production security approval or independent third-party audit. The original assessment did not change source, wallet state, receipts, dependencies or toolchains. The subsequent application-only discovery fix is recorded below. No claim, payment, broadcast or live retry was performed for this handoff.

## Reviewed identities

| Item | Exact identity |
| --- | --- |
| Local review baseline | `1554f07df598f9fe874eb9ed8d7376bcc226b802` |
| Review baseline tree | `483d322a2c2b0b2849ce3c97008ae223db797402` |
| Earlier tested implementation | `48e1659da9f57cf008e6b22f525cf106fd9aae29` |
| Published equivalent review baseline | `2329157c3a8aed401c8602f246c76f6e22ecaf3d`, tree `483d322a2c2b0b2849ce3c97008ae223db797402` |
| Latest combined local implementation | `d0d85e30e4ef48cafa33c5060d1a5ee5450e315c`, tree `ea394118c675700674b8bdc0471abdb8e3f270b6` |
| Pinned upstream SDK | `breez/spark-sdk@57c5b9e5f0749f97ffe5d93bce21c994f6957cf4` |
| Cumulative patch | `vendor/patches/0004-complete-signed-recovery-source.patch`, SHA-256 `280e182624968ddb5755103d28dd0a9a07f867c37cd6b7f0d4ff9c1025da3f55` |
| Vendored SDK archive | SHA-256 `cbb19e1e16760d63e8cba74a33e21ec75dac6684bc8d389da6c9921b8ba58505` |
| Installed browser WASM | SHA-256 `886b8d0be34acf32569ba9b79171f7fb7b86865b93e8b0b331f55e25ead176d8` |

The candidate and artifact hashes were checked locally. Repository links below use the published review tree, which is byte-equivalent to the local review baseline. The SDK patch and exit/deposit contract files are unchanged in the latest implementation. The application discovery change is documented separately below and in [final-main-integration-20261027.md](final-main-integration-20261027.md). No deployment or security approval is asserted. The manifest records the build provenance: [getyoursats-sdk-build.json](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/vendor/getyoursats-sdk-build.json).

## Engineering decision

Three implementation contracts remain incomplete: bounded Lightning receiving, complete recovery of uncertain deposit claims, and durable construction/reconstruction of unilateral exits. The upstream contains Lightning, HTLC, deposit and exit implementations that can be extended. The missing guarantees cross the JavaScript/WASM and provider/operator boundaries, so an application-only approval dialog or journal cannot close them by itself.

| Area | Present capability | Remaining contract | Application-only closure? |
| --- | --- | --- | --- |
| Plain direct Spark receipt | Exact-transfer claim, durable attempted marker, fresh completed observation; application discovery now paginates | Complete treatment of interrupted attempts and authoritative terminal or resumable evidence | The application discovery defect is corrected. Remaining authoritative recovery evidence requires SDK work. |
| Incoming Lightning | Existing invoice, HTLC and preimage protocol internals | One exact bounded receive/claim attempt with durable correlation and fresh settlement/recovery evidence | No, using the current exported methods. |
| Mature deposit | One bounded attempt tied to outpoint, identity, network, maturity and economics | Recover transfer identity after lost acknowledgment; distinguish safe continuation, completion and unresolved state | Pagination improves receipt discovery, but cannot prove non-execution or recover every internal interrupted step. |
| Fresh or rebuilt exit | Quote, multi-transaction signing and exact-byte continuation of saved plans | Durable authorized build intent, partial/result recovery, funding and fee binding, explicit rebuild lineage | Application code can own approvals and UI; the current builder does not expose enough durable execution state for complete interruption recovery. |

## 1. Bounded Lightning and incoming execution

### What the installed extension actually permits

The cumulative patch's `incoming_claim.rs` accepts only an incoming plain BTC `Transfer`, with exact transfer identifier, receiving identity, amount, network and a short expiry. It rejects both SSP user requests and HTLC preimage obligations, then saves and reads back a per-transfer attempted marker before calling `process_transfer`. Its observation reports completion only after a fresh matching operator transfer is completed. The application additionally restricts the payment projection to direct Spark, no conversion and zero fee. This is a useful bounded direct-transfer path, not a bounded Lightning claim. Sources: [incoming SDK extension](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/vendor/patches/0004-complete-signed-recovery-source.patch#L295), [application controller](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/src/security/incomingClaimController.ts#L22).

The protocol building blocks already exist upstream:

- Normal invoice creation generates a payment hash/preimage-share package, requests an SSP invoice, validates invoice fields and then submits encrypted preimage shares to the coordinator before returning. HODL invoice creation uses a supplied payment hash and withholds those shares. Source: [Lightning service](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/services/lightning.rs#L403).
- Public `claim_htlc_payment` takes a preimage, looks for a claimable HTLC with its hash, then invokes `claim_htlc`. It does not take the caller's exact transfer, invoice, amount, economic ceiling or approval deadline. Source: [receive wrapper](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/payments/receive.rs#L327).
- The lower `provide_preimage` RPC supplies payment hash, preimage and wallet identity, but currently sends an empty `transfer_id`. The query RPC can filter by both payment hashes and transfer identifiers. Source: [HTLC service](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/services/htlc.rs#L205).

These are concrete extension points. A nonempty transfer field alone would not prove server-side binding, atomicity or safe retry semantics; those behaviors need verification against the operator contract. This review did not establish that an operator or SSP upgrade is necessarily required, or that SDK changes alone are sufficient for every recovery outcome.

### Minimum required contract

1. Prepare or inspect one receive obligation and expose its exact wallet/network, invoice/payment hash, transfer and SSP correlation where applicable, amount, net credit/fee limits, expiry and HTLC state. Persist the correlation needed to find it after a lost response.
2. Execute one freshly approved intent. Enforce those bindings inside the SDK immediately before the relevant signing, preimage disclosure or remote mutation. Persist and verify the intent before that boundary. Existing broad synchronization must not become the execution route.
3. Provide observation and recovery by the durable operation identity. Distinguish exact settlement, a justified terminal return/non-execution, and unresolved state. A missing record, timeout, empty page or spent/unspent chain observation is not sufficient to clear an attempt guard.
4. Define how an interrupted internal step continues without creating a second economic operation, and retain incompatible or damaged records as blocking evidence.

The application can then connect this contract to the existing foreground approval, wallet lock and journal mechanisms. Merely removing the direct-transfer type checks would expose a protocol path whose obligations the current contract does not authorize.

**Application discovery defect corrected.** The reviewed baseline read only the newest 100 payments, hiding older unattempted pending direct transfers. Commit `60fe2ae06ceda3ae76f32f45224b2b324d002154`, integrated as `3d5923d` before the final `d0d85e30` merge, replaces that read with bounded ascending pagination through one fixed timestamp. Session and connection checks run before and after every page; a failed, stalled or capped scan cannot return partial candidates. Attempted transfers remain excluded, damaged or uncertain records remain blocking, and discovery never starts a claim. Eight added regressions cover 275 mixed payments, overlapping status updates, later-page failure, locks and wallet/connection replacement, and empty-history preservation of uncertainty. The combined focused suite passed 33 cases; final full-suite evidence is recorded separately. Sources: [inherited discovery limitation](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/src/security/incomingClaimController.ts#L54), [current controller](../../src/security/incomingClaimController.ts), [discovery regressions](../../src/security/incomingClaimDiscovery.test.ts).

This resolves the single-page application defect without adding a transactional SDK snapshot or a stable secondary paging cursor. Late backfills, deletions and same-timestamp reordering can still affect a scan. Each chosen claim still requires its own fresh exact-transfer observation; absence from history never releases an attempt guard. This change does not implement bounded Lightning receiving or complete interrupted-claim recovery.

## 2. Uncertain mature-deposit claims

`claim_mature_deposit_once` persists the authorized outpoint before submission, but learns the SSP transfer identifier only when `claim_static_deposit` returns. That identifier is saved in a subsequent storage operation. If the response or that save is lost, `observe_deposit_claim` falls back to transfer history. Correction from the 27 October source inspection: the pinned upstream `TransferService.query_transfers` automatically paginates when no paging argument is supplied, so this is not restricted to one page. Descending offset pagination is still not an atomic snapshot and missing history is not proof of non-execution. The observer intentionally returns only completed/payment evidence and leaves absence unresolved. Sources: [bounded deposit extension](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/vendor/patches/0004-complete-signed-recovery-source.patch#L492), [upstream submission and returned identifier](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/services/deposit.rs#L405).

The remaining contract needs a durable attempt identity recoverable from the authorized outpoint and wallet, complete outpoint-to-transfer correlation, and recovery across both the SSP submission and subsequent receiving claim. The stored `receivingAttempted` boundary must remain meaningful after restart. Complete pagination can locate more positive receipts; it cannot establish non-execution or decide that a lost acknowledgment permits a new claim. If existing provider queries cannot provide authoritative correlation, that requires provider/API work rather than a browser inference.

The retained stranded regtest outpoint must remain untouched. Its chain status does not authorize reset or retry. The candidate's current completed-only reconciliation is appropriately conservative, but it does not complete the product's interruption-recovery requirement. Source: [application reconciliation](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/src/security/depositClaimController.ts#L62).

## 3. Fresh and rebuilt unilateral exits

### Exact construction gaps

The installed `PrepareRecoverFundsRequest` contains fee rate, funding kind, destination and selection. `RecoverFundsRequest` contains the prepared response and funding inputs. Neither carries an application operation identifier, intent commitment, approval deadline or explicit total fee ceiling. The returned recovery contains the signed transaction set, but there is no exported lookup/resume operation for a lost construction result.

The upstream builder confirms why a before/after JavaScript journal is insufficient for full recovery:

- `recover_funds` builds unilateral transactions, may co-sign cooperative recovery, assembles the complete result in memory and returns it. Existing leaf recovery storage is not a complete operation-specific signed result store. Source: [recovery builder](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/recover_funds.rs#L130).
- The unilateral builder follows supplied funding to its current descendants before planning. Thus actual funding can differ from the originally supplied outpoint set. Source: [funding resolution](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/unilateral_exit.rs#L218).
- It signs a fan-out, branch children and a sweep through multiple awaited steps. If refund outputs are not yet available, it deliberately returns an intermediate plan without a sweep and expects a later build. Source: [signing and deferred sweep](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/unilateral_exit.rs#L300).

The signed-recovery controller correctly limits itself to already-saved exact bytes. It preserves an exit requiring `redo` and asks for a newly authorized rebuild. It also requires a final sweep or cooperative payout before considering the recovery complete. These safeguards do not implement the missing builder. Source: [controller boundary and completion checks](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/src/security/signedRecoveryController.ts#L137).

### Minimum required contract

1. Commit a versioned build intent to wallet/network, selected leaves and exit state, destination, exact funding outpoints/values/scripts, acceptable funding descendants if any, minimum payout, and total fee ceiling including fan-out, CPFP and final sweep. Binding only a fee rate is insufficient.
2. Persist construction state before irreversible signing or cooperative mutation, and preserve partial progress and the complete signed result before exposing it for broadcast. Provide lookup or continuation by the same operation identity after interruption. Preserve the original plan when a rebuild is necessary.
3. Treat changed funding, fees, destination, chain-dependent plan or newly constructed sweep as an explicit bounded authorization decision. Link a rebuild to its predecessor and ensure already-used inputs and previous signed bytes cannot be silently replaced or forgotten.
4. Enforce the approved transaction semantics at signing boundaries. Existing CPFP callbacks receive PSBT bytes, and internal leaf signing also occurs inside Rust. All outputs, input ownership and fee changes must remain within the approved contract.

The application can implement approval presentation, lineage display and bounded signer adapters. At this assessment baseline, its legacy funding helper derived only from a mnemonic at `m/84'/coinType'/0'/0/index`; it does not accept the SDK's raw-seed variant. Raw seed bytes must retain their original meaning and must not be converted into new BIP39 words. The already-added SDK seed-compatible signer factory establishes the required distinction. The follow-up in [operation-recovery-progress-20261027.md](operation-recovery-progress-20261027.md) adds variant-preserving application funding derivation; this does not complete durable exit construction. Sources: [funding derivation](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/src/features/unilateral-exit/funding.ts#L47), [seed factory and identity tests](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/vendor/patches/0004-complete-signed-recovery-source.patch#L653).

## 4. Source and build feasibility

The repository retains a usable reconstruction recipe, the cumulative source patch, packaging scripts, provenance and the baseline SDK archive in Git. The baseline archive at `d7b88b33defd4edc44d67060c9584093f9e5e97d:vendor/breeztech-breez-sdk-spark.tgz` was read and hashed during this assessment; it matches the required `4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026`. Exact upstream source files and the complete repository tree were retrievable through read-only GitHub requests.

The build script requires a clean checkout at the pinned upstream commit, Rust **1.95.0**, `wasm32-unknown-unknown`, `wasm-bindgen` **0.2.120**, and the compiler tools used by the existing recipe. It applies cumulative patch **0004 once**, runs locked Rust tests, builds the WASM target and regenerates web, Node, bundler and Deno bindings. Packaging checks the baseline hash and exact complete source diff, preserves the reviewed adapters, and records generated artifact hashes. Sources: [build script](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/scripts/security/build-seed-signer-sdk.sh), [source coverage check](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/scripts/security/check-sdk-source.py), [packager](https://github.com/Bradvani/getyoursats-wallet/blob/2329157c3a8aed401c8602f246c76f6e22ecaf3d/scripts/security/package-seed-signer-sdk.py).

In the current local environment, `rustup`, `rustc`, `cargo`, `wasm-bindgen`, `clang`, `llvm-ar` and `protoc` were not available on PATH. `SDK_WORKTREE`, `WASM_BINDGEN`, `CARGO_HOME`, `RUSTUP_HOME` and `CARGO_TARGET_DIR` were unset. Targeted searches under task scratch and `/tmp` did not locate a full retained SDK source checkout. Node, npm, Python and Git are available. No compiler installation or build was attempted.

**This is not proof that rebuilding is impossible.** The pinned build environment can be restored or the earlier isolated build environment can be re-established without upgrading versions. The repository currently provides the recipe and patch rather than a ready local Rust workspace. Restoring tools would enable implementation work; it would not supply the missing software contracts or prove their correctness.

## Bounded next implementation handoff

Restore the same pinned build environment, implement and review the three operation contracts in the existing source, then rebuild every exported runtime with updated provenance. Before enabling routes, verify interruption at intent persistence, remote acceptance, lost acknowledgment, intermediate signing, result persistence and reload. Evidence must demonstrate exact correlation, preserved original state and no second economic execution under uncertainty. Exit acceptance must cover delayed final sweeps and explicit rebuilds; receive acceptance must use the actual final compiled SDK rather than mocked completion.

The final modified source and rebuilt artifacts require independent qualified review. Physical-device and funded-state acceptance remain separate release work. The current candidate interlock and unsupported receive containment should stay in place while these contracts are implemented. This handoff proposes extensions to the existing protocol and durable state boundaries; it does not authorize a cryptographic rewrite or reinterpret earlier receipts as evidence for new binaries.
