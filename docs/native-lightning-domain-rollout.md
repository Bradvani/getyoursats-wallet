# Native GetYourSats Lightning addresses

Status: validated activation release, 26 October 2026. The production backend, live provider flow and browser checks below are complete. This release enables the public email and native-name client gates described in [Current release state](#current-release-state).

## Provider confirmation

Breez confirmed by email that `getyoursats.com` is associated with the existing GetYourSats Breez API key and supplied a reverse-proxy shared secret. Existing `@breez.tips` addresses continue to receive into the same wallets. A name under the new domain is a separate registration; it is not automatically copied or reserved from the old domain. Breez does not apply GetYourSats email eligibility rules on our behalf.

Use the [official reverse-proxy guide](https://sdk-doc-spark.breez.technology/guide/custom_domain.html#reverse-proxy). The root domain remains on the `getyoursats-site` Vercel project, which also serves the public website. The wallet remains on the separate `getyoursats-wallet` project at `wallet.getyoursats.com`.

## Release scope

- Add the root site's fixed-upstream LNURL reverse proxy and registration policy.
- Keep the proxy secret exclusively in server environment variables.
- Keep public payment discovery and invoice callbacks independent of email storage.
- Require a wallet-signed native registration and the existing wallet-linked verified-email record before a personalised name can be registered or updated.
- Leave signed wallet recovery, metadata and deletion available if email storage is down or new registration is disabled.
- Reject native address transfers until a transfer entitlement policy is implemented.
- Prepare the wallet's address state to follow its SDK instance and provider-confirmed changes.
- Generate anonymous names and collision suffixes with Web Crypto, without an insecure randomness fallback.
- Recover and claim a native address through the same wallet identity in a temporary server-mode SDK session, without changing the payment SDK's domain or storage.
- Restore verified-email status through a wallet-signed challenge and remove the superseded forwarding-alias claim UI.
- Bound verification email sends to 80 attempts per UTC day, leaving headroom in the current 100-email daily provider allowance for support. Atomically reserve send limits and apply a 60-second resend cooldown; rejected reservations do not consume personal allowances.

Client feature gates control access to email verification and native-name registration. Their activation status is recorded in [Current release state](#current-release-state). This integration does not implement fiat on-ramping, fee sponsorship or fee-free Lightning payments.

## Environment variables

Enter secret values directly in Vercel. Do not put them in source, a PR, chat, a URL or a `VITE_*` variable. The proxy shared secret is separate from the client SDK API key already used by the wallet.

| Project | Server variable | Purpose |
| --- | --- | --- |
| `getyoursats-site` | `BREEZ_LNURL_PROXY_SECRET` | Exact reverse-proxy secret supplied by Breez |
| `getyoursats-site` | `GETYOURSATS_NATIVE_HANDLES_ENABLED` | Production is `true`; `false` pauses new registrations while preserving recovery and public payment routes |
| `getyoursats-site` | `UPSTASH_REDIS_REST_URL` | Same verified-email database used by the wallet backend |
| `getyoursats-site` | `UPSTASH_REDIS_REST_TOKEN` | Server credential for reading verified wallet records; prefer read-only access where supported |
| `getyoursats-wallet` | `UPSTASH_REDIS_REST_URL` | Durable email challenge, OTP and verified-email storage |
| `getyoursats-wallet` | `UPSTASH_REDIS_REST_TOKEN` | Server credential for the email service's required Redis commands |
| `getyoursats-wallet` | `RESEND_API_KEY` | Verification email delivery |
| `getyoursats-wallet` | `GETYOURSATS_EMAIL_FROM` | A verified sender allowed by the Resend account |
| `getyoursats-wallet` | `GETYOURSATS_EMAIL_HMAC_KEY` | At least 32 random characters for server-side OTP/email HMACs |
| `getyoursats-wallet` | `GETYOURSATS_EMAIL_ENABLED` | Production is `true`; enables the configured email service |

Vercel's Upstash integration can inject `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Both services support that complete pair when neither explicit `UPSTASH_*` variable is set. An incomplete explicit pair fails closed; credentials are never mixed between pairs. The site prefers `KV_REST_API_READ_ONLY_TOKEN` when available, while the email backend requires a writable token. Both production projects now use the same durable Upstash Free database. Keep preview databases separate from production account records.

Redis eviction and automatic upgrades are disabled. Verified email ownership records are permanent rather than expendable cache entries. Keep the HMAC secret stable. It also determines email-owner index keys, so rotating it requires an explicit index migration.

Use Production for the live release. If a trusted preview needs real provider access, scope the secret to that specific branch and remove the preview assignment afterward. A normal preview without the secret must return a service-unavailable response for LNURL proxy calls, without forwarding anything to Breez. Environment changes apply to a new deployment.

`GETYOURSATS_HANDLE_ENABLED` belongs to the old application-managed alias implementation. Keep it unset or `false`. Do not enable that route as part of this release. The old alias model cannot prove that an arbitrary supplied `@breez.tips` source address belongs to the signing wallet, and its handle proof verifier also rejects the legacy challenge prefix. Native Breez registration replaces that architecture.

The Resend sending domain is verified, and the domain-restricted sending credential, sender and HMAC secret are configured only in the wallet's Production server environment. Email is enabled and has passed real sending-API and OTP-verification checks using Resend's simulated test recipient. The observed Resend allowance is 100 emails per day and 3,000 per month. The application's 80-attempt daily budget includes failed or uncertain send attempts; the provider's Free-plan quota remains the final no-overage boundary. The database is a durable Free resource, not an unclaimed temporary starter database. No paid provider plan or automatic upgrade was enabled for this release.

Names are eligible immediately after optional email verification, with no funding or activity threshold. Email capacity affects new code sends only. Existing verified status, pending valid codes, registered names and payment routes remain usable. See [launch capacity](verified-email-rollout.md#launch-capacity) for resend controls, retry behavior and shared-account limits.

## Proxy contract

The proxy uses only `https://breez.tips` as its upstream. TLS is validated for `breez.tips`, while the HTTP `Host` header is `getyoursats.com`. It replaces any client-supplied proxy secret and forwarded-IP chain with the configured server secret and one trusted client IP.

Every upstream request sets `Accept-Encoding: identity`, so modern browser compression preferences cannot select a format outside the secret scanner's supported encodings. Response limits, secret inspection, TLS verification and CORS restrictions remain enforced. An upstream that returns an unsupported encoding still fails closed.

Supported public paths under `/.well-known/lnurlp/` and `/lnurlp/` forward the original method and raw body. The proxy forwards `req.url` as delivered by Vercel without parsing or rebuilding its query. Native `/lnurlpay/` operations are explicitly allowlisted. The proxy does not follow upstream redirects and does not cache requests or responses. Public payment paths permit cross-origin wallet lookups; browser management calls permit the production wallet origin and the SDK's actual authorization/signature headers.

Live transport probes preserved GET, POST and DELETE methods, exact body bytes and a trustworthy single client IP. They also confirmed that `/.well-known/lnurlp/...` reaches the function. Vercel normalized equivalent query encodings, including `a+b` to `a%20b` and `%2f` to `%2F`, while retaining the decoded values. Do not describe the deployed URL as byte-for-byte identical. The pinned native signatures cover JSON fields or identity/timestamp headers, not raw query encoding; metadata deliberately excludes pagination parameters from its signature and LNURL invoice callbacks parse decoded fields. Production tests with the configured secret subsequently confirmed actual native registration, recovery, eligibility rejection, public discovery and invoice generation.

Named rewrite captures also appended an unwanted `path` query parameter in the first preview. The committed routes use unnamed captures and a fixed destination to avoid that injection. Do not replace them with `:path*` without testing the resulting upstream query.

Registration verifies the exact pinned SDK v2 signature against the compressed secp256k1 identity in the URL. It uses the same `gys:email:v1:wallet:{pubkey}` record created by the signed email challenge and successful OTP flow. A browser boolean, an email typed in a request or CORS alone never establishes eligibility. Breez remains authoritative for name uniqueness, replay protection and native wallet/address binding.

The SDK protocol is pinned by `vendor/SOURCE_COMMIT`. Review the allowlist and canonical signed-message format whenever the vendored SDK changes. Do not use arbitrary `sdk.signMessage()` to forge native messages: the SDK reserves the `breez-lnurl:` namespace for its internal operations.

## Native wallet integration

The existing wallet connects to the default Breez domain and automatically creates an anonymous address. Preserve that immediately usable onboarding flow. Personalised GetYourSats registration should become available after verified email, with no deposit, activity, volume or transaction-count requirement.

The SDK's domain is fixed at connection time. The payment SDK retains its original domain and storage. Native address recovery and registration use a temporary SDK built with the supported `defaultServerConfig`, the same credential supplied through the existing wallet lifecycle and a unique storage directory. Server mode starts no background recovery or payment services. A fresh `getLightningAddress()` therefore completes an authoritative signed lookup before any registration decision.

The pinned SDK stores one cached Lightning address rather than separate entries per domain and performs asynchronous recovery in a normal client runtime. The temporary server-mode session avoids both hazards without modifying the payment database. Its signed identity must match the active wallet before a name can be claimed. An existing native name is returned unchanged, even if the user entered a different name. This release does not offer renaming. A failed lookup never counts as proof that no native name exists.

The actual returned `LightningAddressInfo` becomes the preferred wallet-bound address across Home, Receive, QR, copy and share. The pinned SDK returns `lnurl.url` in the standard LUD-17 `lnurlp:` form. The candidate accepts exact native-domain `lnurlp:` and HTTPS discovery URLs for either supported path and converts them to canonical HTTPS for browser fetching. Credentials, ports, query strings, fragments, altered names and other domains remain rejected. Late default-domain events cannot replace the preferred address. Login and restoration perform a fresh native lookup once the client feature is enabled. Registration and recovery results are guarded against logout and wallet/label changes. The temporary session is disconnected and only its own randomly named databases are eligible for cleanup. No seed is exported and the normal wallet database is never deleted or rewritten for this feature.

The email and native-name screens accept only wallet-authenticated email status and provider-confirmed addresses. Opening the email screen does not send mail. Claims are user initiated and the name's public LNURL callback is checked before the claim screen offers copying. Recovery remains independent of email availability; the proxy still enforces verified email when a new name is registered.

After launch, keep the client `nativeLightningAddress` gate enabled so existing names can be restored even when new claims are paused. Pause registration with the server flag, preserving public payment and signed recovery routes. A native name belongs to its wallet identity; the passkey-RP migration offer is withheld when a native name is present or native recovery could not be confirmed because that migration creates a different identity. Label or credential switching never carries the previous wallet's preferred address into the new wallet.

Native name changes made elsewhere are picked up by a fresh login or explicit claim recovery. The default-domain payment SDK's address events cannot authoritatively update the separate native display. Hosted LNURL metadata lookup in the pinned provider source is wallet-key scoped rather than domain scoped. Both domains passed invoice metadata-hash validation in live QA. Payment comments and settled-receipt history across domains have not been tested with a funded payment.

## Validation and deployment

Run `npm run test:lightning-domain`, `npm run test:native-lnurl-session`, the targeted Lightning-address hook tests and `npm run build` for changes to this integration. The native-session integration test uses the actual pinned SDK with local regtest providers and a public test mnemonic. It never contacts production wallets, sends funds or needs the real shared secret. The optional SQLite runtime dependency must be built for this Node test (`npm rebuild better-sqlite3` if dependencies were installed with scripts disabled).

The root website uses direct deployments, so a wallet-repository merge alone does not release its proxy. Preserve the website's static assets, headers and contact handler whenever redeploying `site/`. Production backend settings are already enabled for the validated email and registration flow. The remaining client release sequence is browser QA of the candidate, merge, wallet deployment and a check of the deployed client gates and address restoration.

The [live CLI fixture](../tests/native-lightning-live-qa.mjs) uses generated disposable identities, a simulated email recipient and exact QA names. Each external operation requires an explicit mode and live opt-in. Its invoice check creates a one-sat invoice through each address, validates mainnet, amount and the SHA-256 commitment to the original LNURL metadata with the pinned SDK, and never initiates payment. No invoice, payment hash, preimage or verification-token URL is printed or persisted. A funded receipt test still requires an explicitly agreed amount and sender.

Fixture cleanup uses a fresh server-mode session, listens before its first foreground sync, requires the first `synced` event and checks synchronized zero balances. It also reads the exit-state inventory only in memory and requires a version-2 mainnet envelope for the same identity with no leaf pedigrees. Missing sync evidence, malformed inventory or any funds preserve the seed and stop deletion. Registered test names must be removed and their absence confirmed before private fixture files can be deleted.

Registration can be paused by disabling `GETYOURSATS_NATIVE_HANDLES_ENABLED` and redeploying, while retaining the proxy secret and payment routes. Once users have shared branded addresses, removing the proxy or its secret interrupts those addresses. Preserve public payment handling during a registration rollback.

## Recorded checks

### Automated and local integration evidence

- The LUD-17 address fix passed independent review, 93 targeted tests and the actual pinned-SDK integration test. Coverage includes exact-domain URL validation, native-session identity and lifecycle, preferred address state, email/username screens and related wallet surfaces. The local regtest integration retained both domains on the same identity and did not register a replacement after a failed native lookup.
- All 25 proxy tests passed, including browser compression negotiation and continued rejection of unsupported upstream encodings. Proxy and email service tests cover canonical signatures, eligibility, malformed requests, CORS, replay/expiry/collision rejection, atomic budgets and provider failures. Rejected capacity and cooldown checks preserve personal send quotas and pending valid codes; malformed counter state fails closed. These checks remain in the repository's CI service-test command.
- The live CLI fixture passed 28 mocked tests, including registration/recovery, negative eligibility, invoice validation and cleanup refusing uncertain or funded state.
- The browser QA fixture passed 10 guard tests. These validate its scope and mutation blocking; they are separate from the actual browser interaction result.
- The Redis runtime probe passed five guard tests before its live execution.
- Targeted lint, TypeScript and the production wallet build passed. Existing dependency deprecation and chunking warnings remain.

### Actual production-service evidence

- The same durable Upstash Free database is connected to both production projects, with eviction and automatic upgrades disabled. Eight real Redis Lua scenarios passed. The temporary runtime-test endpoint was removed from the live root-site deployment afterward.
- One message to Resend's simulated test recipient completed the real OTP verification flow on an unfunded disposable wallet. Replaying the accepted OTP returned HTTP 409.
- The actual pinned mainnet SDK registered both a native address and a default-domain address for the same test wallet. Fresh-storage recovery restored both exact names on the same identity and preserved the original address.
- A separate unverified wallet received the exact HTTP 403 eligibility rejection. Fresh recovery and public lookup confirmed that no native address was created.
- Public discovery through both supported path forms returned HTTP 200 with no redirects and cross-origin access. The callbacks matched the expected domain and exact QA name.
- Two one-sat invoices, one through each domain, passed SDK parsing and mainnet, amount and exact metadata-hash validation. No funds were sent, and payment settlement was not tested.
- A fresh Chromium context exercised the compiled release build under the production wallet origin with live APIs and the production security headers. Home showed the exact native address, signed email status restored, the HTTPS public lookup succeeded and copying returned the exact native address. Reloading repeated those checks successfully. Default-domain recovery was also observed. The browser guard blocked registration, email-send and payment mutations; none occurred.
- Both fixtures passed actual foreground synchronization, zero-balance and empty-leaf checks before their private local files were removed. The two provider test names were deleted and fresh recovery confirmed absence. The simulated verified-email binding remains in storage because the release has no automated unlink operation; no real mailbox was used.

## Current release state

The root proxy and wallet backend are deployed with `GETYOURSATS_NATIVE_HANDLES_ENABLED=true` and `GETYOURSATS_EMAIL_ENABLED=true`. Both use the shared durable database. The older forwarding-alias route remains disabled.

The release enables `emailVerification` and `nativeLightningAddress` in the wallet client. Users open Settings, verify their email and choose a name. Existing verified status and a provider-confirmed native address restore without another email. Anonymous onboarding remains immediately usable, with no funding or activity threshold for the optional name.

Publish the reviewed commit only after its CI checks pass, then confirm the production wallet alias and public readiness response. For a registration rollback, disable the server registration flag and redeploy while retaining native recovery and public payment routes. Keep the client native-address gate enabled once users have shared their addresses.

## Costs and P2P

Breez's domain approval is not a fee agreement. A branded Lightning address changes address discovery and registration; it does not make a transfer fee-free or establish a no-cost company subsidy. Keep on-ramping and any fee sponsorship disabled until separately agreed. Verify fee behavior in the actual selected payment route before describing P2P as free.

## References

- [Breez custom-domain setup](https://sdk-doc-spark.breez.technology/guide/custom_domain.html)
- [Breez Lightning-address registration and receipt](https://sdk-doc-spark.breez.technology/guide/receive_lnurl_pay.html)
- [Pinned native signed-message implementation](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/lnurl-models/src/signed_message.rs)
- [Pinned SDK Lightning-address cache and recovery](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/lightning_address.rs)
- [Email verification setup](verified-email-rollout.md)
