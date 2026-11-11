# GetYourSats workstreams

Reviewed 11 November 2026 (UTC). Current main source: `00df9fcc0d8bf36c582ffb9e1856c2561707abfe`.

This is the coordination record for the UX audit, security readiness and on-ramp work. It records ownership and dependencies, not release approval. Historical test results apply only to their recorded source revisions.

| Workstream | Authoritative location | Status and next action |
| --- | --- | --- |
| Production UX and fee disclosure | `main`, most recently PR #94 | Shipped deposit-cost disclosure and explicit confirmation before raising future deposit-claim allowances, plus cross-chain fee disclosure and stronger mnemonic log redaction. These changes are reconciled into the combined candidate while retaining its restricted gateway. Earlier orange-theme, typography/motion, payment history and mobile fixes remain preserved. Start further production fixes from current main and use a separate focused PR. |
| Wallet security and recovery | [PR #71](https://github.com/Bradvani/getyoursats-wallet/pull/71) | Security source at `f473c558` is integrated into the combined on-ramp candidate. Retain the production interlock and route restrictions until original populated-wallet, provider, device, recovery and independent-review gates pass. No historical test result certifies the combined tree. |
| RampNow / Hypermid on-ramp | [PR #72](https://github.com/Bradvani/getyoursats-wallet/pull/72) | Accepted, declined and expired hosted simulations now have strictly matched completed/payment_failed/expired lookups. All three outcomes now have stored, signature-verified and exactly correlated provider callbacks after the strict UTC precision fix. The sandbox gateway proof and 0.25% + USD 0.10 fee policy are prepared; fees remain inactive. Production BTC merchant configuration, receiving/claims and wallet receipt remain open. The provider has no Bitcoin sandbox and does not support Lightning settlement. |
| Optional Bitcoin education | [PR #87](https://github.com/Bradvani/getyoursats-wallet/pull/87) | Separate proposal. Keep out of the on-ramp release dependency chain; review against the current Settings and onboarding UX before merging. |
| Public repository documentation | `main`; historical [PR #51](https://github.com/Bradvani/getyoursats-wallet/pull/51) | Substantive proposal already incorporated in production. Superseded PR closed; its remaining commented base-path example correction is carried in the active candidates. |

## Superseded proposals

Retain all branch tips, review discussion and recorded evidence. Closing a superseded PR is administrative consolidation and does not certify its changes for production.

| Older PRs | Replacement and evidence |
| --- | --- |
| #35, #39, #66, #68, #69, #70 | Their recorded heads are ancestors of the pre-tidy #71 head `78284fab3958bb56b8eb016c2fb058991ea184e0`. Continue implementation in #71. |
| #67 | Its three changed files are byte-identical in the pre-tidy #71 head. The newer merge preserves the invalid-quote restrictions and regression tests. |
| #43 | Its own handoff explicitly identifies #71 as the integrated successor. Preserve the earlier security evidence on the original branch. |
| #46 | Direct Spark receiving and its regression coverage are incorporated into #71 with later containment and localization changes. |
| #58 | Superseded by the shipped localization work in #65 and later production UX changes. Original browser/Android evidence remains available on #58's branch. |
| #51 | Its substantive documentation is already in production. Only the commented base-path example differed after retaining newer production wording; that correction is preserved in the active candidates. |
| #30 | The production receive dialog already uses the typed sats formatter for nonzero receive fees. |
| #9, #10 | Early public-page and wallet-experience proposals have been superseded by the current production product and subsequent security/on-ramp work. Preserve their original proposal and rollout documents as historical context. |

## Release sequence

1. Keep production UX patches small and merge current main into each active candidate before testing. Do not overwrite the other thread's workspace or force-push a shared branch.
2. Complete #71's original populated-wallet ownership/migration, provider/receiving/exit, device recovery and rollout/rollback acceptance. Obtain the independent security release verdict on the final integrated artifact. The combined candidate now admits only the canonical notification identity proof; fresh invoice webhook registration remains a separate scoped capability to implement. Generic signing remains blocked. See the [current code versus acceptance gate inventory](../security-review/notification-proof-recovery-gates-20261111.md).
3. Intent checkout, customer sign-in and accepted/declined/expired card simulation outcomes are verified in sandbox by hosted observations and strict authenticated lookups. Signed callbacks for accepted, declined and expired orders are now stored and correlated. This completes provider simulation acceptance for the disposable EUR-to-ETH route, not BTC wallet settlement. The deployed timestamp compatibility fix preserves nanosecond ordering, authentication and durable acknowledgement.
4. Preserve every permanent dispatch reservation and all earlier order records, including expired orders that may receive late events. Fresh fixed campaigns require authenticated predecessor reconciliation. Provider completion is distinct from independently verified spendable wallet receipt.
5. Preview purchase review and hosted return/reload wiring exist. A disconnected BTC claim observer and protected, quote-only production inspection script are prepared; neither enables checkout or verifies wallet receipt. Complete reviewed production receiving/claims and independently verified receipt, establish the mainnet/origin/storage contracts, and obtain confirmed production merchant access and BTC minimum/address support. Then validate a separately authorized controlled real-funds BTC on-chain Buy on the final reviewed release candidate. Lightning settlement is unsupported; Sell requires separate acceptance.
6. Rampnow confirms that production Intent activation and partner-fee setup follow approved onboarding; India/UPI support and customer KYC are confirmed. The three KYB forms alone are not approval. Account fee denomination/rounding/payouts and BTC minimum/address support remain unconfirmed. Merge/promote only after the relevant checks and real-funds release gates pass. Sandbox credentials remain Preview-only. This cleanup does not enable Buy, DCA or production checkout.

## Merge review scope

The security merge combines the shipped mobile layouts, dedicated preference pages, GYS routing and passkey send authorization with the existing security controls. It preserves unavailable Send All behavior, rejects malformed/missing fee quotes, keeps recovery panels visible and retains wallet-removal protection. Cancelling removal while a browser connection is still awaiting authorization invalidates that pending connection while preserving wallet data.

The combined candidate inherits PR #71's modified SDK archive and patches byte-for-byte; it does not add another SDK change. Production settings and fee overrides remain unchanged, permanent payment reservations are preserved, and no real-funds operation is performed by this cleanup. The sandbox proof capability does not enable the still-restricted Bitcoin deposit/claim route. See [current combined preparation and remaining gates](../qa/onramp-security-preparation-20261111.md) and each active PR for validation bound to the final source revision.
