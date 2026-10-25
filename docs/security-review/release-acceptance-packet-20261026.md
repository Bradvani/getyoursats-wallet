# PR43 + PR46: release acceptance packet

Date: 26 October 2026. Branch: `release/browser-pwa-security-localization-20261025`.

**Decision: NO-GO. This is an engineering acceptance packet, not a production approval.** Do not remove the production interlock, merge to main, migrate a real user's wallet or move real funds based on this document. The same wallet identities and existing encrypted/exit state must remain intact.

## Pinned implemented packages and executed evidence

| Package | Commit / source | Verification and limit |
| --- | --- | --- |
| Direct Spark source integration from PR46 | `0b565c18b88a4b9fdf99a40d1c492f0be37b76b3`; source PR46 `775f50bbdca20114bff0ebaf239a06685909fee5` | Run `40236816065` passed combined validation before preservation. Six reviewed files integrated without replacing the operation gateway. This is NOT proof of a live two-wallet zero-fee settlement. |
| Guarded refunds, saved signed-exit continuation and durable persistence | `b12209998e83e81663fbdcf83e07ec0fa445afff` | Run `40240276169` passed. Source outpoint/destination/fixed fee are authorized; signed bytes persist before broadcast; uncertain retries reuse bytes, not a new signature. Snapshot-dropping quota fallback removed. New/rebuilt exit packages remain restricted. |
| Compiled refund-signing/inspection SDK | `a9809ad219ae30fb67d984bb76bb9124ef345c7a` | Run `40239417192`: eight refund-envelope, three seed-factory and eight observation Rust tests; release WASM build and installed signer/artifact checks passed. Envelope checks are not a full consensus/signature verification claim. |
| Combined application checkpoint | `73a75542b84744647209607a0fd1a115b32bbead` | Run `40241297962`: 1,007 cases, **1,006 passed and one opt-in regtest case skipped**; seven Chromium security fixtures; types, lint/build and installed WASM verification. Do not report the skipped case as a unit-test pass. |
| Actual Bitcoin Core regtest | `ac016366305abca7d88dc28963749668ab884a88` | Run `40241111792` passed one opt-in integration test using a real local Bitcoin Core 31.1 node, fake regtest coins, lost acknowledgement after acceptance, exact-byte retry, confirmation and reorg checks. Transaction signing is supplied by disposable Bitcoin Core, not live Spark. No real-user wallet/funds were used. |
| Standalone containment rollback | `544e91371124d27c0ee74e5fe9776e86c6ae542e` | Run `40240696627`, artifact `12616713117`: five Chromium checks against the built artifact, actual encrypted fixture migration, original phrase reading and byte-identical localStorage/IndexedDB preservation. Read-only containment, NOT a funds-enabled wallet or a verified service-worker production cutover. |
| Additional recovery hardening/current-main integration | `b375aa00063c6f9ba69392619e7764dbe03f7149` | Separately recorded in `takeover-20261026.md`. Preserve these concurrent changes; do not substitute the earlier controller. |
| Shared vault/spending/removal origin lock | `b4ba4fbfce9b5096374edb23f0dcac866f84f6a5`; tree `281f8a81f887c080f1e1776892d9d736b4bdd063` | Run `40242720619` applies the exact preserved two-file integration to `49d3c5013d2f1fcc7f4c4aada368b78cbc05310a`: **1,075 passed, zero failed, one opt-in case skipped**; six new coordination tests; seven Chromium security cases plus five rollback cases. Types/lint/build/installed-WASM checks and production rejection passed. Lock order is origin then vault; a stale queued enrollment cannot run after a session change. Older cached clients remain a separate problem. |

All counts above are exact receipts, not independent certification. Later documentation and test-infrastructure commits do not imply that unexecuted acceptance cases passed. The source is not a production release candidate until the remaining packages and independent acceptance are complete.

## Compiled SDK provenance

Upstream source `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`, Rust 1.95.0, wasm-bindgen 0.2.120. Apply cumulative patch 0003 to the clean pinned upstream, not after 0001/0002.

