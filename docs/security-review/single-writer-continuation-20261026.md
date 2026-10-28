# Single-writer continuation, 26 October 2026

Started from verified PR43 head `898231b78bbc3c12abac5c19bd3c344a001c5d95` after the owner paused the other writer. This extends the same branch. Production remains **NO-GO**. No merge, deployment, real funds or wallet migration was performed.

## Completed in this change

- Recovery containment now locks on a late service-worker takeover, clears revealed words/password input and invalidates pending decryption. Reveal rechecks control and inventory refresh cannot enable unlock while a worker controls the page. Page restoration checks control again.
- Two actual Chromium service-worker regressions fail against the inherited rollback entrypoint and pass against the correction. One exercises takeover after revealing the public fixture words; the other exercises a controlled page, inventory refresh and explicit operator unregister/reload on a disposable localhost origin. Wallet, journal, exit and IndexedDB fingerprints remain unchanged.
- Remediated the ten dependency advisories reported at the base commit. Pinned Vite 8.3.5, Vitest/coverage 4.1.12, Happy DOM 21.0.4 and Sharp 0.35.5. Refreshed affected transitive dependencies including brace-expansion 5.0.12, source-map-js 1.2.2, Zod 4.6.7 and PBKDF2 3.1.7.
- PBKDF2 is classified as a development dependency through the bundler, but its browser polyfill can enter application bundles. It is therefore tested explicitly: published BIP39 TREZOR vector plus 16 independent Node-crypto comparisons across SHA256/SHA512 and short/block-boundary/long passwords. The vendored SDK, WASM, seed derivation and wallet data formats are unchanged.
- The release dependency job now rejects nonzero advisory totals and missing/error audit evidence. It still uploads evidence on failure. Registry reports describe known advisories at the time of the check, not independent security certification.

## Executed verification

- Full unit suite: 1,075 passed, zero failed, one opt-in regtest case skipped.
- Chromium: seven security cases and nine rollback/backup cases passed. Both newly added regressions failed for the intended assertions against the inherited rollback entrypoint before rebuilding the fix.
- Installed WASM: 144 identity/derivation comparisons, signer revocation/disposal and 12 artifact/API integrity checks passed. Browser PBKDF2: 17 comparisons passed.
- All-dependency and runtime-only npm audit: zero reported vulnerabilities.
- TypeScript, rollback TypeScript, preview build and containment packaging passed. Lint: zero errors, nine existing warnings. The production-build interlock rejected the build as intended.
- Local browser verification used Chromium 153 from a temporary npm-distributed binary because the standard browser download failed. No weakened web-security flags were used. CI must separately verify its pinned browser engines on the published source.

Machine-readable local receipt: `evidence/security-review/single-writer-20261026.json`. Published CI results are separate evidence; no future CI success is claimed here.

## Still unfinished

This resolves dependency triage for the tested lockfile and two containment defects. It does not complete the production-origin rollback procedure: closing old wallet tabs, replacing cached clients, hosted cutover, passkey continuity and real-device acceptance remain to be demonstrated. The rollback artifact stays read-only, refuses service-worker-controlled unlock and never unregisters workers or clears storage automatically.

Fresh/rebuilt browser exits and incoming claims remain denied by the gateway. Enabling existing raw SDK methods is not a fix: they need bounded economic approval, durable intent/result recovery and verified continuation after partial commitment. No new claim or exit signing authority was introduced here.

Actual two-wallet Spark settlement still needs provisioned disposable regtest wallets (or a compatible controlled cluster), both directions, independent restore and exact balance/history/fee evidence. Lightning-provider testing, authorized real-value acceptance, physical iPhone/Android recovery and independent review remain outstanding. The public observation probe is not settlement evidence.

The handoff's uncommitted diagnostic patch was not supplied as bytes or a working link in this thread. Its stated hash was recorded by the owner, but has not been verified or applied here. No older sandbox state was overwritten, no uncommitted remnant was treated as authoritative and no competing writer was observed at the pre-publication head check.
