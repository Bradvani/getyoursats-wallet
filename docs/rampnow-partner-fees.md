# Rampnow partner fee preparation

Reviewed 11 November 2026. This change prepares fee plumbing; it does not enable
production checkout or change the existing sandbox/signet restrictions.

## Configuration

The server accepts these three settings together, or none of them:

| Setting | Meaning |
| --- | --- |
| `RAMPNOW_PARTNER_PCT_FEE` | Approved percentage as a decimal string; `1` means 1%, not 0.01%. |
| `RAMPNOW_PARTNER_FIXED_FEE` | Approved fixed amount in the Rampnow account's confirmed base currency. |
| `RAMPNOW_PARTNER_FEE_BASE_CURRENCY` | Confirmed account base currency, as an uppercase three-letter code. |

The owner delegated the initial pricing recommendation with affordability in
Asian markets as a priority. The current candidate is **0.25% + USD 0.10** per
purchase. It has not been activated: all three settings remain unset. The
earlier business plan's proposed 0.5–1% buy markup is superseded for this candidate.

The partner dashboard screenshot displays EUR as its reporting base currency,
while the public fee documentation describes an account base currency with USD
as the default. Reporting currency and fee denomination might differ; neither
is proof of the other. Activation is blocked until Rampnow confirms the actual
partner fixed-fee denomination. Do not set `USD` simply from the default, send
`0.10` as EUR, or invent an FX conversion. If the account fee currency is EUR,
confirm the intended pricing denomination/conversion before choosing a value.

The fixed amount was reduced from the owner's suggested USD 0.50 to limit the
burden on small purchases. These are arithmetic examples in USD equivalent,
before Rampnow, payment, network and wallet fees, and are not executable quotes:

| Purchase equivalent | GetYourSats fee at 0.25% + USD 0.10 | Effective GetYourSats rate |
| --- | --- | --- |
| USD 1 | USD 0.1025 | 10.25% |
| USD 5 | USD 0.1125 | 2.25% |
| USD 10 | USD 0.125 | 1.25% |
| USD 20 | USD 0.15 | 0.75% |
| USD 50 | USD 0.225 | 0.45% |
| USD 100 | USD 0.35 | 0.35% |

The fixed fee is still material for very small purchases. Evaluate affordability
using the actual all-in quote and supported minimum; these examples do not
establish that a micro-purchase target is economical or available.

When all settings are absent, the existing Rampnow account fee applies. Omission
does not mean zero. Partial, blank, negative, nonnumeric or lossy values fail
closed. Explicit zero is supported if deliberately configured. Only the two
numeric override fields are sent to Rampnow; the base-currency label is local
review metadata and does not change Rampnow's account denomination.

The quote and checkout receive exactly the same server-owned values. Browser
input cannot select a fee. The policy is included in the reviewed quote hash,
so changing the percentage, fixed amount, denomination or override mode requires
a fresh review. Changes during quoting or after reservation also stop dispatch.

## Accounting and disclosure

Rampnow documents a fixed fee in the account base currency (USD by default),
which must not be assumed to equal the customer's source currency. Confirm the
actual partner account currency before setting the configuration. No local FX
conversion is implemented.

The quote's `platform` line already includes the partner markup. Preserve the
provider's quote fee lines and destination amount; adding a second partner fee
would double count it. Order/webhook fee breakdowns use a separate `partner`
line. The order's separate `partnerFee` earned amount is documented in
`partnerCurrency` (currently USDC), which is a different accounting field.

Before activation, verify a sandbox quote and order using the approved policy
and confirm the account's fee settlement/payout arrangement. The purchase review
now displays the server-reviewed percentage plus fixed amount and its currency,
explicitly included in the platform fee. It does not add that policy to the
provider's fee totals. Do not calculate or claim a separate quoted partner
amount until Rampnow's conversion and rounding are verified.

## BTC and Lightning release boundary

BTC/`bitcoin` exists in Rampnow's documented routing contract. Production
eligibility still requires authenticated account capability, explicit mainnet
identity, supported destination validation, actual settlement receipt, and the
wallet security/recovery/release checks. Existing test addresses and sandbox
results do not establish mainnet readiness.

The reviewed public OpenAPI has no Lightning, invoice or LNURL field. The
blockchain-list page is dynamic and does not establish Lightning support.
Request an exact supported chain code, destination contract, invoice expiry and
amount semantics, failure/refund handling, and signed settlement evidence from
Rampnow before implementing that route. Keep it unavailable until proven.

Never omit the destination wallet to work around an unsupported route: the
documented fallback is Rampnow's partner wallet, not customer wallet entry.

## Primary references

- [Quote and partner fee contract](https://docs.rampnow.io/quickstart/ramp-intent/get-quote.md)
- [Intent checkout contract](https://docs.rampnow.io/quickstart/ramp-intent/create-order.md)
- [OpenAPI: FeeConfig, override fields and settlement fields](https://docs.rampnow.io/api-reference/partner_external.yaml)
- [Blockchain list](https://docs.rampnow.io/quickstart/resources/blockchain-list.md)
- [Production checklist](https://docs.rampnow.io/api-reference/go-live-checklist.md)
