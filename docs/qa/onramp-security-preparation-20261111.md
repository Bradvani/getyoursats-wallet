# Combined on-ramp and wallet security preparation

Updated 11 November 2026 (UTC). This candidate combines checkout PR #72 at
`21670a95db0d0769e2c5ad666dc06ac12fe76ebc` with security PR #71 at
`f473c5588a287476f0003e3c8e990c45470a877c`, preserving production UX from
`7090e7cd11d8062ba25d8b6ca5d0e5aaded6f3a7`. It is preparation for review and
testing, not a production approval. Public Buy, recurring purchases and
production checkout remain disabled. No real funds were used for these checks.

This is the current combined-status record. Older chronological sections in
[the launch log](rampnow-launch-20261028.md) retain their original source and
test attribution; statements that no scenario has completed or that the return
UI remains unimplemented are superseded by the evidence below.

## Provider simulation evidence

The simulator uses disposable EUR-to-ETH card orders. These outcomes do not
prove Bitcoin settlement, Lightning support, an on-chain transaction or
spendable GetYourSats wallet credit.

| Case | Observed hosted outcome | Authenticated lookup evidence |
| --- | --- | --- |
| v6 accepted | Payment success | At `2026-11-11T07:33:17.809Z`, one strictly matched order reported `completed` with `dstFillAmount: "0.025226"`. |
| v7 declined | PaymentFailed after selecting Rejected in the simulator | At `2026-11-11T08:22:07.016Z`, one strictly matched order reported `payment_failed` with `dstFillAmount: "0"`. |
| v7 expired | PaymentExpired after selecting Expired in the simulator | At `2026-11-11T08:22:07.016Z`, one strictly matched order reported `expired` with `dstFillAmount: "0"`. |

The inspections validate provider identity, external reference, source amount,
destination address and the complete route. At `2026-11-11T08:38:55.276Z`,
the accepted order still reported `completed`, but its correlated callback had
not yet been retained. Provider retry or dashboard replay of that successful
order remains outstanding. No transaction hash or independently spendable
wallet receipt is established.

At `2026-11-11T08:38:56.035Z`, the declined and expired reports each contained
two signed, durably retained and exactly correlated provider callbacks:
`created` followed by `payment_failed`, and `created` plus `expired`, respectively.
Both terminal callbacks report zero fill. For the expiry case, the older
`created` callback arrived after `expired`; both retained their nine-digit UTC
precision. Receiver logs independently show signature-verified `EVENT_STORED`
after deployment `dpl_ChaSYVyZ9AtYghXk375jByrFfCFg`. These are unbound sandbox
quarantine records correlated by the acceptance runner, not a production BTC
order ledger or wallet receipt.

The earlier signed callback rejection was isolated to `updateTime` carrying
UTC precision beyond milliseconds. The deployed fix accepts calendar-valid
UTC timestamps with up to nine fractional digits and preserves canonical
precision for ordering, including legacy millisecond state compatibility.
Raw-body authentication, the replay window, event deduplication and atomic
persistence remain enforced. Synthetic signed delivery probes are separate from
these correlated provider events.

All previous order records and permanent dispatch reservations remain intact.
Provider order completion is never used to authorize automatic creation retries.

## Implemented candidate behavior

- The existing preview quote/review, durable intent, one-dispatch checkout,
  hosted return, reload and owner-authenticated reconciliation paths are retained.
- The restricted wallet gateway accepts the existing canonical sandbox checkout
  proof for the exact preview origin and signet network. Identity, unlock/session
  checks and one-time nonce reservations remain enforced. The capability grants
  no spending, receiving or recovery permission.
- The actual browser checkout client and server proof verifier have contract
  coverage through that gateway using ephemeral signatures and mocked transport.
  This does not establish a funded wallet journey or provider settlement.
- Server-owned partner fee overrides are bound to both quote and checkout and
  to the review hash. The review shows the policy as included in the provider's
  platform fee, without adding it again to the quote totals.
- The combined candidate inherits the security SDK archive and patches from
  PR #71 unchanged. It retains the production build interlock, receiving/claim
  restrictions, recovery checks and guarded value-moving operations.

## Fee policy remains inactive

The prepared candidate is **0.25% + USD 0.10 per purchase**. The three override
settings remain unset. Existing account fees apply when overrides are omitted;
omission does not mean zero.

