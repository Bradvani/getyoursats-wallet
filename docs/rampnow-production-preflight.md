# Read-only production BTC merchant inspection

This operator script checks merchant authentication, provider-declared Bitcoin
mainnet metadata, advertised address type, an explicit country/fiat/payment
route, source-amount limits and one non-binding quote. It creates no orders,
customers, payment destinations or wallet records and performs no storage writes.
It never enables checkout. Every report keeps `productionReady: false`.

## Protected execution only

Run `scripts/rampnow-production-preflight.mjs` manually in a protected operator
runtime after the merchant account and fee denomination are confirmed. It has
no build hook, deployment hook, public API or browser entry point. Do not add it
to a normal build or expose the report through `dist`, `public`, a public CI
artifact or an application route. The sanitized quote is still private
commercial evidence. Credentials must be injected through the runtime's secret
store, never command-line arguments, source files, chat or the report.

| Required setting | Purpose |
| --- | --- |
| `RAMPNOW_PRODUCTION_PREFLIGHT_ENABLED=true` | Explicitly permit this inspection. |
| `RAMPNOW_ENVIRONMENT=production` | Choose the fixed production API host. |
| `RAMPNOW_PRODUCTION_API_KEY` | Separately provisioned production merchant key. |
| `RAMPNOW_PRODUCTION_API_SECRET` | Separately provisioned production merchant secret. |
| `RAMPNOW_PARTNER_PCT_FEE` | Approved numeric percentage. |
| `RAMPNOW_PARTNER_FIXED_FEE` | Approved fixed amount in the confirmed account fee currency. |
| `RAMPNOW_PARTNER_FEE_BASE_CURRENCY` | Currency intended by that fixed-fee policy. |
| `RAMPNOW_CONFIRMED_ACCOUNT_FEE_BASE_CURRENCY` | Actual account fee currency, attested from Rampnow's confirmation. |

The last setting records a provider/operator attestation. Environment variables
do not independently prove it. Keep the provider confirmation in the protected
launch evidence. The EUR dashboard reporting label and the documentation's USD
default are insufficient. A missing or conflicting attestation stops all API
requests. Missing opt-in, route inputs, fee policy or dedicated credentials also
stop before a client is created. Generic/sandbox credentials are never used as
a fallback; when present, a reused key or secret is rejected.

All route arguments are required. Obtain the exact address-type label and route
from Rampnow; do not guess a label or substitute a testnet address. The script
does not request or accept an actual wallet address.

```text
node scripts/rampnow-production-preflight.mjs \
  --fiat <CONFIRMED_FIAT> --country <CONFIRMED_COUNTRY> \
  --amount <AMOUNT_WITHIN_CONFIRMED_LIMITS> \
  --payment-mode <CONFIRMED_PAYMENT_MODE> \
  --address-type <CONFIRMED_PROVIDER_ADDRESS_TYPE>
```

Only these provider operations are reachable: GET configuration, chain
configuration, BTC asset configuration and blocked currencies; POST non-binding
quote. There is no checkout dispatch, automatic retry, sandbox fallback or
Lightning route. The quote sends the approved percentage and fixed amount
together; it preserves the provider's fee lines without adding partner markup
a second time or converting currencies locally.

## Interpreting a result

`read_only_quote_verified_acceptance_still_required` means the requested
non-binding quote passed validation. `advertisedAddressTypeMatches` means the
provider's label matches the explicitly requested label, not that an actual SDK
deposit address or settlement has been accepted. Errors contain fixed stage
labels, allowlisted network reasons and an optional HTTP status; provider bodies,
free text, customer data and credentials are discarded.

The protected report snapshots the bounded requested country/fiat/amount/payment
mode/address-type label, the attested percentage/fixed-fee policy and validated
buy limits. These identify exactly what was checked. It contains no actual
wallet address; its fee-currency evidence is explicitly labeled
`operator_recorded_provider_attestation`, not provider-verified API evidence.

Production checkout remains disabled. A successful inspection still leaves
merchant Intent checkout entitlement, production profile/KYC requirements,
supported wallet deposit/address semantics and minimum/claim fees, signed
callback correlation, independently spendable BTC receipt, recovery/device
acceptance and the wallet release gate to be verified. A quote cannot establish
any of these. Lightning support remains unavailable under the latest explicit
provider answer; it requires a separate supported contract and acceptance.

The script exits with code 2 when no verified quote is available, and code 0 for
a verified non-binding quote. Neither exit code authorizes a purchase or release.

## Validation

```sh
node --test tests/rampnow-production-preflight.test.mjs tests/rampnow-fees.test.mjs tests/rampnow-network.test.mjs
```

These use synthetic local HTTP fixtures only. They cover dedicated production
host/credentials, zero requests for incomplete/conflicting prerequisites,
network/address ambiguity, blocked or mismatched routes, exact decimal limits,
quote/fee mismatches, error sanitization and quote-only POST dispatch.
