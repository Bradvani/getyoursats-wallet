# WoS-style custom Lightning aliases — release and security notes
Date: 2026-10-24. **Implemented behind disabled flags. Not enabled for funded users.**

## UX
1. Anonymous self-custody wallet opens immediately without email registration.
2. Breez Spark SDK obtains/registers anonymous `username@breez.tips`. Do not delete it when email is linked.
3. An optional verified email plus a wallet-signed challenge unlocks choosing a unique `username@getyoursats.com` with **no activity, transaction-count, fee or volume threshold**.
4. The GetYourSats address is an LNURL alias that delegates invoice generation to the existing Breez address; Bitcoin stays with the wallet. No seed, passkey or spending authority is uploaded.
5. Until LNURL discovery works on the public root domain, UI must show reservation/pending status, not claim payability.

## Architecture
- GET /api/account/handle advertises whether claims are available; disabled by default.
- POST /api/account/handle issues a fresh signed challenge, checks the *existing* wallet-linked verified email record, validates an SDK-discovered Breez address, atomically stores unique wallet/name bindings in the same Redis.
- GET /.well-known/lnurlp/:username on **getyoursats.com** resolves alias and returns original Breez LNURL payRequest metadata and callback. Do not change metadata, or BOLT11 description hash validation will fail.
- No new SDK wallet or key is created; this does **not** configure `config.lnurlDomain`.
- An address on another domain is not an email account. There is no email-as-wallet-recovery claim.

## Activation prerequisites
- Vercel team already owns getyoursats.com. Root hostname is **not attached to getyoursats-wallet** as of inspection; don't change root routing without preserving the intended landing-site experience.
- Implement/verify root-domain /.well-known route so it reaches this backend, with TLS/CORS and no edge caching; test a real cross-wallet invoice and payment.
- Provision Upstash Redis and Resend; set the **server-only** vars documented by docs/verified-email-rollout.md.
- With verified email operational and root LNURL payment tested, configure **server-only** `GETYOURSATS_HANDLE_ENABLED=true` alongside `GETYOURSATS_EMAIL_ENABLED=true`.
- Test replay, username collision, expired nonce, renamed source address, existing wallet restoration, email reassignment/closure, rate limits, malicious clients, high availability, LNURL min/max and external payer compatibility.
- No production promotion until security review and functional paid receipt tests.

## Current limitation requiring independent proof
The frontend obtains the destination directly from the connected SDK and cryptographically signs the alias claim with its wallet identity. **The backend cannot cryptographically prove that the particular `@breez.tips` address belongs to the same wallet key using LNURL payRequest data alone.** In an adversarial client, a verified wallet could bind an arbitrary payable Breez address. Before public enabling, obtain a Breez/provider-attested wallet/address binding or implement a wallet-payment challenge that proves receipt ownership. Do not describe this as fully wallet-authorized to third parties until that proof is solved.

That limitation is why the service is intentionally disabled despite the implementation code and why a root-domain DNS change alone is not enough. Consider Breez-hosted registered custom domains as an alternative if the SDK/provider exposes an authoritative bound identity.

## Scope boundaries
- No custom BOLT12, native BDK UTXO wallet, signed merchant ledger, UPI conversion, regulated fiat rail, or secure email-recovery of Bitcoin is claimed by this PR.
- Existing wallet and POS PR source changes are included in the same integration branch but still require device E2E and audited key-storage migration before public funded beta.