The dashboard's EUR reporting currency does not establish the fixed-fee
denomination. Confirm the actual account fee currency, conversion and rounding,
an all-in sandbox quote/order, and settlement/payout arrangements before
activating this policy. No USD-to-EUR substitution or local FX conversion is
implemented. See [the fee preparation record](../rampnow-partner-fees.md).

## Remaining production work

1. **BTC route and merchant configuration.** The provider's confirmed position is
   that Bitcoin sandbox settlement is unavailable and Lightning settlement is
   unsupported. A BTC mainnet on-chain Buy pilot is the only potential initial
   route; confirm production credentials, merchant permissions, minimums,
   destination/address support, KYC and payment requirements before preparing it.
   Lightning and Sell remain separate, unavailable capabilities.
2. **Production contracts.** Checkout API, storage, client, proof, return and
   destination validation remain restricted to sandbox/signet and the exact
   preview. Production origins, mainnet validation and environment-separated
   authorization/storage require an explicit implementation and review. The
   build interlock must remain until the documented security release gates pass.
3. **Wallet receiving and receipt.** Purchase review requests a Bitcoin deposit
   address, but the security gateway currently permits that route only for its
   development/regtest capability. The new proof capability does not resolve
   signet/mainnet receiving or claims. Implement and review supported receiving,
   deposit minimums, claim fees and the match from provider order to on-chain
   transaction, wallet claim and spendable credit. `walletReceiptVerified` is
   still hardcoded false; provider completion alone cannot change it.
4. **Callbacks and operations.** Complete provider-originated signed callback
   ingestion/correlation, duplicate and out-of-order handling, interrupted/mobile
   return and reload acceptance, support reconciliation and production retention.
   The existing thirty-day sandbox retention is not a production accounting
   ledger. Do not relax order, destination, amount or event validation to pass a
   provider test.
5. **Wallet security and controlled launch.** Complete populated legacy-wallet
   ownership/migration, provider-backed replacement-device recovery, bounded
   receiving/claims and fresh/rebuilt exits, physical iPhone/Android/PWA checks,
   rollout/rollback acceptance and independent review of the final application
   and modified SDK. Then the wallet owner must personally authorize and fund a
   minimum live BTC Buy acceptance transaction. Match fiat paid, provider fill,
   chain settlement, claim fees and spendable wallet credit before expanding it.

The separate notification signing/registration incompatibility remains a
security workstream dependency; checkout proof support does not introduce a
generic signing capability or resolve notification authorization.

## Final validation attribution

Local combined validation before the final timestamp correction passed 2,801
application tests, 565 Node service tests, 24 real TCP Redis tests, 56 Python
guards, installed SDK/WASM controls, types, app/protection/rollback builds and
rollback packaging. The opt-in Bitcoin recovery test was separately exercised
on isolated Bitcoin Core regtest and passed. Lint had zero errors and nine
existing warnings. The production build refused with the required security
interlock. Three unrelated Unix-socket Redis integrations could not execute
in this container (EPERM); the Rampnow TCP integration succeeded.

After fee disclosure, 155 focused browser client, dialog and gateway contract
tests passed with types and changed-file lint. After the timestamp correction,
167 combined fee/checkout/service/webhook/acceptance tests passed. These are
separate attributable runs, not an additive test total or a production verdict.
Local Node is 24; GitHub CI uses Node 22. Final-head CI and the accepted-order provider callback
correlation are still required. Device acceptance and real-funds
receipt remain separate from automated tests.

No production credentials, feature flags, fee settings, wallet records or
payment reservations are changed by publishing this preparation candidate.

Exact source `9ad3396` subsequently passed Companion security acceptance
(software, Chromium, Firefox, WebKit and isolated Bitcoin recovery), CodeQL and
localization checks. Its main checks passed 2,816 application tests and 572
Node tests before a later SDK check found the existing SQLite rebuild occurred
too late. A separate workflow exposed a POS hydration race in one test. The
followup moves that existing rebuild before the first SDK integration and waits
for the actual history control, retaining every containment assertion. Fifteen
focused UI tests, two real SDK integrations, types, lint and diff check passed.
The final timestamp code also passed 27 real TCP Redis tests and 171 focused
Node checks. Fresh final-head CI is required after these two test/CI fixes.
