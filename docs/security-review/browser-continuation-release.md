# Browser/PWA continuation: implementation and release decision

> Latest combined integration: [adoption-integration-20261027.md](adoption-integration-20261027.md). Historical implementation details below are superseded where the integration, takeover or disposable-acceptance reports record newer work. Production remains NO-GO.

Date: 26 October 2026, Asia/Kolkata (25 October UTC).

**Decision: NO-GO for production. The implementation builds, but this is a restricted security candidate.** No PR was merged, production deployment performed, existing wallet migrated, user seed used or funded transaction initiated.

Development continued directly from remote baseline `9d6db8bb7171c7d76ec2a1fad4e539ef3b457356`, preserving gateway checkpoint `1501110a4f06f26fffc4dcefb1d0085b36920a7e`. The remotely published application implementation is **`fe89915700f1348d762c3a6759fde500c439277c`** on the continuation branch `release/browser-pwa-security-localization-20261025`. Its complete Git tree **`f1f6fc549daa5e88c68b3ed88c302e6c80fc7cc1`** is identical to independently tested local implementation `ca661c4e154cdd5310d391c4d913b721f2f49169`. GitHub assigned a different commit SHA because publication used its commit API. Subsequent documentation-only commits do not change that tested application source.

## Implemented in this continuation

| Workstream | Result | Limits |
| --- | --- | --- |
| Durable outgoing-operation journal | Persisted before SDK submission. Origin-wide and wallet-specific Web Locks serialize spending, reconciliation and removal. Missing, failed, inconsistent and unknown outcomes block another payment across reconnects/tabs. | Origin-local evidence, not cross-device duplicate prevention. Cached lookup cannot establish fresh settlement. |
| Exact-operation gateway | Preserves single-use preparation, immutable intent, identity, network, expiry and quoted fee binding. Missing observer callbacks and mismatched success receipts remain uncertain. | Observer remains a secondary SDK consistency check. Software gateway is not cryptographic isolation. |
| Signer lifecycle | Locks revoke the callable SDK immediately. Mnemonic external-signer callbacks check session before and after async signing. Shutdown attempts disconnect/free/dispose independently; failures block reconnect. | Default software signer still holds keys in process. No memory-zeroization claim. Existing raw-seed/passkey factory requires SDK work. |
| Wallet identity | Mnemonic, passphrase, network and historical default account are preserved. Actual installed WASM independently checked. Reconnect checks public wallet identity. | No live balance/history restore or real-device settlement evidence. |
| Recovery | Handles surviving fingerprints, damaged/empty vault records and malformed hints. Preserves old ciphertext/manifest before replacement and retains legacy plaintext if first encryption fails. Clears form secrets on background. | Both identity records lost means identity cannot be proven locally; original data is preserved and same-phrase recovery uses another trusted profile/device. |
| Removal | Requires an unlocked connected browser SDK; checks every origin journal; holds the spending lock; blocks any active/pending exit data including damaged records. Storage-generation changes invalidate stale connections immediately. | Older cached clients do not participate in the new locks. Cross-version and vault-mutation/removal coordination still require rollout verification. |
| Unavailable routes | Explicit early restrictions for Max, tokens, conversions, cross-chain, unsupported inputs, refunds, exits and browser passkey migration. Stablecoin receive shows an unavailable state before creating a quote/address. | Disabled functions are not completed functions. Refund/exit continuity must work before production migration. |
| Background behavior | Automatic SDK background mode, leaf/token optimization, stable-balance conversion, realtime sync and cross-chain services are disabled in the browser candidate. Active `syncWallet` is denied; balance/history reads are cached. Browser exit engine is paused. | This deliberately leaves live balance/history and pending recovery incomplete. The UI labels the preview and stale-data risk. |
| Deployment control | Vercel production builds fail with a specific release-blocker error. Local and preview builds can run. | Deployment interlock, not a security boundary or protection against manually serving an artifact. Remove only after release gates pass. |

The complete installed SDK inventory covers **70 named methods** in [independent-sdk-continuation-review.md](independent-sdk-continuation-review.md). The exact recovery and rollback procedure is in [browser-recovery-rollout-plan.md](browser-recovery-rollout-plan.md). The earlier `operation-gateway-handoff.md` is retained as a historical checkpoint.

## Verification receipt

Commands were run from the wallet repository against the pinned implementation.

| Check | Command / evidence | Result |
| --- | --- | --- |
| Full unit suite | `npx vitest run` | **942 passed in 105 files**, exit 0. |
| Types | `npx tsc --noEmit` | Passed after gateway/lifecycle/removal integration. |
| Affected TypeScript/TSX lint | ESLint on changed source and tests | Passed, zero errors. Browser fixtures and Node evidence script use separate configs and are ignored by default repository lint. |
| Browser security fixtures | `npm run test:security:browser` | **7 passed**, exit 0. |
| Installed SDK identity and lock guard | `npm run test:security:wasm` | 36 identity comparisons and six guard assertions passed, including repeated disposal. |
| Preview bundle | `npm run build` | Passed. Existing ineffective dynamic-import warnings remain. |
| Production interlock | `VERCEL_ENV=production npx vite build` | Expected exit 1 before bundling; explicit security-release error. |
| Diff integrity | `git diff --check` | Passed. |

Browser verification uses real Chromium with disposable fixtures and mocked SDK responses. At this workstation the executable override is `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/gys-chromium/chromium`; omit it where Playwright's Chromium is installed normally. Traces, videos and screenshots are disabled for the security suite. The seven cases cover denied approval, same-phrase password recovery, two real cross-tab Web Locks/enrollment cases, and explicit preview/receiving states at 390, 768 and 1366 pixels.

