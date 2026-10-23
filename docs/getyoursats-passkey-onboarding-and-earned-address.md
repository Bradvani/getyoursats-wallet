# GetYourSats v1: passkey-first onboarding and earned Lightning address

Status: **design and release criteria**, 23 October 2026. The current implementation on the feature branch covers UI routing and private backup; branded username activation **is not yet live**.

## Customer journey

1. **Start** on `https://wallet.getyoursats.com`: create a platform passkey through the WebAuthn provider on a fresh browser with no locally recognised passkey. The operating system can require fingerprint, face unlock, PIN or screen lock. Do not promise biometrics on every device; WebAuthn is credential authentication, not a guaranteed biometric prompt.
2. Generate wallet identity through the passkey PRF and connect the self-custodial Breez Spark wallet. Show balance and the SDK-returned **real** Lightning receiving address only after successful connection/registration. The current address might remain `@breez.tips` until our domain is validated. Never fabricate it.
3. Inside **Settings → Privacy & recovery**, offer a paper backup behind a private-place and offline-paper checklist, an explicit eye reveal and a reauthentication step when supported. Never place recovery words on the welcome page or in logs. The phrase is never a prerequisite of successful passkey onboarding, but users must understand provider/device-loss risks.
4. **Restore** starts with passkey sign-in; manual phrase entry is an explicit secondary choice. New devices have no safe browser-local proof that a synced passkey already exists, so the Restore path must stay visible even if Start defaults to creating a new credential.
5. **GetYourSats address**: unclaimed until verified-email, username ownership and the eligible transaction-fee threshold are all attested by an authenticated service. Existing `@breez.tips` addresses must continue to work through rollout; do not mutate displayed strings as a pretend migration.

## Identity and economic eligibility (not yet implemented)

A backend needs a public wallet identity binding and a non-seed bearer authentication scheme (passkey assertion with challenge + RP/origin validation, plus wallet-identity possession proof where required); never take custody of passkey PRF secrets, mnemonics or Lightning payment credentials.

Server-side API sketches:
- `POST /api/identity/challenge`: single-use short-lived WebAuthn challenge scoped to wallet id and origin.
- `POST /api/identity/verify`: verify credential assertion and link to the confirmed wallet identity. Account-linking must not silently merge two independently owned wallets.
- `POST /api/email/start`, `POST /api/email/confirm`: rate-limited email OTP or magic link, with expiry, replay prevention, and explicit account-linking consent.
- `GET /api/username/availability?name=...`: safe canonicalization, namespaced uniqueness, reserved-name restrictions and Unicode confusable rules.
- `POST /api/username/claim`: transactional reservation requiring verified ownership, sufficient eligible fees, and domain service readiness; signed short-lived backend authorization for the actual LNURL registration.
- `GET /api/identity/eligibility`: authoritative state, thresholds and signed status. No mutation derived from localStorage or arbitrary request counters.

### How "fees generated" must work

Product must define **which verified platform revenue** counts. Breez/Spark network fees and miner fees are not automatically GetYourSats revenue. A completed transfer or its BTC amount is not proof that GetYourSats earned a fee.

Backend accounting requirements:
- Each charge references an immutable unique payment ID, wallet identity, settlement event, refund/reversal status and eligible **platform-fee amount in sats**.
- Idempotently consume server-observed settled payment/fee events; dedupe by source + event ID.
- Sum **net realized qualifying platform fees**, excluding provider/miner/routing costs not received by GetYourSats, reversals, self-payments and abuse. Optionally also require minimum distinct settled transactions and anti-sybil controls.
- Keep the threshold a versioned **server policy** and disclose the rule to users before promising unlocking; do not invent a value in Vite env or browser storage. Ensure fees are not misrepresented as earned when the product never charged them.
- Unlock requires `emailVerified && usernameAvailable && eligibleFeeSats >= threshold && domainReady`, evaluated and committed atomically on the backend.
- Claims must be unique, reversible only by an owner-authorized and auditable process, and migrate safely without destroying a working receiving address.

The current UI intentionally shows "Coming soon" instead of fictitious transaction progress.

## Passkey and device acceptance before production

- Chrome Android and Safari iOS real-device testing on the canonical HTTPS domain: first-tap Start prefers platform passkey creation, not a speculative get assertion that launches the cross-device QR. A platform passkey may still depend on browser/OS credential manager and user settings.
- Existing same-device passkey Start must sign in, not register a new wallet. On a clean second device, Restore → passkey must load the **same wallet identity**. Test an intentionally cancelled passkey ceremony and an unsupported PRF browser; never drop into new-wallet generation or plaintext mnemonic storage silently.
- Verify wallet identity, actual receiving address, and SDK payment events across refresh, reconnect and restore; never mix existing funded wallet with testing.
- No auto-generated seed words on Start. In manual onboarding or optional backup: checklists, explicit show/hide, no words in DOM while hidden, screenshot protection where supported, and a fresh two-position verification puzzle upon retry.
- Confirm accessibility and reduce-motion support on real phones and with screen readers.

## Server/domain gate

`getyoursats.com` root LNURL needs either a verified Breez-hosted reverse proxy or a securely operated compatible LNURL server. The wallet app does **not** own the custom username merely because the SDK can register a random handle.

Never enable `VITE_GETYOURSATS_LNURL_DOMAIN_APPROVED=true` without demonstrated callback reachability and real registration. Until backend entitlement+LNURL binding is proven, do not open client-side self-claim of `@getyoursats.com` usernames.
