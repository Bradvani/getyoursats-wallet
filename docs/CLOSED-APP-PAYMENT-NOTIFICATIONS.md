## Implementation status checked 2026-10-29

**Not yet live, feature flag remains disabled.** Draft PR #73 now includes:

- `src/components/PaymentPushSetting.tsx`: opt-in UI in wallet Settings. iOS Home Screen installation is required. Permission is requested only after user taps.
- `api/notifications/device.js`: wallet-signed nonce registration, authorization and subscription revocation against Redis.
- `server/pushCore.mjs`: VAPID ES256 signing, Apple/Google/Mozilla Web Push endpoint allowlist, HMAC verifier for completed Spark Lightning receives.
- `server/pushStore.mjs` and `server/notifyFanout.mjs`: endpoint ownership isolation, bounded device subscriptions and idempotent delivery, including per-device delivery marks across webhook retries.
- `api/notifications/spark.js`: signed Spark completion callback verifying unmodified request bytes, wallet identity, mainnet network, completed status and timestamp.
- `api/notifications/lnurl.js`: separately gated Breez Lightning Address signed callback for the verified `@getyoursats.com` domain. Not enabled without provider configuration and Breez signing secret.
- `public/sw.js`: privacy-preserving push presentation and safe click-to-wallet behavior. Empty pushes carry no invoice, amount, contact, preimage or balance data.
- `tests/push-core.test.mjs`, `tests/push-api.test.mjs` and `tests/pwa-push-sw.test.mjs`: signature, URL, payload, deduplication and worker assertions.

Production VAPID credentials are configured in Vercel (public key, server-only signing secret and mailto contact). The credentials do not by themselves activate anything.

### Activation checklist

1. Review and finish passing CI on PR #73, with no critical diagnostics. Re-run production browser smoke where unrelated existing navigation flakes occur.
2. Preview acceptance of wallet unlock and SDK `registerWebhook` on a throwaway **funded** wallet using a legitimate mainnet Lightning invoice. Validate no seed exfiltration, an actual signed provider callback and at most one delivered push.
3. Enable the server flag `GYS_PUSH_ENABLED=true` only after a reviewed production deploy. The existing production Redis/KV may be reused under the isolated `gys:notify:v1:` namespace; do not expose server Redis credentials to the client. Disable the flag to roll back push delivery.
4. Have Breez register the separate `https://wallet.getyoursats.com/api/notifications/lnurl` endpoint for the root `getyoursats.com` domain and transfer its HMAC signing secret over an authenticated private channel, then configure `GYS_BREEZ_LNURL_WEBHOOK_SECRET` on Vercel and `GYS_BREEZ_LNURL_PUSH_ENABLED=true`.
5. Have a user grant notification permissions in the installed iOS Home Screen PWA or Android Chrome PWA and send tiny-value Lightning payments from another wallet while GetYourSats is fully closed. Test both (A) invoice QR and (B) custom Lightning Address. Tap should open only canonical wallet, then the SDK must independently confirm funds.
6. Monitor one day of signed callbacks, duplicate suppression, opt-out and delivery errors. Web Push delivery is best effort and dependent on OS policies.

### Breez configuration request (provider action required)

Please register our signed Lightning Address receipt webhook at `https://wallet.getyoursats.com/api/notifications/lnurl` for the `getyoursats.com` domain. The LNURL proxy serves our custom usernames and backs them with individual Breez Spark wallets. Confirm whether callbacks include all addresses on the root domain, how the signing secret will be delivered securely and whether direct `@breez.tips` payments can also be covered.

**Do not place the HMAC signing secret in a chat, a public issue, a client-side Vite variable, or source control.** The webhook must stay disabled until provider setup has been tested with an actual paid invoice.

# Closed-app payment notifications: implementation and release gate

Status: **Client service-worker display is in a draft PR. This is not a live push service.**

The current SDK listeners, received-payment UI and haptics work while the wallet is running. There is no deployed push endpoint, device opt-in, VAPID credential or payment-webhook delivery service.

## Scope and safe architecture

1. Add an explicit opt-in Payment notifications setting (off by default) with an optional test notification. On iOS 16.4+ Web Push is available to installed Home Screen apps, not an ordinary browser tab.
2. Bind each Push API subscription to the active wallet identity via short-lived server nonce and an SDK compact signMessage proof, not a naked public key or email. Persist per-wallet/per-device subscriptions with TTL in Redis/KV. Validate push destination HTTPS host to prevent SSRF, rate-limit enrollments and remove expired or revoked subscriptions.
3. Register wallet-level Breez Spark completion webhooks through the connected SDK. Documented types include lightningReceiveFinished and staticDepositFinished. Verify the pinned vendor SDK version and determine whether **direct Spark-to-Spark receives** are covered before making a claim of universal notifications.
4. Where custom Lightning Addresses use the Breez LNURL domain, coordinate a domain-level payment webhook with Breez. This has a separately configured X-Breez-Signature secret. Wallet-level Spark webhooks use X-Spark-Signature, signed with the secret from registerWebhook. Do not conflate the two schemes.
5. Authenticate HMAC over **raw request bytes** using constant-time comparison, assert wallet identity and network, accept only final successful events, deduplicate by hash/request ID, bound payload size and retry transient push failures. Never accept a client-supplied claim that a payment settled.
6. Send standard Web Push using the reviewed web-push library with a server-only VAPID private key. Push a minimal versioned event type and opaque event ID. Default notification text must not reveal amounts, invoices, addresses, contact info or any key material. Optional amount visibility requires separate explicit consent.
7. The service worker only displays private text and focuses or opens the canonical wallet origin. The app refreshes SDK activity when opened. A POS receipt is never considered Paid based on a notification alone.
8. Native Capacitor shells do not use this PWA service worker; APNs/FCM device registration and entitlement testing are separate release work.

