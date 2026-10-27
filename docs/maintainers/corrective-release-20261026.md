# Corrective release: production evidence, 26 October 2026

**Live corrective release. Expanded real-funds adoption remains NO-GO.**

[PR #56](https://github.com/Bradvani/getyoursats-wallet/pull/56) was merged and its previously built, reviewed wallet and website artifacts were promoted without rebuilding. [The wallet](https://wallet.getyoursats.com) and [website](https://getyoursats.com) serve the recorded release. A01 through A03 remain security-release gates; [PR #43](https://github.com/Bradvani/getyoursats-wallet/pull/43) stays draft and has not been promoted.

The [machine-readable release record](../../evidence/releases/corrective-20261026/release-evidence.json) links every retained receipt and records their hashes. This documentation branch adds evidence only; it is not another application release.

## Source and deployment identity

| Item | Recorded identity |
|---|---|
| Reviewed source | `13f7ff73f89ccde9c633cde981ce306c285a0942` |
| Reviewed tree | `b9155ca6257881b167f82b223e21cc62d3aa8d5b` |
| CI merge | `4e2ef2599b2abf71fb96e1d22f36e9c3e4096b02` |
| Main merge | `72f92220078a2c4628a408fe82d4beb27d944e1c` |
| Integrated concurrent main changes | `77cb496a453823099725977b6f7975a49b24c179` |
| Wallet deployment | `dpl_949h8AJAod5DxvCFUHk9GWeeEvY4` |
| Wallet release | `3959c343f9083f957bcf` |
| Website deployment | `dpl_23DNSpbVHc5ibQmjByhaxKW6qyzS` |
| Website release | `91a1ee9e299dbaa63ac8` |

The reviewed head, CI merge and main merge have the same Git tree. The concurrent theme and startup changes were preserved. Wallet promotion completed at **23:10:44 UTC** and website promotion at **23:10:48 UTC**. The final alias read at **23:18:17 UTC** confirms the public domains still point to these deployments; `www.getyoursats.com` redirects to `getyoursats.com` with status 308. Automatic custom-domain assignment was restored on both projects after the automatic main build finished. Existing preview SSO protection was preserved.

The automatic wallet build of the main merge is ready at `dpl_FFCsyjoboz5wPgZ2PeavVUmKwZGu`, but the public wallet alias remains on the reviewed source artifact. This distinction is recorded rather than replacing the tested artifact with another build.

## What this release changes

- Removes the production deposit fixture triggered by `claimtest=1`.
- Reads paged wallet history and POS receipts, including receipts beyond the former first 100 results. Uses bounded scans, deduplication, cancellation and explicit failure instead of silently accepting a partial result.
- Adds clean-source release manifests covering the source revision, dependency lock, SDK package and emitted asset hashes. Hosting JSON reformatting and the observed site-root config projection are accepted only under narrowly verified equivalence rules.
- Bounds service-worker release caches, excludes private/API/query routes and avoids forced takeover by the new worker. Includes current theme and onboarding assets and recognizes the legacy v4/v5 cache names.
- Removes font-loading startup blocking, allows viewport zoom and preserves the concurrent light/dark startup fix.
- Adds atomic shared support-rate limits, bounded payloads, idempotent references and provider retry limits within the existing free email budget.
- Replaces tutorial-first repository positioning with product documentation and explicit trust boundaries. Separates task-first Support from Learn, corrects public metadata and removes unsupported network and absolute security claims.

These corrections preserve existing wallet identities, recovery options and records. They do not install the separate encrypted vault or complete its signing and reconciliation acceptance.

## CI on the final reviewed tree

All four corrective workflows completed successfully: [Tests](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40415923465), [GetYourSats checks](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40415923466), [CodeQL](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40415923475) and [browser smoke](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40415923491). The [CI receipt](../../evidence/releases/corrective-20261026/ci.json) records job links and the observed log counts.

| Verification | Result |
|---|---|
| Unit tests | 1,074 passed across 116 files |
| Node service and policy tests | 123 passed |
| Redis acceptance | 11 passed: ten substantive behaviors and the enclosing test |
| Lint | Zero errors, eight existing warnings |
| Build, types and CodeQL | Successful |
| Chromium browser checks | 3 built-artifact checks and 131 journeys |
| Firefox browser checks | 3 built-artifact checks and 80 journeys |
| WebKit browser checks | 3 built-artifact checks and 80 journeys |
| Total browser executions | 300 passed; no failed, flaky or skipped result and no retry summary |

Redis tests use an actual isolated Redis instance with provider delivery mocked. The optional funded E2E job was intentionally skipped because its release/manual/label opt-in gate was not enabled. The optional Claude review on an earlier head stopped before reviewing because provider credentials were unavailable and did not run on this final head. Neither is recorded as passing.

GitHub main had no required-check enforcement and no rulesets at release time. A concrete policy is now prepared, but automatic approval review rejected activation because the exact policy had not been explicitly approved. No rule was created. The passing outcomes remain explicit evidence, not enforced merge policy. See the prepared policy below. The browser artifact upload is linked and its reported digest recorded; its archive was not independently downloaded and rehashed.

## Public production checks and exact artifacts

The [public browser receipt](../../evidence/releases/corrective-20261026/public-browser.json) records normal-TLS Chromium checks using disposable browser state against the actual public domains. The wallet showed real Start/Restore onboarding at `claimtest=1`, allowed zoom, decoded its images and produced no horizontal overflow at widths 320, 390 and 1280. No page errors occurred. Ten served wallet files matched their release-manifest hashes and sizes.

The actual served SDK WebAssembly file was **12,311,382 bytes**, SHA-256 **`4fc7fb24e6244c7b94a6f869425537eaf47fe9ee721d31f273b58495d1554b25`**. It matches the vendored SDK archive. Its SDK source is `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`; package SHA-256 is `4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026`.

The website Home, Support and Learn routes passed heading and overflow checks at the same widths. Six network logos decoded after opening the relevant network tab. Unsupported Monad and absolute 100% claims were absent. Six site files matched their manifest hashes and sizes. Security headers and invalid LNURL JSON routing were checked. Contact GET reported configured availability; no contact POST, real email delivery or production Redis acceptance was performed. Malformed LNURL rejection does not prove payment settlement.

A [normal-scroll visual follow-up](../../evidence/releases/corrective-20261026/site-reveal-review.json) at 390 by 844 revealed all ten animated content elements to full opacity without horizontal overflow or page errors. The apparent blank sections in the initial whole-page capture were unvisited scroll reveals. Principal copy and controls rendered. Two minor visual observations remain: decorative Bitcoin/emoji glyphs rendered as boxes in this Chromium environment and the small mining hardware label was partly overlaid by its illustration. These are retained as follow-up observations.

The retained [wallet manifest](../../evidence/releases/corrective-20261026/wallet-release-manifest.json) and [site manifest](../../evidence/releases/corrective-20261026/site-release-manifest.json) name the reviewed source and report `sourceDirty: false`. The shared lock hash is `642a25bebbea06222a1fb0dd38d5876467e7ba1959417cedf8d13983fd29bb47`. Wallet root-config whitespace normalization is recorded. The site build records the observed projection of the unchanged committed `site/vercel.json` into root `vercel.json`; unrelated dirty files, changed settings and staged edits remain rejected. Twenty-three manifest regressions cover these source-boundary cases.

## Upgrade, rollback and dependency limits

Nine final-source worker-policy tests pass. A separate historical local Chromium lifecycle rehearsal exercised nine checkpoints with synthetic localStorage/IndexedDB markers and a frozen onboarding shell. The new worker waited until the old controlled tabs closed and then activated; markers survived offline reload. That rehearsal used earlier source `64408512`, with a build manifest naming `ca9dd2b0` and release `5c148f56fc89789e0a02`. It is not an exact-artifact test of this final release, its newer theme assets or its added legacy-v5 cleanup.

The historical rollback rehearsal observed the legacy worker forcing a controller change and deleting the newer cache. It did not replay a historical application bundle or SDK schema against a real wallet. The immediate prior production wallet was `dpl_5Q5vfPsSVUtMApMYvfg4wmDf6ycW` at source `77cb496a`; the prior website was `dpl_DbFYPCC7DTAnKjT6RB2eUFu95i8a`. Those identifiers are provenance, not safe-rollback approval. Forward containment with the bounded worker policy is preferable while original-origin funded-state rollout and rollback remain unaccepted.

The corrective dependency lock retains **six high and four moderate vulnerable package entries**. All flagged entries are marked as development dependencies in that lock. A historical production-bundle trace at `64408512` found none of the flagged packages in the emitted wallet browser chunks and identified BIP39's PBKDF2 implementation as `@noble/hashes/pbkdf2`. The final lock is byte-identical, but the trace was not rerun on the final source. It does not clear build-time or every serverless runtime path. See [npm audit](../../evidence/releases/corrective-20261026/npm-audit.json) and [the trace](../../evidence/releases/corrective-20261026/dependency-reachability.json). The separate security candidate's zero-finding audit does not transfer to this release.

History scans still lack an SDK transactional snapshot and a stable secondary paging key. Concurrent backfill, deletion and equal-timestamp reorder can affect completeness. A successful scan is not universal proof that a missing payment never executed.

## Remaining real-funds release gates

The latest published draft security candidate is `f5c319882d172ec2710a712aa02f15497b6eb2e7`, tree `aac378618ad62773216d2970ad121ca77b9fd9c2`. It preserves the concurrent passkey guide and fixes the diagnostic hostname check. The following contract and integration records retain their earlier source identity. Its [remaining SDK contracts](https://github.com/Bradvani/getyoursats-wallet/blob/4c5fe8bddb7c71e44f2d0d1748d2b2054d506134/docs/security-review/remaining-sdk-contracts-20261027.md) and [integration evidence](https://github.com/Bradvani/getyoursats-wallet/blob/4c5fe8bddb7c71e44f2d0d1748d2b2054d506134/docs/security-review/final-main-integration-20261027.md) are separate from this live corrective release.

| Gate | Evidence still required |
|---|---|
| A01: storage and lock | Encrypted vault migration and locking accepted with preservation of existing identity, balances, recovery options and local records |
| A02: exact-intent signing | Complete bounded SDK contracts for Lightning claims and fresh or rebuilt unilateral exits |
| A03: uncertain outcomes | Authoritative mature-deposit attempt/outpoint correlation and durable exit build/resume binding after lost acknowledgments and crashes |
| Funded valueless testing | Fresh exact-candidate receive, send, claim, withdrawal and failure-recovery acceptance; the earlier public faucet rejected the funding request with CAPTCHA/bot protection and no funds arrived |
| Devices and recovery | Physical iPhone/Android, installed PWA, passkey/phrase and separate-device recovery; original-origin old/new wallet-state acceptance |
| Critical UX | Critical-flow translations, RTL and accessibility acceptance |
| Independent approval | Qualified review of the exact application, SDK patch, dependency lock and deployed artifacts |

The source README, site metadata and `llms.txt` are corrected. GitHub's repository About description and homepage were also saved in the authenticated owner session and independently verified through repository GET at update time `2026-10-26T23:45:53Z`. Search engine or third-party descriptions have not been proven refreshed. None of these metadata edits substitutes for the security gates.

No real-money transfer or support email was sent during this work. No existing wallet was reset or forcibly migrated. This evidence supports the corrective release described above and does not certify real-funds adoption.

## Corrected security-CI snapshot and metadata completion

The [separate corrected security-CI snapshot](../security-review/final-candidate-ci-20261026.md) covers historical candidate `4c5fe8bd`. Five of six Actions workflows passed, but the separate CodeQL security verdict failed with one high-severity diagnostic-host finding. The dedicated Firefox job timed out during dependency installation before any security or rollback assertions. One retry call was invoked but never acknowledged before interruption after 1,375.4 seconds; acceptance is unknown and no duplicate call was submitted. The original source-specific browser results remain valid within their stated limits.

The saved repository About description is **GetYourSats: a Bitcoin wallet for everyday payments with Lightning, Spark and on-chain interoperability.** The saved homepage is **https://getyoursats.com**. The [completion receipt](../../evidence/releases/corrective-20261026/github-about-corrected-20261026.json) and [owner-session screenshot](../../evidence/releases/corrective-20261026/github-about-corrected-20261026.jpg) establish those fields. The earlier passkey sign-in screenshot remains historical evidence of the resolved login blocker.

## Prepared main protection policy

The [exact prepared policy](../../evidence/releases/corrective-20261026/main-protection-prepared-20261026.json) targets the repository's default branch, currently `main`. It requires pull requests, up-to-date branches and the GitHub Actions checks `verify`, `setup-smoke` and `Analyze (javascript-typescript)`. A separate CodeQL rule blocks high-or-higher security alerts and errors. Force pushes and deletion are blocked with an empty bypass list, including no owner exception. The required reviewer count stays zero because a qualified independent security reviewer has not yet been established; independent release approval remains a separate gate.

Automatic approval review rejected the Create action because the user had not explicitly approved this exact consequential policy. It can block legitimate merges if required checks are missing, failing or stale. The [prepared form](../../evidence/releases/corrective-20261026/main-protection-prepared-20261026.jpg) is retained, no rule was created and no workaround or second activation attempt was made. Explicit owner approval is the final step for this configuration.
