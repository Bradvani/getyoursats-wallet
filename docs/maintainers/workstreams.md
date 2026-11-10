# GetYourSats workstreams

Reviewed 10 November 2026 (UTC). Production baseline: `7090e7cd11d8062ba25d8b6ca5d0e5aaded6f3a7`.

This is the coordination record for the UX audit, security readiness and on-ramp work. It records ownership and dependencies, not release approval. Historical test results apply only to their recorded source revisions.

| Workstream | Authoritative location | Status and next action |
| --- | --- | --- |
| Production UX | `main`, most recently PR #91 | Shipped orange-theme, typography/motion, payment counterparty/history and on-chain receive-copy improvements alongside the earlier Home, mobile Pay/keyboard and username-completion fixes. Start further UX fixes from current main and use a separate focused PR. |
| Wallet security and recovery | [PR #71](https://github.com/Bradvani/getyoursats-wallet/pull/71) | Consolidated draft candidate. New PR #91 conflicts and a localization selector failure require reconciliation before its next acceptance run. Retain the production interlock and route restrictions until the existing acceptance gates are closed. |
| RampNow / Hypermid on-ramp | [PR #72](https://github.com/Bradvani/getyoursats-wallet/pull/72) | Draft sandbox integration with PR #91 production changes integrated. Intent checkout activation is confirmed by a created sandbox order. Hosted sign-in/terms and an unusable synthetic email now block simulator completion; production credentials and BTC receipt acceptance remain outstanding. |
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
2. Complete #71's original populated-wallet ownership/migration, provider/receiving/exit, device recovery and rollout/rollback acceptance. Obtain the independent security release verdict on the final integrated artifact. Push notification signing/registration capability remains a separate incompatibility to resolve within the restricted gateway; do not broaden generic signing to hide it.
3. Intent API checkout activation is verified. Complete sandbox sign-in using a provider-supported test identity or an owner-approved real test identity. The generated checkout requires email verification and terms acceptance before simulation.
4. Preserve every permanent dispatch reservation. The two earlier rejected attempts were reconciled before v3 created one order. Do not repeat its create command. Verify authenticated lookup and signed callbacks against actual hosted simulator outcomes; no simulated status is a wallet receipt.
5. Complete the actual wallet purchase, hosted return and verified receipt flow. Obtain confirmed production merchant access and the supported BTC settlement route, then validate a separately authorized controlled real-funds purchase on the final reviewed release candidate.
6. Merge/promote only after the relevant checks and real-funds release gates pass. Sandbox credentials remain Preview-only. This cleanup does not enable Buy, DCA or production checkout.

## Merge review scope

The security merge combines the shipped mobile layouts, dedicated preference pages, GYS routing and passkey send authorization with the existing security controls. It preserves unavailable Send All behavior, rejects malformed/missing fee quotes, keeps recovery panels visible and retains wallet-removal protection. Cancelling removal while a browser connection is still awaiting authorization invalidates that pending connection while preserving wallet data.

No SDK archive, SDK patch, storage schema, production setting, payment reservation or funded operation is changed by this cleanup. Consult each active PR for validation of its new head and any remaining CI results.
