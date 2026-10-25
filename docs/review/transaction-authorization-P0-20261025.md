# Security P0: restored-wallet custody and per-spend authorization
25 October 2026. Current code baseline: main after PR #32.

## What currently works
- Optional native iOS/Android **app unlock**: a 6-digit PIN and optional device biometric preference are available in Settings > PIN & biometric unlock. Biometric enablement requires a PIN and a successful OS prompt.
- Native app lock does not use a biometric-bound signing key. Native device-only seed storage is intentionally not biometric-gated so that the PIN fallback works.
- Browser/PWA imported mnemonic wallets have no wallet-specific lock. Browser storage currently holds a manual mnemonic under the legacy `walletMnemonic` localStorage key.
- The core send hook, LNURL-Pay, cross-chain send, refunds and migration routes execute SDK operations without a single verified per-transaction signing policy. A prompted device unlock is not equivalent to cryptographic transaction authorization.

## Required product behavior
A newly restored wallet keeps **exactly the same existing identity**, history, funds and seed. Native users may enable optional biometric unlock or PIN at any point. Do not replace a restored wallet with a passkey-derived identity: passkeys are only eligible for supported passkey-wallet setup/recovery, not wrapping an existing unrelated recovery phrase.

For every outgoing payment, after the recipient/asset/chain/amount/network fee/total have been verified, require an explicit transaction-specific authorization before the execution boundary. No funds move on cancel, denial, quote expiry, lockout, app backgrounding or changed destination/amount/fee. A second tap cannot reuse an approval. The authenticator must not substitute a new wallet.

## Engineering approach, not yet implemented
1. Audit `docs/review/security-call-sites.json` against live SDK method dispatch, native signer and wallet migration. Explicitly include `useSendPayment.handleSend`, `handleRun`, `wallet.lnurlPay`, cross-chain `wallet.sendPayment`, refund, passkey migration, claim and unilateral exit. Receiving and LNURL-auth/withdraw need separate policies; do not block incoming payments with spend authorization by default.
2. Investigate Breez SDK Spark **External Signer** (`ExternalBreezSigner` and `ExternalSparkSigner`) as the route for hardware-bound key custody and selective approval. A standalone app-level OS prompt before an SDK call is *not* cryptographic authorization: a compromised JS runtime can potentially bypass it.
3. Design a supported browser/PWA encrypted vault for imported mnemonic wallets, including a non-destructive migration, robust offline restore, key-loss fallback and no plaintext persisted secret. Remember encryption at rest does not defend a session from compromised same-origin JS or hostile extensions.
4. Preserve optional app unlock while making *transaction approval* a separately configured/policy-enforced security gate. Specify fallback PIN/device passcode behavior explicitly for each platform. No “Face ID signs this payment” claim unless signer enforcement is proven.
5. Do not roll out the new vault or spending gate until it is tested end-to-end and reviewed independently.

## Verification required before release
- Same imported funded test wallet on two devices: identity, balance, history and recovery preserved.
- Simulated calls to all value-moving SDK entry points: **zero outgoing calls** on failed/cancelled/expired/locked authorizations; bind authorization to exact recipient, amount, fee and quote identity.
- No signer prompts for passive history sync, receive, status reads or automatic incoming crediting.
- Test repeated clicks, stale quotes, disconnected network, iOS Face ID unavailable, Android biometric lockout, passcode fallback, app background/resume, PIN backoff, vault corruption, uninstall/reinstall and device loss.
- Run physical iOS/Android integration tests and tiny-value funded settlement tests. Never log or transmit recovery words, sensitive keys or biometric secrets.

## Status
**Open and not production-ready.** PR #33 is cosmetic/copy only. It does not add authentication or claim that existing transactions are biometric-signed.