The installed browser WASM SHA-256 is `4fc7fb24e6244c7b94a6f869425537eaf47fe9ee721d31f273b58495d1554b25`. The offline script uses actual WASM signer handles but does not connect a wallet, open SDK storage or make network transactions. Identity comparison covers mainnet/signet/regtest, omitted/0/7 accounts and mnemonic fixtures with and without a passphrase. Testing caught and corrected an initial account-0 implementation that would have changed mainnet identity.

The existing `externalLink.test.ts` can log happy-dom iframe/localhost connection errors when its test overlay loads a nonexistent local page. The unit runner reports those tests passed; this harness noise is not evidence of real-browser navigation correctness. Chromium results are recorded separately.

## Four remaining release-critical packages, in dependency order

### 1. Identity-preserving SDK signing support

Modules: `src/services/sdkConnect.ts`, `src/security/guardedExternalSigners.ts`, SDK WASM signer factory.

The installed factory accepts mnemonic strings only. Existing passkey wallets supply raw BIP32 seed material. Converting it to a BIP39 phrase produces a different wallet and is forbidden.

An isolated SDK source patch is included: [sdk-default-external-signers-from-seed.patch](sdk-default-external-signers-from-seed.patch). SDK patch commit `3597b9e2df2a450df36270e9938ea85042c2b850`, base `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. It adds `defaultExternalSignersFromSeed` using the builder's existing derivation and adds equivalence tests. **It is uncompiled:** `cargo test -p breez-sdk-spark seed_factory --lib` exited 127 because Cargo/Rust tooling is absent here. No replacement SDK artifact was invented or installed.

Acceptance: compile/test the patch in an isolated Rust build environment; pin the resulting WASM/package hashes; integrate the new export; independently compare public identity for mnemonic/passphrase and 32-/64-byte raw seed across supported networks/accounts; deny all private callbacks after lock; prove reconnect and recovery preserve the same wallet. This remains application-level software signing protection, not hardware-backed signing.

### 2. Foreground synchronization and definitive payment reconciliation

Modules: SDK sync/runtime; `operationGateway.ts`, `operationJournal.ts`, `useBreezSdk.ts`, `PaymentReconciliationBanner.tsx`.

SDK synchronization can claim deposits and resume already-committed sends. A generic refresh must not silently grant new spending authority. SDK `failed` status also combines materially different failure/return states and cannot justify repayment.

Acceptance: implement an observation-only refresh or explicitly separated, bounded continuation/claim operations. Preserve previously authorized payment identifiers and intent across restart. Require explicit authorization or a disclosed bounded mandate for new fee-bearing claims. Update fresh status without blindly reissuing payments. Resolve a journal block only from exact settlement or definitive funds-return/non-execution evidence; test connection loss before and after remote commit, process death, duplicate submission and cross-tab/network concurrency. Never infer zero funds from an unsynchronized restore.

### 3. Non-destructive recovery, exits and rollback

Modules: vault and browser lock; unilateral-exit engine/driver; removal flow; storage wipe; service worker/update behavior.

Acceptance: implement and persist authorization for previously signed exit continuation; require new approval for new/rebuilt value-moving packages; restore refunds/exits without exposing raw SDK capabilities. Inventory the installed SDK's IndexedDB, session caches and exit backups using disposable state; verify secret-storage boundaries and secondary-copy cleanup. Exercise quota failure, interrupted writes, damaged manifests and identity conflicts; retain original data on every failure. Coordinate storage mutation/removal across tabs and old/new client versions. Build and verify a rollback artifact that understands both the encrypted vault and payment journal. A plaintext-only predecessor is not a safe rollback target. Historical preserved ciphertext remains decryptable by its historical password.

### 4. Independent release acceptance on devices and settlement

Acceptance: review the final combined source and exact SDK artifact; test desktop Chrome/Firefox/WebKit, Safari/iOS PWA and Android Chrome/PWA, including platform passkey-sheet/background behavior. Restore one disposable wallet on a second device and compare identity, balances and history. With explicit small-value test approval, exercise each enabled payment route, uncertain result, cancellation, refund and exit/recovery path. Then integrate the separate UX/localization candidate and test sensitive text/RTL and responsive behavior. Existing unit totals are evidence, not certification.

## Deployment sequence

1. Complete the four packages above on this continuation branch; keep production unchanged.
2. Produce a pinned combined candidate and vault/journal-compatible rollback artifact, with SDK and build hashes and an independent acceptance record.
3. Test a protected preview with disposable state. Refuse real-user migration while live synchronization, signer or recovery gates remain open.
4. After acceptance, remove the production-build interlock in an explicit reviewed change and promote a narrow rollout. Record the predecessor and exact candidate. Monitor operational outcomes without logging seeds, passwords, full invoices or authentication material.
5. On failure, stop new enrollment/spending and preserve vault/journal/exit data. Use the compatible rollback build; never regenerate a wallet, erase unresolved records or restore plaintext persistence as a rollback shortcut.

**Final recommendation: continue development from the pinned implementation, but do not deploy this restricted candidate to production.** The immediate dependency is a compiled, verified SDK signer extension plus the controlled synchronization/continuation design. The completed work and source patch are reusable; the gateway does not need to be rebuilt.


## 26 October continuation: raw-seed factory compiled and integrated

See `passkey-signer-build-20261026.md` and the machine-readable evidence in `evidence/security-review/passkey-signer-build-20261026.json`. The missing `Seed` import in the supplied extension was fixed, optimized WASM was built, original wallet semantics were checked and all browser seed representations now use revocable external callbacks. The internal passkey signer fallback is removed. This closes the compilation/integration task, not final security approval. The other release packages and production interlock remain unchanged.
