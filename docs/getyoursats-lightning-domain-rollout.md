# GetYourSats canonical Lightning addresses — implementation and release gate

## Decision (product request, 23 October 2026)

Customers should eventually receive **`username@getyoursats.com`**, not merely `username@pay.getyoursats.com`. This is a Lightning Address (LNURL-pay), not the email address or the Vercel wallet site. The wallet application remains `wallet.getyoursats.com`.

**Current production** uses the default Breez-hosted `@breez.tips` addresses. A successful existing Lightning payment confirms the current route works for that transaction. No custom hostname is deployed as of this document.

## Hosted Breez LNURL path: root domain with reverse proxy

Breez supports two models. A CNAME at `pay.getyoursats.com` pointing to `breez.tips` is straightforward, but produces `@pay.getyoursats.com`, **not** the product's requested root-domain address.

To keep the root GetYourSats website live and serve `@getyoursats.com`, implement Breez's **hosted reverse proxy** in the runtime serving `https://getyoursats.com`, without diverting all apex traffic away from the website:

- Route every HTTP method and original path/query/body for `/.well-known/lnurlp/*`, `/lnurlp/*`, and `/lnurlpay/*` to `https://breez.tips`.
- Set the upstream `Host` to **`getyoursats.com`** exactly.
- Supply the Breez-issued `X-Breez-Reverse-Proxy-Shared-Secret` from server-only hosting secrets. Do not put this secret in any `VITE_*` value or browser bundle.
- Replace `X-Forwarded-For` with the validated client IP. Never trust an incoming client-supplied XFF list.
- Disable CDN/proxy caching of all LNURL requests and preserve content types, status codes, redirect behavior and errors.
- Restrict other routes to the existing root website, keeping email/DNS and `wallet.getyoursats.com` intact.
- Exclude LNURL requests, headers and body payloads from logging wherever they might contain sensitive data.
- Deploy the proxy only after receiving approval/secret from Breez; test it with a safe integration environment before real funds.

**Owner/Breez approval:** Email `contact@breez.technology` to register `getyoursats.com` for the already configured Breez API key **with reverse-proxy mode**. Breez must verify the domain and provide a private shared secret. Send the API key via Breez's approved secure process, not via a public issue, chat or repository.

**Operator flag:** The feature branch supports `VITE_GETYOURSATS_LNURL_DOMAIN=getyoursats.com` and `VITE_GETYOURSATS_LNURL_DOMAIN_APPROVED=true` on mainnet. The approval flag is an operator assertion only; it never configures DNS or the reverse proxy and does not independently demonstrate Breez acceptance. Both flags must remain absent until external and functional checks pass.

## Existing users and account linking

- Do not rewrite, alias or pretend that an SDK-returned `alice@breez.tips` address is `alice@getyoursats.com`. Existing saved addresses should continue to work according to Breez's domain configuration.
- Register a **new** LNURL identity on the root domain only when the SDK returns a real address there. Preserve the old address during migration until receipt functionality is proven.
- Branded personal usernames must be allocated by a backend unique-name registry after verified email and active-wallet ownership proof. The mobile/web client must not be allowed to squat on arbitrary reserved names.
- The anonymous auto-assigned address may use the root domain only after the provider approves the domain and registration is verified. Naming and email-linking are separate steps.
- Do not present email verification as mnemonic or passkey wallet recovery. Never upload seed or mnemonic material.

## Explicit end-to-end acceptance tests before switching addresses

1. Inspect authoritative DNS/hosting for `getyoursats.com` and `wallet.getyoursats.com`. Confirm that the root website stays accessible and Vercel domain records/route permissions are understood.
2. Confirm Breez reverse-proxy approval and server-side shared secret. Verify LNURL lookup at `https://getyoursats.com/.well-known/lnurlp/<test-handle>` returns a valid endpoint, not SPA HTML or stale cache.
3. Create an unfunded test wallet on a supported stable origin with a verified recovery method; prove SDK `getLightningAddress()` returns the root domain after registration. No UI string override.
4. From an independent Lightning wallet, obtain an actual invoice through `username@getyoursats.com`; verify the callback and route metadata, then optionally complete an explicitly authorized tiny payment. Confirm the exact settled payment in the receiving SDK.
5. Reload, sign out and recover the original wallet on a second device; confirm the same signing identity and usable address survive recovery. Exercise failures and pending cases without fake success.
6. Check legacy `@breez.tips` address behavior during upgrade. If a domain migration affects active addresses, ship a customer-facing migration plan before changing production settings.
7. Only after the above, enable root-domain env variables in Production, deploy, and monitor failures. Keep a simple rollback to the existing working default domain with preservation of funds and addresses.

Official docs:
- https://sdk-doc-spark.breez.technology/guide/custom_domain.html
- https://sdk-doc-spark.breez.technology/guide/receive_lnurl_pay.html

## Current blockers

- The Vercel project/deployment APIs are accessible when called without explicit team scope; the domain **DNS-record listing** API still returns 403 and must be authorized or checked in the account dashboard.
- Breez custom-domain approval, root website routing/secret, working LNURL callback and email+username entitlement service are unverified/not implemented.
- No test with real funds is authorized by this document.
