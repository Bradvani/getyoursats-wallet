# Imported browser-wallet protection: staged release candidate

Baseline: main commit 32f3c01b80fb31c19d4a875bc2d7f9fa41ecb4a0.
Candidate: PR #35; SHA recorded on each CI run.

## Implementation scope
- Browser recovery-phrase wallets: encrypt the existing BIP39 phrase with AES-256-GCM and PBKDF2-SHA256 (650,000 rounds, random 16-byte salt, random 12-byte nonce, authenticated AAD). Store ciphertext and non-secret phrase fingerprint, not words.
- Browser startup no longer automatically connects an unencrypted legacy phrase. It asks for a 12+-character wallet password and only removes the old plaintext key after a same-phrase encrypted vault is verified and the SDK successfully connects.
- Fresh manual-wallet creation and recovery-word restore enroll into the encrypted vault before SDK connect.
- Restore the original phrase and change vault password with the same-phrase fingerprint check; a different phrase cannot silently overwrite a wallet.
- Original words remain available after an unlocked session to the existing Backup and unilateral-exit flows, rather than breaking recovery by deleting the legacy key.
- For browser mnemonic wallets only, SDK Builder has a PaymentObserver whose `beforeSend` waits for an explicit user password re-authentication. A refused, failed, timed-out or backgrounded approval rejects. Passwords are not stored.
- No change to native/Passkey connect flow, funds, Bitcoin wallet derivation, network, spend amounts or quote logic.

## Caveats: this is NOT true hardware-backed transaction signing
- The running WASM SDK still holds active signing material in the browser origin. This gate defends against casual app misuse and script-level accidental sends through normal SDK APIs, but not malware, a hostile browser extension or compromised JavaScript.
- Full SDK receipt, refund, unilateral-exit, migration, LNURL and automatic conversion/optimization paths need runtime tracing. The PaymentObserver's behavior at all value-moving boundaries remains unverified on funded wallets.
- Review IndexedDB / SDK session-store persistence and service worker caches. Browser vault encryption alone does not prove that no other signing credential can be replayed.
- The host must use secure HTTPS and a reviewed Content Security Policy. Crypto cannot fix compromised origins.

## Already checked in isolated sandbox
- Full existing Vitest suite: 808 tests passed (95 files).
- Dedicated AES-GCM encryption, incorrect-password, no-overwrite, non-destructive migration, same-wallet recovery and observer rejection tests.
- TypeScript and Vite build success.
- No funded wallet was connected or moved.

## Must pass BEFORE production enablement
1. Manual and previously imported **funded test wallet** identities, balances and history stay identical after migration, reload, a second device recovery and password reset.
2. Simulate every spending route against real Breez SDK WASM code; prove zero executed outbound payments on cancel, wrong password, expired approval, double-click, background and timeout.
3. Confirm SDK observer fires for Lightning, Bitcoin, Spark, stablecoins and LNURL-Pay; independently gate refund, unilateral exit, automated spend, passkey migration and every SDK bypass.
4. Test restart during every vault-write/migration step; no wallet loss, wrong-wallet switching or trapped pending exits.
5. Inspect stored IndexedDB/auth sessions for replayable signing capabilities; verify CSP, PWA caching, mobile Safari and desktop Chrome/WebAuthn behavior.
6. Review risk of the mandatory first-login upgrade for existing users and establish rollback that does not restore plaintext storage.
7. Security review plus small-amount end-to-end mainnet send after pass/fail testing. No private words/screenshots in telemetry.

**Do not merge this candidate to main solely on the passing unit/build suite.**
