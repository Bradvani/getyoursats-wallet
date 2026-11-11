# A01-A03 fresh verification, 28 October 2026 IST

## Verdict and scope

**A01-A03 remain OPEN. This is verification evidence, not independent security approval or production clearance.**

Parent source: `cc9f970f7719f3ebcfee9ec3990d32834fd2f9f2`, tree `bf299e3f9ddf170fdbb7706692d697a6ef841c5f`, the existing PR #43 candidate. A fresh isolated sandbox checked out this exact source. The companion changes add three browser tests, register them in the existing security suite and add this receipt. They do not change application/runtime code, SDK bytes, signing policy, storage schemas, dependencies, production configuration or deployed releases.

Keep this verification change separate from PR #43's current head until reviewed. Its existing funded-regtest profiles and receipts are bound to their original source. Do not reuse or relabel historical evidence for a different commit.

## Fresh results

- Application suite on the clean parent: **2,008 passed, zero failed, one opt-in test skipped**, across 170 files. The skip is not a pass.
- Node service/policy suite: **251 passed**, zero failed or skipped.
- Canonical installed SDK verification and the complete `test:security:wasm` chain: **passed** after provisioning the required Python runtime. No SDK build/connect, funded wallet or operator access was used by the signer checks.
- Actual installed WASM identity checks: 36 comparisons for the mnemonic factory plus 108 for the seed-compatible factory. Mnemonic/passphrase and 32/64-byte raw seed cases are covered.
- Actual installed WASM guard checks: in-flight and subsequent signatures are rejected after session revocation, for mnemonic and both raw-seed variants. This is a software signing boundary, not hardware isolation.
- Chromium browser security suite with the new tests: **10 passed, zero failed/skipped/flaky**. Final run began `2026-10-27T22:10:23.201Z` and took 64.573 seconds.
- Application TypeScript check: passed. The changed configuration lint check had no errors; the repository ESLint policy ignores e2e files, so this is not claimed as independent lint coverage of the new tests. Playwright compiled and executed them.

The native preservation/PIN policy tests in the application total are simulated software tests, not physical-device evidence. Subsets include 20 browser vault tests, 64 gateway tests, 41 journal tests, 16 native SDK recovery tests and 8 browser session-lock tests. Do not add these subsets to the application total.

## New browser regressions

1. An empty, isolated browser context restores the public fixture into a separately encrypted vault with a different password. Its compiled SDK signing identity matches the original. Reload removes the unlocked phrase from memory; the old password is rejected and the new password restores the same phrase. The original context's ciphertext stays byte-for-byte unchanged. Neither localStorage contains the plaintext fixture.
2. Real browser WASM can sign while authorized, but locking rejects an in-flight signature and subsequent signatures. Unlocking does not resurrect already-revoked signer handles. Disposal is exercised twice.
3. An uncertain operation survives page reload with the same operation ID and unresolved state. A duplicate submitting record is rejected and another network cannot see that wallet/network-scoped record. This is journal persistence/isolation evidence, not a live settlement/reconciliation test.

New tests block non-local HTTP requests. They never construct/connect an SDK wallet, visit a faucet, claim a deposit, request a withdrawal or send value. Recovery screens are not recorded.

## Still required for closure

**A01:** Complete and verify the legacy SDK/IndexedDB migration and persisted-secret inventory. Recover the original identity together with balance/history after interruption, damaged storage, quota failures, cold start and same-origin rollback. Obtain qualified independent review of the exact packaged SDK.

**A02:** Preserve the universal gateway and explicit containment of unsupported value-moving routes. Complete exact-intent authorization and recovery/exit acceptance for the release scope, including native paths. Verify genuine PIN/biometric/passkey behavior on physical iPhone and Android devices. A same-origin compromise is not defeated by a software wrapper or password dialog.

**A03:** Complete exact-candidate crash/acknowledgement-loss/background/reload reconciliation on every enabled payment route, using authoritative evidence without resending. The prior direct-Spark regtest receipt remains historical and is not repeated or extended here. Provider-wide/cross-device exactly-once behavior is not established by local journaling.

**Release:** Reconcile the candidate with current main, retain all production/unsupported-route interlocks, complete physical clean-device recovery, independent review and controlled same-origin rollout/rollback before production authorization.

The previously paused external-operator preflight remains paused. No operator approval was bypassed. No mainnet funds, real-user credentials, stored user wallets or production deployment were touched.

## Reproduction and retained limitations

Sandbox: Amazon Linux 2023, Node 22.23.4, CPython 3.13.18, Playwright 1.59.1 and isolated Sparticuz Chromium 149.0.7827.0. The local browser launch adaptation only supplies its executable, runtime libraries, fonts and headless arguments; it does not change application assertions. Firefox/WebKit and physical devices were not rerun in this sandbox. The registered suite inherits the existing three-engine release configuration for subsequent CI.

The initial SDK check stopped because the sandbox Python 3.9 lacked `hashlib.file_digest`. A digest-verified upstream Python 3.13 runtime resolved this without weakening verification. Initial browser checks failed because runtime fonts were not configured; the same seven baseline tests then passed after fixing the environment. The first added guard test incorrectly released a container already owned by the guard; that test-only double free was corrected before the final ten-test pass. None is represented as a production wallet defect or silently counted as a pass.

```sh
npm ci --ignore-scripts
npm test
node --test tests/*.test.mjs
npm run test:security:wasm  # requires Python >= 3.11
npm run test:security:browser
```

Use disposable public fixtures only. A fresh browser context is not a wiped physical device, synchronized passkey-provider restoration, funded balance/history recovery or a live product certification.

## SHA-256 evidence identifiers

These identify the local run records. They do not turn an internal run into independent review.

| Record | SHA-256 |
| --- | --- |
| Application JSON | `b4ffef4fc8d247eef44ee1ceb36980f4c02a520e681372ba541a7cd03f914e9e` |
| Node TAP log | `71bfa8c2a2b67b50f354ff1aa4ea978a9087cdc9a5ce8fb74d61eb88814801ff` |
| Canonical/WASM log | `cc2753c9bbdff98980e4a482d941e6700eba1e4625dd349df47917f47c7b8aa9` |
| Final browser JSON | `bd2735523fa9945970a3cb8dba4f0d0bd038af91a1596a4ae75aa624871d3805` |
| Added test source | `72d38c63ddf459262e12e3c901586a628704fadb3498af2b688c733f302a7a0a` |
| Registered security configuration | `144fd6f2e9015b3073ca1f685d45acaface2899e1bf38ca5cdc4061aed4f4f65` |
