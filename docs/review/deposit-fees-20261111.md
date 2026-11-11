# Deposit fees and cross-chain cost review

## Release scope

This release clarifies the existing Bitcoin deposit claim policy and makes higher-cost delivery approval explicit. It does not activate a GetYourSats markup or change the SDK, wallet storage, saved fee ceilings, recovery behavior, ramp gates or direct GYS routing.

- Bitcoin receive explains that the provider deducts a deposit fee separately from any fee charged by the sending wallet. It shows the user's automatic claim ceiling with the correct units.
- Bitcoin deposit review shows the provider deposit fee, the current GetYourSats deposit fee of zero and the quoted net credit.
- A faster delivery selection above the existing ceiling requires confirmation before the SDK receives a higher per-deposit allowance. This includes a future expedited claim that has not reached its confirmation depth yet.
- Cross-chain costs use SDK-supplied values in their own denominations. A missing quote is not presented as a zero. Display formatting never changes the debit, credit or prepared payment request.
- Cross-chain send retains the estimated conversion cost, identifies the service fee as included and separately displays the source network fee limit. The maximum BTC debit adds only that source budget to `amountIn`; it does not add overlapping conversion costs or mix token and BTC units.
- The new disclosure text is available in all ten supported languages. Automated language coverage is not native-speaker acceptance.

## Automatic claims are not standard-only

The current SDK has one automatic claim ceiling shared by standard and early delivery. The application default remains 500 SAT, and saved user ceilings remain unchanged. An eligible early claim can proceed automatically within that ceiling. Selecting a default radio button cannot disable that SDK behavior.

This release therefore does not promise standard-only delivery or require confirmation for every existing automatic claim. Implementing that policy needs separate SDK support or a reviewed claim lifecycle change. Disabling automatic claims would leave deposits pending for manual action and is not silently substituted for standard delivery.

## Monetization boundary

The approved candidate is a 0.25% partner fee on eligible USDC/USDT transactions, configured in the Breez partner portal for the production API key. Flashnet retains 20% of that fee. The vendored SDK already contains partner attribution; its nominal package version is not a reliable capability indicator.

Activation requires the matching partner account, a verified company-controlled payout address (USDC on Solana or USDB on Spark) and a saved portal setting. No payout destination is inferred from customer addresses. A code release alone does not activate this fee. Provider-confirmed accrued fees and payout records, rather than quotes, establish revenue.

Ordinary BTC deposit claims have no application-fee destination or markup parameter. Raising `maxDepositClaimFee` only permits higher provider charges. Adding a local percentage to a displayed quote would neither collect revenue nor represent the user's actual payment. BTC markup and the separately gated ramp pricing remain outside this release.

## Evidence and rollout

Baseline production source: `7090e7cd11d8062ba25d8b6ca5d0e5aaded6f3a7`.

SDK source: `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`.

SDK artifact SHA-256: `4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026`.

Baseline wallet deployment and rollback target: `dpl_HV41RvHWFZdcgiKgeHF6jE9LVLvq`. No storage migration is introduced, so the baseline can read the same state. Rolling back also restores the previous weaker future-delivery confirmation behavior.

Relevant tests cover future delivery authorization, no mutation on selection alone, quote/fee changes, zero and missing service fees, different service-fee assets/precision and preservation of the prepared payment request. Browser acceptance uses isolated fixtures without real funds; fixture files must remain outside the production build. The deployment's release manifest must identify the clean reviewed source and unchanged SDK artifact.

Full release evidence, CI result, deployment ID and post-release observations belong in the pull request record. This scoped release does not approve the separate wallet security/recovery drafts or assert a funded settlement test.

## Primary references

- [SDK deposit claim configuration](https://sdk-doc-spark.breez.technology/guide/config.html#max-deposit-claim-fee)
- [SDK manual deposit claims](https://sdk-doc-spark.breez.technology/guide/onchain_manual_claims.html)
- [Breez USDC/USDT partner fees](https://sdk-doc-spark.breez.technology/guide/cross_chain_partner_fees.html)
- [Pinned partner attribution](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/cross_chain/orchestra/attribution.rs)
- [Pinned cross-chain quote contract](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/cross_chain/mod.rs)
