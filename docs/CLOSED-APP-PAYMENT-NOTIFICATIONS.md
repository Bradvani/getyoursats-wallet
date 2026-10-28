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
