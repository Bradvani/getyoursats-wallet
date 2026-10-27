# PR 43 continuation: observation-only synchronization and journal reconciliation

Date: 26 October 2026. Parent: `4120868a79117f7fbd610eded80dde1501e5b550`.
Release decision: **NO-GO remains.** No production build, wallet import or funded transfer was performed.

## Implemented, not yet settlement-approved

The raw-seed/passkey factory from the parent remains in use, preserving the same supported derivation. The SDK now adds `observeWalletState` and `observePayment`. The normal active `syncWallet` implementation is unchanged inside the SDK and is not exposed by the browser facade. Browser refresh maps to `observeWalletState`, which queries owned leaves, token outputs and transfer history without leaf renewal, pending-transfer claims, static-deposit claims, resend workers or a chain broadcast. Public-key derivation and operator-session authentication can still be needed. This is not a claim that the browser performs no cryptographic operations.

The core tree refresh has a separate observation policy after the existing ownership/operator consistency checks. Observation updates the local cache but does not renew leaves or notify active work. It deliberately does not claim incoming payments; fee-bearing incoming settlement still needs a reviewed bounded policy. An older SDK without the observation APIs fails closed; the browser never substitutes active sync.

`observePayment` queries the exact operator/provider transfer rather than reading cached `getPayment`:

- Spark completion requires the operator's Completed state, not merely SenderKeyTweaked. Returned status requires returned ownership and a failed projection.
- Lightning completion requires a 32-byte preimage whose hash matches BOTH the invoice and HTLC. Return requires operator Returned, provider UserSwapReturned and an HTLC returned without a preimage. Generic provider failure never enables repayment.
- Bitcoin withdrawal acceptance is not sufficient. Completion requires a confirmed chain lookup, matching serialized transaction ID and outputs to the originally committed address covering the approved amount. Unconfirmed/not-found/mismatched data remains unresolved. No automatic refund proof is inferred for Bitcoin.
- Every application receipt is checked against the connected public identity, network, payment ID, amount, maximum fee and fresh observation timestamp. A rail-separated SHA-256 recipient commitment is recorded before execution; receipts must match it. Only a digest is persisted, not the invoice, address or preimage.
- Legacy preview journal entries without that recipient binding are retained and remain unresolved. Missing records, query errors and contradictory results do not clear the guard. Returned funds are recorded as `returned`, not labelled as paid.
- A session/visibility/connection check is performed after asynchronous validation and immediately before the durable journal update. Origin/wallet Web Locks remain in force.

## Verified in this isolated build

| Check | Result |
| --- | --- |
| Rust observation classifier tests against pinned SDK source | 8 passed |
| Rust release WASM compilation | Passed |
| Full application unit suite | 968/968 passed |
| Security-focused suite (included in full count except the later two commitment vector tests) | 158/158 passed |
| Installed WASM same-wallet derivation/signing and guard regressions | Passed with disposable public fixtures, no network |
| Installed observation API and generated artifact hashes | Passed |
| Chromium security fixtures | 7 passed |
| TypeScript, lint, preview build and diff check | Passed (existing non-blocking warnings retained) |
| `VERCEL_ENV=production` build | Rejected by existing No-Go interlock as expected |

These are code/artifact and mocked-boundary checks, not a claim of real payment settlement or physical device biometric verification. The Rust classifier tests do not replace transport-level testing of the complete operator/SSP/chain integration.

## Reproducibility

Upstream source: `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. The new `vendor/patches/0002-observation-only-wallet-state.patch` is **cumulative**, including the seed-compatible extension; apply it to the pinned clean upstream tree, not after patch 0001. The build script reflects this. Rust 1.95.0 and wasm-bindgen 0.2.120 remain pinned. Node, web and bundler bindings are regenerated from the same compiled WASM. `vendor/getyoursats-sdk-build.json` records per-artifact hashes.

- Cumulative patch SHA-256: `f7bdbc5e83b070b9799b2f5a7ed0e8b820872c674b0e70e12e51bbbdae6beabb`.
- Compiled raw WASM SHA-256: `8c128a71416c6d7d2bd511d8a58f8318ae8b00e335d26392d253d5f1a592aacc`.
- Vendored package SHA-256: `49d7ff48517269ddbfe3607d9816a7233d93a2aabeeb09c111102f999e1beb0b`.

## Remaining production blockers

1. Verify the new query path and receipt proofs against actual operator/provider/chain behavior, including transport failures, stale provider views, reorgs, startup restore and incoming-payment claiming. This work does not enable fee-bearing claims or every formerly restricted receiving flow.
2. Complete explicit refund and unilateral-exit authorization/continuation, including already-signed plans, uncertain broadcasts and wallet-preserving recovery. These essential capabilities are not silently bypassed or claimed finished.
3. Produce and test a vault/journal-compatible rollback artifact on migrated disposable state. A rollback must never reinstate plaintext-only custody or erase pending operations, original records or exit artifacts.
4. Independent review of this cumulative SDK source and final installed artifact; physical iOS/Android/PWA acceptance and separately authorized disposable-wallet settlements. Local regtest currently needs Docker and access to the private upstream Spark operator image; neither was available to this sandbox, and no access credentials were retrieved.
5. Resolve branch/base integration and final UX/localization on a pinned combined candidate without dropping the security policy.

The observer remains a secondary check. The external signer remains same-origin software-backed with revocation controls, not an independently administered or hardware-backed policy boundary. The production interlock remains intact.