- Patch `vendor/patches/0003-signed-recovery-continuation.patch`: SHA-256 `fd6343c48dc8540849d470c692be9326358dfeda674c1b9efca399151feb133e`.
- Vendored SDK archive: SHA-256 `918589d93b57e82a96904e3d213bd5457f7457a2a2e76864946429980bf77d4f`.
- Browser WASM: SHA-256 `4d90b48529a9bb9ef57610f739f05e5240a27b3dc349c25ee2cfd35461b2d751`.

The signer remains same-origin software with revocation and application policy. It is not independently administered or hardware-backed isolation.

## Rollback procedure and limits

The first pinned rollback archive is `getyoursats-containment-rollback-544e91371124d27c0ee74e5fe9776e86c6ae542e.tgz`, SHA-256 `f347a8d1f4addb1dfd6597f5889544a2e668e047f846bb780abe9efd0edb7fa5`. It is available in GitHub Actions run `40240696627`, artifact `12616713117`, with a manifest of every generated file hash.

1. Before rollout, record the exact candidate source, SDK and built artifact hashes. Keep a same-origin containment artifact verified against that candidate's storage formats. A new deployment origin cannot read the original wallet's browser storage.
2. On an incident, stop new enrollment/spending by serving the verified containment artifact at the original origin only after the staged preview/cutover procedure has passed. Do not clear site data, regenerate a wallet, downgrade to a plaintext reader, drop pending journals or erase exit backups.
3. The containment page can authenticate/read an existing v1 encrypted phrase locally and inventory preserved journals/exits. It does not connect the SDK, send, claim, refund, broadcast, repair passkeys or mark a payment settled. Browser network connections are blocked by CSP.
4. An old service worker controlling the page prevents unlock. The operator must complete a separately verified service-worker/version cutover; do not use destructive browser-storage clearing as a shortcut. Old tabs that do not implement new locks are not made safe by the lock's existence.
5. After containment, restore operational service only with a reviewed compatible build and fresh reconciliation. Do not infer that a submitted or missing transaction failed, and do not replace a pending refund/exit with a new one.

A containment artifact is useful incident recovery, but it does not finish operational refund/exit continuity or prove rollback compatibility on every physical device.

## Browser and dependency acceptance is not yet clean

Run `40241585437` passed the Chromium and Firefox security/rollback jobs. WebKit was cancelled during lengthy OS dependency installation; it did not execute acceptance tests.

A later run `40242720569` exposed an intermittent Firefox security-preview assertion at 768 px: the expected stablecoin-unavailable panel was not visible after selecting its tab. The Chromium job passed. Do not erase this failure or claim all browser engines passed based solely on a retry. Diagnose it and rerun the final exact candidate. Physical iOS Safari/PWA and Android Chrome/PWA remain untested.

Dependency evidence from run `40241585437`, artifact `12617210309`, reports zero runtime (`npm audit --omit=dev`) advisories and ten overall advisories (six High, four Moderate), all outside that runtime set. Tooling advisories still need explicit triage/remediation; do not treat runtime zero as an all-dependencies clean bill or broadly upgrade cryptographic dependencies without regression evidence.

## Actual Spark and Lightning testing infrastructure

The repository's local cluster path requires Docker and permission to pull its pinned private `ghcr.io/breez/spark-operator` image. That is one route, not the only possible route.

Breez's official testing guide, checked for this continuation, also documents a public Lightspark Spark regtest network with no API key, a regtest faucet and support for Spark payments/deposits/withdrawals. Its guidance distinguishes Lightning testing, for which it recommends low-value Mainnet tests because the public regtest Lightning network is not developed. Source: https://sdk-doc-spark.breez.technology/guide/testing.html .

