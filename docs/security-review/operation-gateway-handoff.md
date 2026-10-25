# Browser/PWA operation gateway implementation checkpoint

Date: 26 October 2026 (Asia/Kolkata)
Branch: `release/browser-pwa-security-localization-20261025`
Starting commit: `3470599` (on top of PR #39 head `7db6629`).
Release decision: **NO-GO pending the explicit blockers below.** This is an implementation checkpoint, not a security certification or production release.

## Implemented

`src/services/sdkConnect.ts` now installs a connection-local operation gateway and SDK observer for every browser connection, including passkey-derived entropy wallets. Callers receive an empty capability facade rather than the raw SDK object. New or unreviewed SDK capabilities are denied by default. The gateway is bound to one connected-wallet identity token, so an old connection cannot use another wallet's authorization state.

`src/security/operationGateway.ts` records preparation provenance in a WeakMap. A fabricated, cloned, mutated, expired, previously consumed or different-session preparation cannot execute. Preparation responses and outgoing arguments are copied and deeply frozen. Approval occurs before calling the SDK, consumes the preparation once and binds a snapshot of network, destination, Bitcoin amount, quoted fee ceiling and debit ceiling. Bitcoin approvals additionally show quote ID, expiry and selected confirmation speed. LNURL approvals include the resolved invoice, displayed recipient and comment.

Session epoch, connection identity, foreground state and deadlines are checked before preparation, after asynchronous preparation, after approval and in the downstream observer. The observer accepts one matching transfer, rejecting changed amount, destination, asset details, duplicate callbacks and autonomous transfers without an active permit. SDK idempotency keys are generated inside the gateway, independently of caller input. This does not provide durable cross-device duplicate detection or prove every internal SDK path runs the observer.

Browser SDK configuration excludes stable-balance auto-conversion and forces the Lightning route for supported invoice sends. Browser passkey migration connections are stopped before their temporary SDK is created. Native builds are outside the release scope.

`useBrowserSessionLock` now covers passkey browser sessions, page suspension and cross-tab vault-storage changes. Passkey unlock checks the same signing identity and rejects ceremonies interrupted by another lock. Both initial connection paths register signer identity in the connection service before exposing the SDK. Pending approval can be cancelled during an asynchronous credential check.

Vault enrollment and recovery now validate the session before committing storage and before activating a decrypted phrase. Interrupted password replacement preserves the original ciphertext. Legacy plaintext removal rechecks the unchanged source record. Password-reset length policy matches enrollment.

## Capability matrix for this checkpoint

| Capability | Current implementation | Remaining verification |
| --- | --- | --- |
| Spark address, BTC, fees excluded | Gateway approval plus exact observer consistency check | Actual WASM transfer and disposable settlement |
| Lightning invoice, fees excluded | Gateway approval, explicit Lightning route and observer consistency check | Installed SDK fee ceiling, error and resume behavior at runtime |
| Bitcoin address, fees excluded | Gateway approval with fee components, quote ID, speed, expiry and observer check | Real quote expiry during signing and final transaction fee verification |
| LNURL-Pay, fees excluded, no conversion | Gateway binds resolved invoice, amount, fees and comment | Real resolver/SDK execution and fee enforcement |
| Spark invoices, tokens, fees-included/Max | Denied | Complete economic-intent model and route-specific SDK tests |
| Cross-chain sends and conversions | Denied | Asset/chain/output/fees/buffer/quote binding and slippage constraints |
| Refunds and pending-conversion refunds | Denied | Exact source outpoint, destination, fee cap, signing/broadcast and interrupted recovery |
| Unilateral exit/recovery signing | Denied | Prepared transaction/CPFP policy, external signer behavior and multi-day recovery mandate |
| Batch, delegated pull and token allowances | Denied | Explicit bounded mandate and revocation policy |
| Unsigned-package construction and signed-package publication | Denied | Independent signer policy plus final package verification |
| Token issuer, message signing and user-settings mutations | Denied | Narrow capabilities and security policy review |
| Browser passkey migration | Temporary SDK connection denied | Whole migration flow must be gated before credential creation; per-wallet sweeps and atomic adoption |
| Balance, history, contacts and selected receiving/read APIs | Explicit allowlist | Incoming claim-fee policy and SDK background-worker inventory |
| Native | Existing platform lifecycle | Separate review; not part of browser/PWA release |

Denied routes remain in the existing UI at this checkpoint and can show an error. This is one reason this branch must not be deployed as a finished product.

## Verification

No user seeds, private keys, credentials or funds were used. Fixtures are disposable/public test phrases and mocked SDK responses.

- `npx vitest run src/security`: 56 tests passed in 5 files.
- `npx vitest run`: 855 tests passed in 98 files.
- `npx tsc --noEmit`: passed after correcting the Bitcoin test fixture's required `source` field.
- ESLint on all security modules and affected connection/App modules: passed.
- `npm run build`: passed. Existing ineffective dynamic-import warnings remain; these are not security-verification results.
- `git diff --check`: passed.

The added tests demonstrate denial at the mocked SDK boundary, observer checks, preparation ownership, replay prevention, stale connection rejection, deadline/session checks, browser mnemonic/passkey connection wiring and lock-interrupted vault writes. They do not independently establish WASM signing behavior or successful settlement.

SDK source used for reasoning is the vendored-source baseline `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. In `sdk/payments/send/bitcoin_address.rs`, refresh uses a 10-second buffer and `affordable_speed` enforces a prepared fee budget. This gateway conservatively reserves 30 seconds of quote validity. `sdk/lightning_sender.rs` passes the selected fee to `pay_lightning_invoice`. These source observations require runtime verification against the installed artifact.

## Release blockers and ordered handoff

1. **Finish the operation inventory before enabling routes.** Extend the intent model and acceptance tests for the denied capabilities above. Do not expose the raw SDK as a workaround. Gate unavailable actions before users enter their flows. Approval must bind complete economic intent and final fees for every enabled route. Add durable operation identifiers and status reconciliation for uncertain execution.
2. **Close signer lifecycle and SDK-internal coverage.** The signer still resides inside the SDK while the UI is locked. Inventory IndexedDB/session/signing material and internal resumed sends, auto claims, leaf optimization and previously persisted exit plans. Prove that backgrounding cannot start new unapproved signing. Completion/rebroadcast of already-authorized committed operations needs a separate bounded continuation policy. Do not promise that lock reverses a submitted payment.
3. **Complete non-destructive vault recovery and rollback.** Use true multi-tab Web Locks tests, process interruption/quota failure tests and all damaged-manifest permutations. If both record and recovery hint are damaged, the current replacement flow still cannot prove identity. Provide a separate verified recovery route without overwriting the old wallet. A rollback build must read the new vault format; never roll back to a plaintext-only reader.
4. **Independent review of the final pinned candidate.** Review this gateway and actual installed WASM. Include direct call/broadcast/signing attempts, cancellation/failure/timeouts, changed quotes, backgrounding before and after SDK invocation, repeated submissions and identity changes. Observer callbacks are secondary checks, not the primary spending-security mechanism.
5. **Real-device and settlement acceptance.** Use a disposable wallet to test iPhone Safari, installed iOS PWA, Android Chrome/PWA and desktop Chrome/Firefox/WebKit. Confirm whether the platform passkey sheet causes visibility changes and that cancellation fails closed without trapping the user. Restore the same disposable wallet on a second device and compare identity, balances and history. Small-value settlement requires explicit approval first.
6. **Integrate UX/localization after security behavior is stable.** PR #40 remains separate. Add supported-device language detection, complete sensitive-flow translations and RTL testing, then test the combined candidate. Do not describe expanded locale catalogs as a complete native-language financial/security review.

## Rollout and rollback requirements

Keep PR #35 and PR #39 unmerged until the blockers are closed. Deploy a protected preview from a pinned combined candidate before any production promotion. Record the production predecessor, candidate artifact and SDK hashes. Validate migration with copied disposable state, including interrupted writes and an older vault-compatible reader. Release narrowly with error/status monitoring that excludes secrets and payment credentials. On problems, stop new enrollment/spending rather than deleting browser storage, regenerating wallets or restoring plaintext secrets. Preserve the new vault reader and recovery route in any rollback build.

No production deployment, funded transaction or existing-wallet replacement occurred during this checkpoint.
