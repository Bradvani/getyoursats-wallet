# Native GetYourSats Lightning addresses

Status: draft integration, 26 October 2026. Domain registration is approved by Breez. End-user activation is still pending.

## Provider confirmation

Breez confirmed by email that `getyoursats.com` is associated with the existing GetYourSats Breez API key and supplied a reverse-proxy shared secret. Existing `@breez.tips` addresses continue to receive into the same wallets. A name under the new domain is a separate registration; it is not automatically copied or reserved from the old domain. Breez does not apply GetYourSats email eligibility rules on our behalf.

Use the [official reverse-proxy guide](https://sdk-doc-spark.breez.technology/guide/custom_domain.html#reverse-proxy). The root domain remains on the `getyoursats-site` Vercel project, which also serves the public website. The wallet remains on the separate `getyoursats-wallet` project at `wallet.getyoursats.com`.

## Scope of this draft

- Add the root site's fixed-upstream LNURL reverse proxy and registration policy.
- Keep the proxy secret exclusively in server environment variables.
- Keep public payment discovery and invoice callbacks independent of email storage.
- Require a wallet-signed native registration and the existing wallet-linked verified-email record before a personalised name can be registered or updated.
- Leave signed wallet recovery, metadata and deletion available if email storage is down or new registration is disabled.
- Reject native address transfers until a transfer entitlement policy is implemented.
- Prepare the wallet's address state to follow its SDK instance and provider-confirmed changes.

This draft does not switch the production wallet's `lnurlDomain`, enable the email screen or activate username claims. Those changes need the migration work described below. It does not implement fiat on-ramping, fee sponsorship or fee-free Lightning payments.

## Environment variables

Enter secret values directly in Vercel. Do not put them in source, a PR, chat, a URL or a `VITE_*` variable. The proxy shared secret is separate from the client SDK API key already used by the wallet.

| Project | Server variable | Purpose |
| --- | --- | --- |
| `getyoursats-site` | `BREEZ_LNURL_PROXY_SECRET` | Exact reverse-proxy secret supplied by Breez |
| `getyoursats-site` | `GETYOURSATS_NATIVE_HANDLES_ENABLED` | Leave unset or `false` until native registration is ready; `true` permits the verified registration policy |
| `getyoursats-site` | `UPSTASH_REDIS_REST_URL` | Same verified-email database used by the wallet backend |
| `getyoursats-site` | `UPSTASH_REDIS_REST_TOKEN` | Server credential for reading verified wallet records; prefer read-only access where supported |
| `getyoursats-wallet` | `UPSTASH_REDIS_REST_URL` | Durable email challenge, OTP and verified-email storage |
| `getyoursats-wallet` | `UPSTASH_REDIS_REST_TOKEN` | Server credential for the email service's required Redis commands |
| `getyoursats-wallet` | `RESEND_API_KEY` | Verification email delivery |
| `getyoursats-wallet` | `GETYOURSATS_EMAIL_FROM` | A verified sender allowed by the Resend account |
| `getyoursats-wallet` | `GETYOURSATS_EMAIL_HMAC_KEY` | At least 32 random characters for server-side OTP/email HMACs |
| `getyoursats-wallet` | `GETYOURSATS_EMAIL_ENABLED` | Enable only once the email service has been exercised successfully |

Use Production for the live release. If a trusted preview needs real provider access, scope the secret to that specific branch and remove the preview assignment afterward. A normal preview without the secret must return a service-unavailable response for LNURL proxy calls, without forwarding anything to Breez. Environment changes apply to a new deployment.

`GETYOURSATS_HANDLE_ENABLED` belongs to the old application-managed alias implementation. Keep it unset or `false`. Do not enable that route as part of this release. The old alias model cannot prove that an arbitrary supplied `@breez.tips` source address belongs to the signing wallet, and its handle proof verifier also rejects the legacy challenge prefix. Native Breez registration replaces that architecture.

No new database or paid provider plan is provisioned by this change. Confirm the selected storage and mail allowances before provisioning; code preparation does not establish a zero hosting or email bill.

## Proxy contract

The proxy uses only `https://breez.tips` as its upstream. TLS is validated for `breez.tips`, while the HTTP `Host` header is `getyoursats.com`. It replaces any client-supplied proxy secret and forwarded-IP chain with the configured server secret and one trusted client IP.

Supported public paths under `/.well-known/lnurlp/` and `/lnurlp/` forward the original method and raw body. The proxy forwards `req.url` as delivered by Vercel without parsing or rebuilding its query. Native `/lnurlpay/` operations are explicitly allowlisted. The proxy does not follow upstream redirects and does not cache requests or responses. Public payment paths permit cross-origin wallet lookups; browser management calls permit the production wallet origin and the SDK's actual authorization/signature headers.

Live preview probes preserved GET, POST and DELETE methods, exact body bytes and a trustworthy single client IP. They also confirmed that `/.well-known/lnurlp/...` reaches the function. Vercel normalized equivalent query encodings, including `a+b` to `a%20b` and `%2f` to `%2F`, while retaining the decoded values. Do not describe the deployed URL as byte-for-byte identical. The pinned native signatures cover JSON fields or identity/timestamp headers, not raw query encoding; metadata deliberately excludes pagination parameters from its signature and LNURL invoice callbacks parse decoded fields. Real provider integration still needs verification with the configured secret.

Named rewrite captures also appended an unwanted `path` query parameter in the first preview. The committed routes use unnamed captures and a fixed destination to avoid that injection. Do not replace them with `:path*` without testing the resulting upstream query.

Registration verifies the exact pinned SDK v2 signature against the compressed secp256k1 identity in the URL. It uses the same `gys:email:v1:wallet:{pubkey}` record created by the signed email challenge and successful OTP flow. A browser boolean, an email typed in a request or CORS alone never establishes eligibility. Breez remains authoritative for name uniqueness, replay protection and native wallet/address binding.

The SDK protocol is pinned by `vendor/SOURCE_COMMIT`. Review the allowlist and canonical signed-message format whenever the vendored SDK changes. Do not use arbitrary `sdk.signMessage()` to forge native messages: the SDK reserves the `breez-lnurl:` namespace for its internal operations.

## Remaining wallet integration

The existing wallet connects to the default Breez domain and automatically creates an anonymous address. Preserve that immediately usable onboarding flow. Personalised GetYourSats registration should become available after verified email, with no deposit, activity, volume or transaction-count requirement.

The SDK's domain is fixed at connection time. A correct transition needs a deliberate same-wallet reconnect using the supported passkey/recovery paths, followed by `sdk.registerLightningAddress()` on the configured native domain. Do not create a new wallet, export seeds, call `deleteLightningAddress()` or bypass SDK signing in order to switch domains.

The pinned SDK stores one cached Lightning address rather than separate entries per domain and also performs asynchronous recovery at startup. Therefore a cached `@breez.tips` result immediately after reconnect is not authoritative evidence that the new domain has no registration. A restored wallet's already registered custom name must be recovered before attempting new registration. A timeout alone must not cause random registration that could overwrite an existing name.

When native registration succeeds, its actual returned `LightningAddressInfo` must update Home, Receive, QR, copy and share consistently. The email/username screen must use that native result instead of the old alias API. A renamed address within one domain has different behavior from keeping the old address on a separate domain; do not promise that all historical names remain payable.

## Validation and deployment

1. Run `npm run test:lightning-domain`, the targeted Lightning-address hook tests and `npm run build`. Server tests use generated test keys and mocked upstream/storage, never the real shared secret.
2. Deploy `site/` to a preview of `getyoursats-site`. The project currently uses direct deployments, so a wallet-repository PR by itself does not release the root website. Preserve all existing static assets and `api/contact.js`.
3. Verify that `/.well-known/lnurlp/{name}`, the invoice/verification paths and private SDK paths actually reach the Node function. The temporary preview has demonstrated routing, but the release's complete site build must pass the same checks. Check POST/DELETE, raw body preservation and decoded query values in the deployed runtime, too.
4. With a trusted preview and the correctly scoped secret, confirm that the upstream enforces the registered domain/secret boundary and that direct access without the shared secret cannot bypass the proxy's registration policy.
5. Exercise a valid native signature with no verified email, a wrong wallet's signature, an altered username/domain/timestamp, a replay, storage failure and the disabled registration flag. None may create a personalised registration.
6. Exercise email delivery and OTP verification on an unfunded test wallet. Verify restored account status and rejection of expired/reused challenges, incorrect codes and duplicate email bindings.
7. Complete and test the same-wallet domain transition, delayed SDK recovery and multiple mounted address views. Existing `@breez.tips` names must remain usable.
8. After the end-to-end flow is ready, deploy the root proxy and wallet changes with the appropriate server settings. Verify public discovery and invoice generation for the same test wallet through both its old and new addresses. Any funded receipt test requires an explicitly agreed amount and sender.

Registration can be paused by disabling `GETYOURSATS_NATIVE_HANDLES_ENABLED` and redeploying, while retaining the proxy secret and payment routes. Once users have shared branded addresses, removing the proxy or its secret interrupts those addresses. Preserve public payment handling during a registration rollback.

## Recorded checks

- Proxy: 22 local tests passed, including independent canonical-message hashing, ownership and email gates, malformed requests, method/path bypasses, CORS, secret reflection, compression and empty HEAD responses.
- Existing email cryptography and disabled-service behavior: four tests passed.
- Wallet hook and the Receive feature suite: 25 tests passed across six test files.
- Targeted hook lint, TypeScript and production wallet build passed. The build retains existing dependency deprecation and chunking warnings.
- Secret-free Vercel probes confirmed the routing/transport behavior described above. They did not register a name, access the real email database, generate an invoice or send a payment.
- The existing CI service-test command includes the new proxy tests, so they also run in the repository's GetYourSats checks.

## Costs and P2P

Breez's domain approval is not a fee agreement. A branded Lightning address changes address discovery and registration; it does not make a transfer fee-free or establish a no-cost company subsidy. Keep on-ramping and any fee sponsorship disabled until separately agreed. Verify fee behavior in the actual selected payment route before describing P2P as free.

## References

- [Breez custom-domain setup](https://sdk-doc-spark.breez.technology/guide/custom_domain.html)
- [Breez Lightning-address registration and receipt](https://sdk-doc-spark.breez.technology/guide/receive_lnurl_pay.html)
- [Pinned native signed-message implementation](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/lnurl-models/src/signed_message.rs)
- [Pinned SDK Lightning-address cache and recovery](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/lightning_address.rs)
- [Email verification setup](verified-email-rollout.md)
