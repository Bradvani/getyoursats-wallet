# Independent SDK continuation review — 26 October 2026

This is evidence and an implementation handoff, not a production security certification. The reviewed application working tree is based on `9d6db8b` / gateway checkpoint `1501110a4f06f26fffc4dcefb1d0085b36920a7e`; it was being integrated concurrently. SDK source is pinned to `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. Record the final application SHA separately before release.

## Verified offline evidence

Command from the wallet root: `node scripts/security/verify-installed-wasm-signers.mjs` (Node 24.22.1).

- Actual installed browser WASM: 36 identity comparisons passed against independent `@scure/bip32` derivation, covering three networks, omitted/0/7 accounts, and disposable mnemonic fixtures with/without passphrase.
- Actual WASM handles through application guard: six assertions passed plus idempotent double disposal. Public key, `isRemote` and message signing work unlocked; a signing result started before lock is withheld; later signing is rejected.
- Browser WASM SHA-256: `4fc7fb24e6244c7b94a6f869425537eaf47fe9ee721d31f273b58495d1554b25`.
- No SDK connect/build, storage backend, network wallet or funded transaction was used. These tests do not verify background worker cancellation, recovery balances or settlement.
- The independent check caught an implementation draft passing account 0. Historical SDK default is account 1 on mainnet, 0 on signet/regtest. The correction uses `undefined`, preserving the original derivation `m/8797555'/{account}'/0'`.

## Isolated SDK patch

