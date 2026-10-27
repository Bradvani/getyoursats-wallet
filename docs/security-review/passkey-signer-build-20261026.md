# PR 43: compiled same-wallet signer extension

Date: 26 October 2026. Baseline: `d7b88b33defd4edc44d67060c9584093f9e5e97d`.

## Release decision

**NO-GO remains.** This change completes compilation and browser integration of the raw-seed external-signer factory. It does not authorize production, funded transactions or replacement of an existing wallet. The production-build interlock is unchanged and its rejection was retested.

## What changed

The supplied SDK patch did not compile: its new core factory referenced `Seed` without importing that type. The buildable patch is now `vendor/patches/0001-seed-compatible-external-signers.patch`, applied to source `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. Both the Rust library tests and optimized browser WASM were compiled from that exact worktree with Rust 1.95.0 and wasm-bindgen 0.2.120.

All browser connections now call `defaultExternalSignersFromSeed(seed, network, undefined)` and use guarded external callbacks. This preserves literal mnemonic passphrases, raw BIP32 seed bytes and the SDK's network-dependent default account. No raw seed is converted to new BIP39 words. The passkey/internal-signer fallback has been removed; a factory error fails closed before creating an SDK.

The existing gateway, journal, cross-tab operation policy, lock revocation and identity-preserving reconnect remain in place. This is software policy within the browser origin, **not an independently trusted signer**.

## Artifact provenance

- Original package SHA-256: `4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026`.
- Source patch SHA-256: `e268eb54c8f88b9037cd7d9ce1ce9eaa134b93e7c2af94fa289773777c3fc7d5`.
- Packaged artifact SHA-256: `29746558cedac9579c2668bafe7bc0fcbc7787b30d38009aa7f088ca7bd93072`.
- Browser WASM SHA-256: `f8c465b1ec6b6829dba493a320180ec0088fe6304ad3635a4b5039818e50bbba`.
- The locked dependencies were not broadly upgraded: package-lock changes only the vendored package version and integrity.
- Generated web, Node, bundler and Deno bindings were rebuilt from the same Rust WASM. Functional verification here targets browser WASM and the application's Node-based test environment, not every alternate downstream bundler.
- Baseline storage/module adapters are retained; `package-seed-signer-sdk.py` rejects unexpected source/package versions and emits deterministic archives and a build manifest. `build-seed-signer-sdk.sh` records the reproducible build commands.

## Executed checks

| Check | Result |
| --- | --- |
| Rust factory equivalence tests | 3 passed |
| Installed WASM identity/derivation comparisons | 144 passed |
| Actual WASM lock/revocation checks | 18 passed across mnemonic, raw32 and raw64 handles |
| Full application unit suite | 944 passed |
| Chromium security fixtures | 7 passed |
| TypeScript, lint, preview build | Passed; existing lint/build warnings remain |
| Production build | Rejected by the unchanged security interlock |

Fixtures are public disposable test vectors. No SDK wallet connection, user secret, real-device authenticator or funded settlement was used by the WASM identity tests. Some pre-existing unit fixtures emit refused-network/cleanup diagnostics despite passing; this is not a production penetration test.

## Why packages 2 and 3 remain blocked

Source tracing confirmed that ordinary `sync_wallet` is not an observation-only refresh: it can call `resume_pending_sends`, claim static deposits and enter `SparkWallet::sync`. That in turn refreshes leaves and claims pending transfers. Even `refresh_leaves` can invoke `check_renew_nodes`, so merely calling a lower-level refresh is not proof of no signing. Do not re-enable these APIs as a status lookup.

`get_payment` reads local SDK storage. Its simplified failed state loses important distinctions: it can represent missing preimage or refund/return failures. No failed/absent local record has been reclassified as definitive proof that a payment did not settle.

The SDK refund method signs, stores a pending refund and then broadcasts it. A broadcast error can therefore leave an already-signed recoverable operation. Refund and exit enablement needs exact authorization, durable continuation and a compatible recovery/rollback reader, not a direct pass-through or blanket retry.

These findings explain the remaining development work; they are not proof that the installed binary's whole live execution graph has been independently audited.

## Still required before promotion

1. Controlled live observation/receiving synchronization and definitive payment reconciliation, with runtime tests for each permitted continuation.
2. Refund/exit continuity and vault/journal-compatible rollback, including mixed-client and removal/migration boundaries.
3. Independent review of the final pinned candidate, real-device authentication and separately authorized disposable-wallet settlements.

PR 43 stays draft. No production interlock was disabled and no main-branch merge is included.
