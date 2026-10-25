# Security P0 investigation and decision gate

Baseline: `2c848e8666a415f216fb6a813b107a228345d156`.
Release candidate: the commit containing this document, identified by the PR and CI run SHA. This is an application-source investigation, not an independent audit or a completed vault migration.

## Confirmed application data paths

1. Manual browser import: `RestorePage` -> `App.handleConnect` -> `useBreezSdk.connectWallet` -> `legacyMnemonicMigration.saveMnemonic` -> `localStorage.walletMnemonic`. The helper writes the mnemonic without application encryption. Reconnect reads this value. The backup page also reads it. A UI PIN would not secure that stored secret.
2. Web passkey path: passkey PRF derives signing material and connects the SDK; the app clears its legacy mnemonic cache when a passkey label is supplied. That does not establish that the SDK's IndexedDB/worker storage is free of signing material. `sdkConnect` uses the SDK's default storage. Its compiled implementation and unlocked-session memory require a separate storage inspection.
3. Native path: device-only vault stores the seed through the injected `NativeVault` plugin. The native plugin implementation and signed applications are not in this web repository. The UI PIN/biometric gate is separate from key encryption. Enabling a biometric toggle cannot be described as a transaction-bound signing policy.
4. Native legacy migration: `legacyMnemonicMigration` checks the same seed before deleting the browser copy. Existing vault, PRF label/RP migration, device invalidation, account removal and error paths must be tested on actual builds. The existing code is not authorization to overwrite an imported wallet.
5. Re-derivation and passkey migration: `passkeyMigrationService` has independent BTC/token send calls and settings reapplication. These are value-moving paths outside the everyday Send sheet and need their own authorization/quote binding.
6. Removal: multiple callers reach `wipeAllLocalData`. SDK disconnect, IndexedDB clear, vault clear and settings removal are separate operations. The UI's recovery acknowledgment is not proof that a backup restores. This release strengthens the everyday drawer removal path but does not certify every wipe path or secure erasure.

## Execution boundary inventory

`security-call-sites.json` records explicit application call sites, source file hashes and line numbers. Regenerate with `node scripts/review-security-inventory.mjs`. It includes invoice/Spark/on-chain sends, cross-chain sends, LNURL pay, migration sends, deposit refunds and claims, automatic stable-balance settings, provider purchases, message signing, unilateral-exit broadcast, vault access and account cleanup.

`WalletContext` exposes the raw SDK to consumers. A guard inside the visual Send button would miss other call sites. Current fixes to payment-result interpretation are not authentication. LNURL-auth and withdraw need distinct policies; neither should be classified as an ordinary outgoing transfer merely because it shares a dialog.

## Decision: no silent security migration in this release

Do not ship a browser PIN overlay as a secure vault. Do not create a new PRF-derived wallet to protect an imported wallet. Do not clear a legacy seed until durable same-wallet recovery is independently verified and migration is atomic and recoverable.

The intended design must enforce authorization at every value-moving execution boundary, bind it to one confirmed recipient/asset/network/amount/fee/quote, expire it on changed details and fail closed on cancellation, backgrounding or authentication failure. Native PIN/biometrics and browser WebAuthn/cryptographic storage are different capability paths. A browser authentication prompt can prove user verification but cannot promise protection from hostile same-origin code while unlocked.

Before selecting and activating the persistence/authorization implementation, inspect the installed SDK's secret persistence, all worker/native bridges, every deletion entry point and migration recovery, then test same-wallet identity, balance, existing pending operations and offline recovery. Fresh authentication must not make reconciliation or unilateral-exit recovery impossible. Existing wallets must retain their keys.

## Required acceptance evidence still open

Actual iOS/Android secure-store/biometry tests; browser secret-store inspection; cross-device restore using the same identity; interrupted/corrupt/locked storage migration; zero SDK spend calls after denied authorization on every listed route; changed quote invalidation; app background and cancel; audited vault and dependency threat model. No funded wallet, user's recovery words or real-money transaction was used in this change set.
