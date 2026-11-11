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
destination address and the complete route. Failure-case reports contain no
correlated retained callback and explicitly report `walletCreditVerified: false`.
The accepted report also has no transaction hash or correlated retained callback.
All previous order records and permanent dispatch reservations remain intact.
Provider order completion is never used to authorize automatic creation retries.

Signed provider callbacks have reached the isolated receiver, but acceptance is
not yet established. The bounded diagnostic for the `08:23:28 UTC` event isolated
the rejection to `updateTime` carrying UTC precision beyond milliseconds. The candidate now accepts strictly validated UTC timestamps with up to nine
fractional digits and preserves canonical precision for ordering, including
legacy millisecond state compatibility. A fresh provider retry, durable storage
and order correlation must still be verified before callback acceptance passes.

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
Local Node is 24; GitHub CI uses Node 22. Final-head CI and fresh provider
callback correlation are still required. Device acceptance and real-funds
receipt remain separate from automated tests.

No production credentials, feature flags, fee settings, wallet records or
payment reservations are changed by publishing this preparation candidate.
