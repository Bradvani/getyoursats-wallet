# Real-funds adoption candidate integration

Verification date: 26 October 2026 UTC. Local branch: `review/security-adoption-20261027`.

**Latest verification:** [Settlement proof and receive containment](settlement-receive-containment-20261027.md) supersedes the integration state and test totals below. It records the combined implementation `48e1659da9f57cf008e6b22f525cf106fd9aae29`, tree `a7db33b0916a25b6a45af45a36ba2d81ac3484fe`, including corrective PR #56 head `64408512c4c7fd74d81e3f28e129f9a5be87274b`. Its final unit suite has 1,474 passed cases, one opt-in regtest case skipped and zero unhandled errors. The latest receipt also separates the fresh public-regtest outcome from mocked checks. This document preserves the earlier `c5e2b2e` snapshot and does not describe a production deployment.

**Production decision: NO-GO.** This work integrates the existing PR #43 security candidate with current main and closes additional journal and capability defects. It does not approve real funds, waive an audit finding, remove the production interlock or replace independent review. No production wallet, deployed application or real funds were used.

## Exact source inputs

- Existing PR #43 candidate: `63e155f640761f172b583f865b0e9d85b7834d7d`.
- Current main integrated: `b914523ce283d4bd7d3974dcb213cba0531056a6`.
- Journal integrity fix: `30a20f67e6d46f6b7a138a09a699aa5bce706e33`.
- Tested integration implementation: `c5e2b2eb6c4756c97bec04b920b20a40e883874f`, tree `2b2162ba964b90fbeabe2be3c88f2e2271fe22a4`.
- The merge retains the candidate's vendored SDK, guarded connection, encrypted browser onboarding, durable operations and release policy. Main's wallet guide, backup flow, native Lightning name lookup, email verification, QR handoff, navigation and localization changes remain present.

This record supersedes older unit counts and source-integration statements in [takeover-20261026.md](takeover-20261026.md). The historical settlement receipts in [disposable-acceptance-20261026.md](disposable-acceptance-20261026.md) remain distinct evidence; those network transactions were not repeated for this integration.

## Defects closed

### Outgoing journal integrity

The journal now rejects incompatible journal formats and malformed records before selecting a wallet. Unknown or damaged origin records are preserved and prevent unsafe removal or another payment. A new operation can start only at `submitting` and only at an unused identifier. Updates compare their previously read record with the stored record, preserve the original economic binding and reject stale callbacks. A completed or returned operation cannot be reopened, and an uncertain operation cannot return to `submitting`. Unexpected conversion receipts also remain uncertain.

The compare-and-update check runs within the existing origin/wallet Web Locks. It is not a substitute for those locks or cross-device duplicate prevention. Fourteen new regression cases failed against the inherited implementation and passed after the fix. Existing journal/gateway/observation coverage was updated to create records through the permitted lifecycle instead of manufacturing terminal initial records.

### Native Lightning name sessions

Main added a separate short-lived SDK connection for branded names. The integrated candidate replaces its internal seed signer and raw SDK callback with the same-wallet external signer factory, revocable signing lifetime and background-disabled configuration. It checks the seed against the active wallet before constructing a signer, verifies the public identity, and finishes authoritative address recovery before allowing a name claim.

The callback receives a frozen, null-prototype object with only `checkLightningAddressAvailable` and `registerLightningAddress`. It cannot obtain `sendPayment`, `signMessage`, deposit claims or the raw SDK. A retained name capability rejects calls after completion. Every operation checks the current session before and after asynchronous work, and a secondary observer rejects all payments. The name session disconnects and releases its signer before deleting only its randomly scoped temporary database. Failed shutdown remains a connection barrier and retains that database.

These are application controls around software signing. They do not provide hardware isolation or independently administered keys. Live provider acceptance of the narrowed name session on the final SDK has not been established by the mocked tests.

### Email verification and encrypted onboarding

The wallet gateway now supports only the exact existing `gys-email-v1` send/status challenge format, bound to the active public identity and a 36-character hexadecimal server challenge identifier. It checks identity and session both before signing and before returning the proof. Arbitrary messages and the separate native-name proof remain unavailable through the wallet facade.

Browser phrase onboarding encrypts before any connection, then records the wallet guide's verified phrase step only after a non-null successful connection. Failed encryption or connection preserves existing recovery metadata. Legacy plaintext cleanup still requires verified ciphertext for the same phrase. Main's credential registry is not erased by successful phrase enrollment, and a failed wallet removal keeps the wallet screen available.

## Executed verification

The unit and browser fixtures use disposable state or mocked SDK responses. They do not prove funded protocol behavior.

