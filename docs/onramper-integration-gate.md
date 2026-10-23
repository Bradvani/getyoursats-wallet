# Onramper buy checkout — conditional launch and custody review

Status: **feature-branch integration, not live partner purchasing** (23 October 2026).

## Rationale
The reference experience includes a third-party Bitcoin buy option. Onramper offers hosted and embedded web checkout, with country-dependent availability. We choose hosted external checkout first, to avoid iframe KYC restrictions, webview quirks and interference with the GetYourSats passkey/wallet environment.

Provider docs:
- https://docs.onramper.com/docs/integration-steps
- https://docs.onramper.com/docs/supported-widget-parameters
- https://docs.onramper.com/docs/signing-widget-url
- https://onramper.com/country-coverage/IN

## Current implementation
- `Buy Bitcoin` is discoverable from the menu even when the partner is not enabled, but shows an honest unavailable state.
- An external hosted checkout is constructed only for `mainnet` when `VITE_GETYOURSATS_ONRAMPER_ENABLED=true` **and** `VITE_ONRAMPER_API_KEY=pk_prod_...` (a production partner identifier).
- Restricts the widget to `mode=buy`, `onlyCryptos=btc`, `onlyCryptoNetworks=bitcoin`, includes the country selector and sets web checkout to open out of the wallet.
- **Never pre-fills** a Lightning Address, BOLT11 invoice, Spark wallet signing key or a guessed BTC address. Users are explicitly warned that an independently confirmed BTC on-chain deposit address is needed and that network fees and deposit limits matter.
- Does not infer a confirmed onramp purchase from a redirect or returned page. Wallet balance is updated only from SDK events/history.
- No arbitrary URLs, callback return parameters, unsigned address binding or secret API values are accepted.
- Legacy MoonPay/Cash App integration stays under its existing independent operator flag.

## Product integration blockers (do not bypass)
1. Onramper onboarding: partner application, production public API key, allowed origin(s), support / disclosure requirements, country/provider coverage and legally supportable Indian flow. India coverage lists UPI among potential methods, but eligibility depends on the actual partner offer and user's KYC/country.
2. Native/Spark deposit compatibility: verify the correct Breez Spark **Bitcoin on-chain deposit address**, whether it may be reused per purchase, minimum amount, deposit fees, timing and provider-supported network. Spark's on-chain deposit is not an independently custody-controlled Bitcoin UTXO wallet. Avoid suggesting a Lightning address is acceptable.
3. Automatic recipient prefilling: Onramper requires **server-side signing** of `wallets` / `networkWallets` URL values with a separate private signing secret. Build an authenticated Vercel endpoint that looks up the active wallet identity and a validated fresh deposit address. Keep signer secret in server env only. Prevent wallet substitution, replay and URL tampering; sign as Onramper specifies.
4. Provider payment statuses: use approved Onramper authenticated webhooks/verified order retrieval (with replay protection), separate from Spark's actual receive settlements. Never claim a card payment has delivered BTC until the connected wallet confirms.
5. India AML/KYC/tax and provider approvals: confirm compliance before enabling UPI marketing, fiat recurring mandates or INR guaranteed prices.
6. QA: test with a strictly separated unfunded wallet and approved provider test/sandbox checkout before any live purchase. No real funds testing without explicit permission.

## When to activate
Set the public partner key and enable flag only after (1)-(6) are satisfied. Do not include signing secrets in any `VITE_*` variable. Disable this feature immediately if the destination handling cannot be verified in a regression release.