A separate disposable public-regtest observation probe is added in `e2e/fixtures/public-spark-regtest.*` and `scripts/security/probe-public-spark-regtest.mjs`. It uses the actual guarded connection and observation path, fresh profiles, no API key and no spending/claim capability. It also inspects the public faucet UI without submitting a form or logging in. Its result must be read from the executed workflow; adding the probe does not establish successful connection, provisioned funds or settlement.

For a definitive Spark settlement run, use an available SDK-compatible regtest deployment, provision two disposable wallets, record A-to-B and B-to-A direct Spark sends, and independently reconcile both balances and transaction histories. Verify actual transfer fees equal zero. No public test success should be generalized to Lightning-provider or Bitcoin Mainnet settlement.

For real-value acceptance, the owner/tester must separately authorize the disposable-wallet budget, routes and recipients and execute the transfers. Do not retrieve production/user keys or put seeds, passwords, full invoices or authentication material in logs/artifacts. Credentials for a private registry/test provider, if needed, belong in a scoped protected CI environment, never this document/chat.

## Independent review and physical-device coordination

Repository Issues are disabled, so the attempted issue was not created. This file is the review packet attached to the existing PR. **No independent reviewer has been appointed or accepted the work.** Nominate a qualified reviewer who did not implement these changes and request review against the final pinned source, compiled WASM and artifact hashes. Owner coordination is not independent security approval.

Required independent scope:

- Audit every signing/broadcast/value-moving route, including fee claims, refunds, saved exit continuation, fresh/rebuilt exits, delegated paths and attempts around the facade. Verify raw capability denial and post-background signer revocation.
- Reproduce approval cancellation, wrong credentials, timeouts, identity changes, concurrent tabs, storage quota/process interruption and uncertain remote commitment. Preserve evidence and prohibit accidental repayment.
- Verify signed refund/exit envelopes, fee/debit budgets, outpoint conflicts, CPFP/dependency graphs, chain reorgs, provider/operator contradictions and exact-byte continuation. Do not equate an output check with consensus signature validation.
- Inspect IndexedDB/session stores, encryption and secondary copies, old cached clients, service-worker cutover and removal/migration coordination.
- Review the cumulative SDK changes, compiler/artifact provenance and dependency advisories.
- Record explicit Go / Conditional Go / No-Go, findings and exact tested SHA. Automated tests, CodeQL and the implementer's own assessment cannot fill this sign-off.

Physical devices: actual iPhone Safari and installed iOS PWA; actual Android Chrome and installed PWA; a separate trusted second device/profile. Exercise original imported mnemonic and existing passkey recovery, real authenticator sheets, cancellation, backgrounding, restart, identity/balance/history preservation and rollback. Desktop WebKit and mobile viewport emulation are not substitutes.

## Unfinished implementation and release gates

- Fresh pending-fee/unsigned exit construction and safe newly authorized rebuilding of diverged signed packages remain restricted. Existing signed-transaction continuation is not all unilateral-exit functionality.
- Fee-bearing incoming claims and complete receive/continuation policy remain unfinished. An observation-only refresh cannot claim incoming funds automatically or grant new spending authority.
- Verify observation/reconciliation against actual Spark operator and Lightning provider behavior, including exact return proofs, stale views, startup restore and partial commitment. The Bitcoin Core regtest does not cover those networks.
- Finish old/new client and service-worker cutover, operational rollback and final sensitive-flow localization/responsive acceptance. Preserve current-main integration rather than overwriting it.
- Nominate and complete independent review; close findings; complete physical-device and owner-executed low-value acceptance.

Automatic internal recipient routing is not implemented by PR46. It needs an authenticated, revocable mapping from a GetYourSats recipient identity to its Spark address, version/expiry checking, explicit route/fee policy and safe consented fallback. A GetYourSats-looking Lightning Address or display name is not proof of an internal Spark recipient. Unrelated Lightning Address/LNURL payments remain fee-aware.

Only after every release-critical gate has evidence should a combined source/SDK/build be pinned as a release candidate, a protected same-origin deployment and compatible rollback be tested, and the interlock removed in an explicit reviewed change. No production promotion is authorized by this packet.