Machine-readable results and retained logs: [adoption-integration-20261027.json](../../evidence/security-review/adoption-integration-20261027.json). The compatible containment manifest is pinned to the implementation commit. Later evidence-only commits do not change the tested application source.

| Check | Result and boundary |
| --- | --- |
| Journal regressions against inherited source | 14 failed before the fix; 14 passed after. Focused journal/gateway/observation suite: 110 passed. |
| Full combined unit suite | 1,395 passed, one opt-in Bitcoin Core regtest case skipped, zero unhandled errors; exit 0. The skipped case is not counted as passed. |
| TypeScript | `npx tsc --noEmit` passed. |
| Repository lint | `npm run lint` passed with zero errors and nine existing warnings. |
| Preview build | `npm run build` passed. Existing ineffective dynamic-import warnings remain. |
| Chromium security | 7 passed: migration, denied spend, reload/password reset, real cross-tab Web Locks, concurrent enrollment and preview states at three widths. |
| Built rollback compatibility | 9 passed: original phrase recovery, byte-preserved storage, malformed records, unsupported versions, network-denying CSP, concurrent/aborted exit persistence and service-worker takeover/cutover behavior. |
| Chromium Send integration | 7 passed. The main scan fixture was run unchanged except for an isolated local origin, with all external network access and SDK mutations prohibited by the fixture. |
| Installed SDK and PBKDF2 | 36 mnemonic identity comparisons, 108 raw-seed derivation comparisons, 18 signer-guard assertions, 12 artifact/API checks and 17 PBKDF2 comparisons passed. No network calls. |
| Production interlock | `VERCEL_ENV=production npx vite build` returned the expected exit 1 with the security-release-not-approved error, before bundling. |

The updated DOM emulator creates an eager rejected `Animation.finished` promise when Motion cancels. The initial full run had passing assertions but 61 unhandled animation errors, so it was not accepted as green. Component tests now use Motion's actual JavaScript animation fallback by disabling the emulator's `Element.animate`; unhandled rejection detection remains enabled. The real Chromium Send suite separately checks the browser animation path and asserts no page errors. This is a test-environment adaptation, not suppression of application exceptions.

### SDK artifact identity

The candidate continues to use the existing pinned SDK. It was not rebuilt or replaced during this integration.

- Browser WASM SHA-256: `886b8d0be34acf32569ba9b79171f7fb7b86865b93e8b0b331f55e25ead176d8`.
- Vendored SDK package SHA-256: `cbb19e1e16760d63e8cba74a33e21ec75dac6684bc8d389da6c9921b8ba58505`.
- Cumulative source-patch SHA-256: `280e182624968ddb5755103d28dd0a9a07f867c37cd6b7f0d4ff9c1025da3f55`.
- Upstream SDK source: `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`; declared build toolchain Rust 1.95.0 and wasm-bindgen 0.2.120.

The prior disposable settlement receipts pin their own actual SDK artifacts. Do not attribute those transfers to this artifact without fresh matching evidence.

## Remaining release blockers

| Boundary | What still needs evidence or implementation |
| --- | --- |
| Fresh or rebuilt unilateral exits | Durable build intent/result contract; authorization of all funding inputs, destination and total fees; original raw-seed signing semantics; interrupted construction/rebuild recovery; actual exit acceptance. Saved signed-byte continuation is narrower. |
| Incoming/uncertain operations | Bounded Lightning and early-deposit execution; definitive settlement or non-execution/return evidence; safe resolution of an uncertain mature-deposit claim. Existing uncertain attempts remain quarantined and must not be resent. |
| Exact final protocol integration | Fresh acceptance for each enabled route against the pinned combined source and SDK; provider/operator failure, stale views, interrupted commitment and restoration. Local/mock tests do not establish these properties. |
| Devices and restoration | Actual iPhone Safari/installed PWA and Android Chrome/installed PWA; existing passkey and imported-phrase restore; real authenticator cancellation/backgrounding; same identity, balance and history on a separate trusted device. |
| Rollout and containment | Original-origin old/new client and cached service-worker rehearsal with the final artifacts. Local Chromium containment tests do not prove that deployed older clients cooperate. |
| Language and accessibility | Complete sensitive security-copy localization, RTL and responsive acceptance for the supported languages. Current main localization does not automatically cover every security screen. |
| Independent approval | A qualified reviewer must review the final source, cumulative SDK patch and exact built artifacts, reproduce the threat-model cases, close findings and record an explicit release decision. Implementer testing is not this approval. |

Retain the production interlock until those boundaries have passed. Keep the compatible containment artifact available, preserve all vault/journal/exit data on failure, and never use a new wallet, plaintext downgrade or storage wipe to make a blocked restoration appear successful.
