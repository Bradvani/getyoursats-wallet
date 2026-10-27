# GYS direct-payment integration, 28 October 2026

Combines PR #46 direct Spark receive UI and PR #67 valid-fee confirmation on main 37abc88. Resolves the SparkAddressDisplay localization conflict while preserving translated loading and copy/share messages.

Integration exposed a functional conflict: SparkWorkflow always supplied null fees, so valid-fee confirmation blocked every Spark send. It now reads the SDK bigint fee, rejects absent/negative/unsafe values and accepts explicit zero. Direct-send regressions cover zero and seven-sat fees without LNURL fallback. The fixture now satisfies the SDK response type, including feePolicy.

Validation: 130 send/receive tests across 19 files passed using retained installed dependencies. TypeScript and changed-component lint are checked separately. Existing mock contact and sheet-layout warnings remain. No live payments or deployment were performed.

The user reports Gate 1 passed with test-environment checks ongoing. PR #43 remains a separate unmerged security candidate at cc9f970. Its description records direct regtest A-to-B 100 and B-to-A 50, zero fees, restart preservation and exact-operation reconciliation. That historical evidence does not validate this integration tree or clear production release.

Remaining: integrate with the final security candidate and rerun source-bound acceptance; complete direct QR scanning on separate devices, settlement and interruption checks on that exact artifact; finish translations for newly introduced direct-receive copy; verify production rollout. Username-to-Spark resolution is not implemented. GYS Lightning addresses retain Lightning routing and quoted fees.
