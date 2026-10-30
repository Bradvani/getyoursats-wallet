# Closed-app Lightning notifications

## Release status, 2026-10-30

Breez has registered `https://wallet.getyoursats.com/api/notifications/lnurl` for every registered username under `getyoursats.com`. Jesse de Wit confirmed that no additional API key or domain association is required. Invoices created on `breez.tips` do not trigger this domain webhook, even for the same wallet.

The implementation is in PR #73. At the last production environment check the VAPID credentials and Redis binding were present, but the domain signing secret and both enable flags were absent. No actual mainnet provider callback or closed-app physical-device delivery has been verified. Repository tests do not constitute that acceptance.

## Supported scope

| Receive path | Source | Condition |
| --- | --- | --- |
| Registered `@getyoursats.com` address | Domain Breez webhook | Secret and flags configured; recipient device explicitly enrolled |
| Lightning invoice issued by the wallet | Wallet-specific Spark webhook | SDK registration succeeded; signed successful mainnet receive |
| `@breez.tips` address | Outside the registered domain hook | No domain-webhook coverage claim |
| Direct Spark receive, Bitcoin deposit, RampNow or DCA | Not activated by this release | Separate implementation and acceptance needed |

Domain alerts can activate even if independent invoice registration fails. Settings reports that limited coverage. Native Capacitor push remains separate from the installed web app. UI and notification copy currently use English.

## Authentication and delivery

- Breez authentication uses HMAC-SHA256 over the exact raw bytes and constant-time comparison of `X-Breez-Signature`. Parsing follows authentication. The documented nullable address uses the domain secret and signed `user_pubkey`; a supplied foreign address is rejected.
- Spark authentication independently verifies `X-Spark-Signature`, `MAINNET`, `TRANSFER_COMPLETED`, `SUCCEEDED` and the receiver when present. Pending events never produce payment alerts.
- Bodies are limited to 16 KiB. Events older than seven days or more than five minutes ahead are rejected. The timestamp is the provider enqueue time. Amounts, invoices, preimages, comments and zap data are not persisted or sent to push providers.
- Device operations require a single-use five-minute challenge signed by the wallet identity. The message binds the canonical origin, operation and hash of the exact endpoint, keys or registration being authorized. The client reconstructs it before signing.
- Redis enforces a five-device cap and one wallet owner per endpoint. Activation atomically checks the unchanged subscription. Records expire after 180 days without reenrollment.
- Node P-256 VAPID signing authorizes empty Web Push requests to allowlisted Apple, Google or Mozilla HTTPS endpoints. No wallet key or payment identifier enters the push body. The worker uses fixed private text and opens or focuses only the canonical wallet origin.
- Up to five devices are attempted concurrently. A two-minute lease exceeds the configured 60-second function lifetime. Completion and release require the same lease owner. Successful-device receipts survive partial failures; transient failures return 503 for provider retry. Receipt markers last 30 days; payment hashes unify Breez and Spark callbacks when Spark supplies the preimage.
- This version acknowledges after bounded fanout. It does not use a durable background queue. A push-service acknowledgement lost before its receipt is stored can still produce a duplicate. Push HTTP acceptance does not prove that the OS displayed an alert. Delivery is best effort.
- Notifications never update balances, mark POS payments paid or create wallet receipts. The opened wallet independently reads settlement from its SDK.

## Production configuration

Project: `getyoursats-wallet`, team `bradvani-8798`.

| Variable | Production setting |
| --- | --- |
| `GYS_BREEZ_LNURL_WEBHOOK_SECRET` | Jesse's exact private value, Secret/Sensitive, server only |
| `GYS_PUSH_ENABLED` | `true` to allow enrollment and delivery |
| `GYS_BREEZ_LNURL_PUSH_ENABLED` | `true` to activate the domain callback |
| `GYS_PUSH_VAPID_PUBLIC_KEY` | Existing public key |
| `GYS_PUSH_VAPID_PRIVATE_KEY` | Existing Secret/Sensitive private key |
| `GYS_PUSH_VAPID_SUBJECT` | Existing support contact |
| Redis | Existing paired `KV_REST_API_URL` and `KV_REST_API_TOKEN` |

Provision the domain secret directly in Vercel environment settings. Never paste it into chat, source, issues or a `VITE_` variable. The configuration API never returns it. Environment changes require a new deployment. Stage and verify the exact artifact before production promotion. Both flags remain off by default; shipping gated code alone does not activate alerts.

To roll back delivery, set `GYS_PUSH_ENABLED=false` and redeploy or roll back to a known deployment with that flag disabled. Disabling only the domain flag leaves independently registered invoice notifications available.

## Acceptance procedure

1. Require current CI, type checking, production build, browser smoke and disposable Redis acceptance to pass. Confirm the deployed release manifest matches the intended commit. Verify configuration has no secret fields and the activated callback rejects unsigned requests.
2. On an installed iPhone Home Screen PWA and an installed Android Chrome PWA, open the intended mainnet wallet, enable **Payment received alerts** in Settings and grant permission. Confirm reported coverage. Preview tests display only, not payment delivery.
3. The wallet owner closes the app and personally sends a tiny payment from another wallet to the exact registered `@getyoursats.com` address. The agent must not execute a cryptocurrency transfer. Record payment time and webhook HTTP outcome without recording its body, signing secret or preimage.
4. Confirm an OS alert appears with the app closed. Tap it, unlock the intended wallet and independently confirm the amount and receipt in history. Repeat with a wallet-created invoice if invoice coverage is enabled.
5. Confirm a second enrolled device receives its alert, replay does not normally double-alert successful devices, opt-out and logout stop subsequent delivery and switching wallets does not retain the old wallet's alerts.
6. Record device/OS/browser versions, deployed commit and each result. Observe errors and retries after activation. Do not claim final device or security acceptance until these observations exist.

Automated checks: `npm test`, `node --test tests/*.test.mjs`, `npm run build`, `npm run lint`. CI also runs `node --test tests/push-service.integration.mjs` against disposable Redis. The latter covers altered device proofs, challenge replay, independent domain activation, partial fanout retries, ownership transfer, device-cap rejection and activation/revocation races without external push delivery or funds movement.

This notification release does not satisfy separate full-wallet migration, recovery, bounded receive, unilateral exit or independent security-review gates.

References:
- https://sdk-doc-spark.breez.technology/guide/lnurl_webhooks.html
- https://sdk-doc-spark.breez.technology/guide/webhooks.html
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