References:
- https://sdk-doc-spark.breez.technology/guide/webhooks.html
- https://sdk-doc-spark.breez.technology/guide/lnurl_webhooks.html
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers

## Production acceptance gates

- Tiny-value real Lightning receive while the app is **closed** on installed iOS and Android PWAs; tapping opens the correct wallet and shows independently verified payment activity.
- No notification for pending/failed payment, invalid signature, wrong network/wallet, duplicate event or revoked subscription. Confirm stop-on-unsubscribe and logout, multi-device behavior and stale endpoint cleanup.
- Identify precisely the supported receive rails (Lightning invoice, Lightning Address, Spark, Bitcoin deposit). Do not claim coverage for untested routes.
- Security review of webhook signing secrets, subscription authorization, data retention and network endpoint allowlists.
- Preview verification and sign-off before modifying production.

Secret configuration needed: server VAPID public/private key pair, contact subject, Redis/KV binding, webhook signing secrets and provider domain-webhook enrollment where applicable. Secrets never enter source control.

**Status: draft push display and tests only. Closed-app delivery is NOT enabled.**

## Notification content system

The final OS-level notification retains the official GetYourSats Bitcoin-orange app icon (#F7931A) over the established near-black brand mark. iOS and Android render their own notification cards; we control only the native icon, titles, descriptive text and click-through behavior. Do not simulate a custom black/orange notification background as if it were system UI.

| Type | Private headline | Private body | Send condition |
| --- | --- | --- | --- |
| `gys.payment.received` | Payment received ⚡ | Bitcoin received. Open GetYourSats for details. | Verified incoming wallet receipt, not pending |
| `gys.dca.purchase.settled` | Your stack just grew | Your scheduled Bitcoin purchase is complete. View your receipt. | Scheduled buy executed, provider settled and Bitcoin credited to same wallet |
| `gys.dca.purchase.failed` | Scheduled purchase needs attention | Your scheduled Bitcoin purchase did not complete. Review your plan. | Definitive failed attempt; do not mark failed if payment still in reconciliation |
| `gys.onramp.purchase.processing` | Bitcoin purchase processing | Your purchase is still processing. Check its current status. | Authenticated partner order exists but wallet has not yet received BTC |
| `gys.onramp.purchase.settled` | Bitcoin purchase delivered | Your Bitcoin has arrived. Open your wallet to verify the receipt. | Independently verified credited wallet balance/receipt; partner status alone is insufficient |
| `gys.onramp.availability` | More ways to stack sats | Explore available Bitcoin purchase options and fees. | Opted-in marketing AND real launch availability in the recipient's supported region |

All OS push copy is hard-coded from a server-authorized, versioned event taxonomy. Arbitrary sender-supplied title, body, destination and amounts are ignored. Unknown or malformed events show a generic wallet-activity alert. Realizations on lock screen need not expose merchant details, fiat amount, a Lightning Address or a purchaser/sender identity.

### Settings and opt-in behavior (not yet implemented)

- **Payment received:** user opts in after a direct gesture; by default notify for each independently confirmed inbound transaction. This is a wallet event, not marketing.
- **Purchase status:** separate user preferences for authenticated, meaningful on-ramp order changes (processing / final outcome). Never notify that BTC arrived based only on a partner's order state.
- **Recurring buys (DCA):** separate toggle: "Notify me after every completed scheduled purchase." This must not be activated until DCA execution, mandate authorization, payment settlement and delivery reconciliation are operational.
- **Bitcoin purchase updates:** off by default even if general payment alerts are enabled. A marketing-only cadence chooser offers monthly (at most 1 per rolling 30 days), or twice monthly (at most 2 per rolling 30 days with at least 14 days between sends). No ads to unsupported locales or where on-ramp is disabled. Users can unsubscribe immediately.
- **Show amounts in notifications:** privacy-preserving OFF by default, optional separate preference after an explicit risk disclosure. Never send sats or fiat amounts unless user explicitly enables visibility, and only after server verifies exact actual payment amount and denomination. No editable sensitive notification copy.
- Marketing obeys quiet hours in the recipient's selected time zone, and avoids repeated announcements. Transactional alerts should not be suppressed as marketing.
- Match GetYourSats locale preference, with documented English fallback until localization passes review. Localized push is not ready merely because the foreground app has translations.
- Notification tap opens the canonical wallet, triggers an independent SDK refresh and routes to the appropriate activity entry only after unlock/identity checks. Do not use user-provided URLs or transaction IDs to decide where to open.

### Current launch readiness (2026-10-29)

- **Receiving:** foreground SDK notifications and haptics exist; the PWA push display adapter is in this PR. Real closed-app delivery, subscription service, VAPID credentials and provider callback evidence are missing.
- **On-ramp:** the production Onramper external-checkout feature is gated; RampNow's signed sandbox integration is separate **draft PR #72** and has not been deployed for live purchases. Do not send acquisition promotions or successful-buy receipts until real purchase availability and delivery have been tested.
- **DCA:** `src/getyoursats/DcaPage.tsx` currently saves only a local draft. No actual scheduled purchase, debit or mandate exists. Per-purchase alerts are a future activation gate, not a claim of current DCA support.

Before enabling these categories, use reviewed signed provider and wallet callbacks, encrypted push endpoint subscription storage, dedupe, delivery retries and real device acceptance tests. This draft's copy additions are inert without an authenticated push sender.
