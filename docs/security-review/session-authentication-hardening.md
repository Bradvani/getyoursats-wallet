# Session authentication hardening

Base: phase-one security candidate `7db6629`. This isolated branch does not include the UX release or constitute approval to deploy.

## Changes

Asynchronous unlock operations capture the session generation before verification and recheck it before activating the session or committing decrypted recovery words. Backgrounding, signer replacement or a concurrent vault change causes rejection. Failed unlocks clear the application phrase reference and leave the session locked. A hidden page cannot unlock.

Regression tests cover a lock during identity verification, signer removal during verification, backgrounding during vault decryption, concurrent replacement of the stored vault and foreground-only unlocking. All phrases are public disposable test fixtures.

## Verification

- Focused security suite: 22 tests passed.
- Full suite with branch-local locked dependencies: 821 tests passed across 96 files.
- TypeScript and production build passed.
- The vault test timeout is 20 seconds so production-strength PBKDF2 work can complete on shared CI workers. KDF parameters are unchanged.
- An initial shared-dependency test run failed on Vite's cross-directory WASM asset restriction. Reinstalled the branch's own dependencies and reran.
- A concurrent build/test run exceeded the old five-second crypto-test timeout. Reran successfully after the scoped timeout correction.

## Unresolved release blockers

These changes do not implement complete transaction intent authorization. The raw SDK remains exposed, and recovery/refund/broadcast operations still require a centralized operation policy. The observer remains a secondary veto, not a signing-security boundary. The connected SDK signer is not evicted by this privacy lock. Complete those controls and verify actual SDK behavior before deploying or describing the browser wallet as comprehensively protected.

Next work must bind immutable recipient, asset, network, amount, fees, expiry, wallet identity and a single-use operation ID to authentication at each irreversible application entry point. Inventory and deny unclassified capabilities, cover refund/exit and separately connected migration paths, and disable unapproved automatic spending. Validate rejection at actual signing and broadcast boundaries with disposable wallets. Physical-device and settlement verification remain outstanding; no real user funds or secrets were used.