`docs/security-review/sdk-default-external-signers-from-seed.patch` adds `defaultExternalSignersFromSeed` without changing the existing mnemonic API. Source patch commit: `3597b9e2df2a450df36270e9938ea85042c2b850`. Apply to SDK base `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. Local isolated branch: `fix/external-signers-from-seed-20261026`, worktree `../sdk-external-signers-from-seed`.

The factory reuses the exact seed-to-bytes and account/identity derivation selected by the SDK's seed-based builder. In this SDK, `Seed::Entropy` is already BIP32 seed material. It must not be converted to a BIP39 mnemonic: that derives another wallet. Added Rust tests cover mnemonic/passphrase and 32-/64-byte raw-seed fixtures across networks/accounts, legacy API equivalence, and rejection of entropy-to-mnemonic identity equivalence.

`git diff --check` passed before commit. Attempted `cargo test -p breez-sdk-spark seed_factory --lib` returned exit 127: `cargo: command not found`. `cargo`, `rustc`, `rustup`, and `wasm-pack` were not present on PATH. The patch is **not compiled or runtime-verified**. Run the Rust tests, format/check, then `cargo xtask package wasm::all`, publish/pin an immutable tested artifact and repeat the browser fixture tests with raw entropy through the new export. The offline tests above validate the installed mnemonic factory, not this unbuilt new factory.

## Release decision: No-Go for broad production migration

The containment changes make the development preview safer. They do not yet provide an operational production wallet with verified recovery, live synchronization and all existing recovery routes.

## Release blockers and architecture decisions

1. **Raw-seed/passkey signer lifecycle remains unresolved until a compiled seed factory is integrated.** A mnemonic-only external wrapper cannot silently substitute another wallet. Keeping the original seed path preserves identity but lacks the new callback-level signing veto.
2. **Sync is effectful.** SDK `sdk/sync.rs` resumes already-committed Lightning sends (around line 198) and calls `check_and_claim_static_deposits` (around line 259). Client runtime starts this on SDK build/events. A facade deny list alone does not govern it. Disable automatic background mode/optimizations for a controlled preview, then implement an explicit foreground sync policy. Previously authorized settlement continuation and a new fee-bearing claim need different treatment. A read-only/observation sync SDK option would materially reduce policy ambiguity; simply removing sync leaves balances/history stale and is not a completed wallet release. Freshly restored unsynchronized state must not present zero as a verified wallet balance.
3. **PaymentObserver is a downstream consistency check, never the primary spending boundary.** Gateway authorization owns app requests; callback-level signer revocation prevents new private callbacks while locked. Neither is hardware isolation or protection against malicious same-origin code.
4. **Durable uncertainty is conservative, but incomplete as an operational recovery story.** The new journal preserves pre-submit IDs and keeps failed/missing outcomes blocked. SDK `PaymentStatus::Failed` collapses delivery/preimage/refund states (core `models/adaptors.rs:397–404`) and must not automatically authorize repayment. Cached `getPayment` alone cannot discover fresh settlement. Add explicit status refresh/continuation policy and reviewed resolution evidence before calling reconciliation complete.
5. **Persisted exits are an independent capability outside the SDK facade.** `src/features/unilateral-exit/driver.ts:607–659` broadcasts previously signed transaction packages. The combined preview disables the browser exit engine until a continuation policy exists. That closes the preview execution path but also pauses existing exit operability; it is not a production resolution. Define and persist the prior authorization for continuation, surface progress, preserve access to existing recovery plans, and ensure a new/rebuilt package requires the appropriate authorization. Do not infer coverage from the SDK method deny list.
6. **Disabled operations are safe restrictions, not completed product features.** Refunds, recoveries, conversions, delegated spending, batch/unsigned-package flows and token issuer capabilities require their own intents and evidence before activation. A compatible non-destructive recovery/rollback path is a prerequisite for broad production migration.

Recommended near-term architecture: identity-preserving encrypted vault; one application gateway; permanently revocable per-connection external signer wrappers for both mnemonic and raw seed; owned SDK lifetime; durable operation ledger; explicit incoming/continuation policies; exact SDK pin. A later signer in an independently enforced boundary can provide stronger key control. Same-process software wrappers do not provide that isolation.

## Exhaustive installed `BreezSdk` surface

This inventory contains 70 named methods from the installed WASM declaration. Symbol disposal is separately lifecycle-owned. Status reflects the inspected facade, not proof that a route works end to end. Native SDK entry points and the separate token issuer surface require separate review; `getTokenIssuer` is denied in this browser facade.

| Method | Inspected app exposure | Required treatment |
| --- | --- | --- |
| `free` | Facade passthrough | Lifecycle-owned only: revoke capability first, await in-flight callbacks and disconnect, then release handles. |
| `addContact` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `addEventListener` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `authorizeLightningAddressTransfer` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `bridgeFromCashApp` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `bridgeToCashApp` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `buildUnsignedBatchPackage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `buildUnsignedLnurlPayPackage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `buildUnsignedPullPackage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `buildUnsignedTransferPackage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `buyBitcoin` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `checkLightningAddressAvailable` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `checkMessage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `checkRecoverFunds` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `claimDeposit` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `claimHtlcPayment` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `claimLightningAddressTransfer` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `createTokenAllowance` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `deleteContact` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `deleteLightningAddress` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `disconnect` | Facade passthrough | Lifecycle-owned only. SDK disconnect alone does not prove signer eviction. |
| `exportUnilateralExitState` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `fetchClaimDepositQuote` | Facade passthrough | Quote-only: reads UTXO, fee market and provider quote; does not submit claim. |
| `fetchConversionLimits` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `getCrossChainRoutes` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `getInfo` | Local-read wrapper | Forces `ensureSynced:false`; rejects requests for `true`. With background services disabled, this reflects the latest local state, not proven fresh balances. |
| `getLightningAddress` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `getPayment` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `getTokenIssuer` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `getTokensMetadata` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `getUserSettings` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `importUnilateralExitState` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `listContacts` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `listFiatCurrencies` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `listFiatRates` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `listPayments` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `listTokenAllowances` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `listUnclaimedDeposits` | Facade passthrough | Local SDK deposit records only; does not discover new deposits or claim them. |
| `listWebhooks` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `lnurlAuth` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `lnurlPay` | Gateway | Exact immutable intent + single-use approval + durable pre-submit record; only reviewed Bitcoin/Lightning/plain-Spark variants. Other variants reject. |
| `lnurlWithdraw` | Denied by facade | Incoming provider redemption; creates invoice and executes callback. Requires incoming-flow policy and reconciliation, not an outgoing payment gate. |
| `optimizeLeaves` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `parse` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `prepareLnurlPay` | Gateway preparation | Returns immutable single-use preparation with session/deadline; no spending authorization granted by preparation. |
| `preparePaymentLink` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `preparePullPayment` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `prepareRecoverFunds` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `prepareSendBatch` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `prepareSendPayment` | Gateway preparation | Returns immutable single-use preparation with session/deadline; no spending authorization granted by preparation. |
| `publishSignedLnurlPayPackage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `publishSignedPullPackage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `publishSignedTransferPackage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `pullPayment` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `receivePayment` | Incoming variant wrapper | Allows Spark address, Bitcoin-only Spark invoice, Bitcoin address and Bolt11 invoice; rejects tokens/cross-chain. Clones request and checks session before/after. Generated invoice alone is not settlement; receiving completion depends on the outstanding sync/claim policy. |
| `recommendedFees` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `recoverFunds` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `refundDeposit` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `refundPendingConversions` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `registerLightningAddress` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `registerWebhook` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `removeEventListener` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `revokeTokenAllowance` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `sendBatch` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `sendPayment` | Gateway | Exact immutable intent + single-use approval + durable pre-submit record; only reviewed Bitcoin/Lightning/plain-Spark variants. Other variants reject. |
| `signMessage` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `syncWallet` | Denied by facade | Do not expose as generic read. Full sync resumes committed Lightning sends and claims deposits; needs explicit continuation/claim policy. |
| `unregisterWebhook` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
| `updateContact` | Facade passthrough | Read/metadata/lifecycle capability; enclosing lifetime must reject stale/locked connections. No evidence this grants an outgoing spend. |
| `updateUserSettings` | Denied by facade | Fail closed. Add a reviewed intent/authorization/reconciliation flow before enabling; denial is not implementation coverage. |
