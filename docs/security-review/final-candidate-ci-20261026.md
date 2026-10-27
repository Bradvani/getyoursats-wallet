# Historical draft security candidate: corrected CI snapshot

Observed **26 October 2026, 23:29:07 UTC**. **Draft / NO-GO. Not all CI workflows passed and the separate CodeQL security verdict failed.** This evidence-only record does not change application code or promote the candidate.

This snapshot covers earlier [PR #43](https://github.com/Bradvani/getyoursats-wallet/pull/43) head `4c5fe8bddb7c71e44f2d0d1748d2b2054d506134`, tree `a271ade6929e72fc0f17f754242f29da1a96b896`. The actual PR test merge `b9fdc35fb25879bed28f5c820fb262cb3f04a082` and local evidence commit `022ec9dd6609deaef00781e22ec83c923f11a2f4` have that exact tree. The [complete receipt](../../evidence/security-review/final-candidate-ci-20261026.json) supplies workflow/job links, source equivalence, actual counts and artifact metadata.

| Verification | Observed result |
|---|---|
| Unit suite | 1,482 passed, one opt-in Core case skipped, zero unhandled errors |
| Node service and policy | 123 passed |
| Isolated Redis | 11 passed; external email delivery mocked |
| Lint | Zero errors, eight existing warnings |
| Build, types and CodeQL analysis workflow | Passed |
| Separate CodeQL security verdict | Failed: one high-severity hostname-validation alert |
| Broad browser suite | 300 passed: nine built-artifact, 131 Chromium and 160 Firefox/WebKit journey executions |
| Dedicated Chromium security and rollback | Seven security and nine rollback cases passed |
| Dedicated WebKit security and rollback | Seven security and nine rollback cases passed |
| Separate SDK checkpoint Chromium | Seven security cases passed |
| Installed SDK | 36 mnemonic comparisons, 108 raw-seed comparisons, 18 guard assertions, 17 PBKDF2 comparisons and 12 API/artifact checks passed |
| Dependency audit | Zero findings in both all-dependency and runtime audits |
| Production interlock | Expected refusal verified; production remains unapproved |
| Optional funded E2E | Intentionally skipped |

The completed broad browser suites reported no failures, flaky cases, skips or retry summary. Counts are separate executions and overlapping suites, not unique security properties.

## Firefox setup timeout

Five of six workflows completed successfully. The [release-security matrix](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40416890656) was cancelled because Firefox job `121901355353` reached its 20-minute budget during `npx playwright install --with-deps firefox`. Completed logs show very slow Ubuntu/Azure operating-system package downloads. The exact cause of the slow download is unproven. Both security and rollback test steps were skipped, with zero assertions executed. This is a setup failure, not an assertion pass.

The original attempt remains part of the record. One retry of only that job was permitted without source or workflow changes. A retry tool call was subsequently invoked, but it returned no acknowledgment before the assistant interrupted the waiting agent after 1,375.4 seconds. The tool reported `aborted by user after 1375.4s`; no success response, rejection reason or attempt-2 identifier was received. Acceptance remains unknown, and the last observed API state still showed completed/cancelled attempt 1. The old `retryRequested: false` field was a pre-invocation snapshot, not proof that no call occurred. No duplicate retry was submitted. A later run triggered by new source is a separate run.

## Separate CodeQL verdict and source correction

The original snapshot omitted [GitHub Advanced Security check 121901714007](https://github.com/Bradvani/getyoursats-wallet/runs/121901714007). It failed with one high-severity `js/incomplete-url-substring-sanitization` alert at line 87 of `scripts/security/accept-disposable-spark.mjs`. The `endsWith('lightspark.com')` predicate also admitted names such as `evillightspark.com`. That predicate classified diagnostic faucet POST responses; it did not authorize payments. The actual faucet navigation remained a fixed URL and settlement checks still used SDK payment/balance evidence. The [original failed verdict and annotation](../../evidence/security-review/codeql-verdict-4c5-20261026.json) are retained without suppression or dismissal.

Follow-up source `f5c319882d172ec2710a712aa02f15497b6eb2e7` fixes the predicate with parsed HTTPS, exact root-host equality or a dot-bounded subdomain suffix, rejects URL credentials and passes 22 offline regressions. It preserves the concurrent ten-language passkey recovery guide. Four historical checks have distinct display names and three completed source-writing integration workflows are manual-only. Fresh CI and its separate CodeQL verdict must be read for that source; these older test counts do not transfer automatically.

## Acceptance boundary

The security candidate remains draft with its production interlock enabled. The earlier Bitcoin Core mempool/restart/reorg case is pinned to its earlier source and stubs SDK signing; it is not reattributed to this final head or treated as fresh Spark exit acceptance. The earlier public regtest attempt connected two empty disposable wallets but received no funds after a faucet bot/CAPTCHA rejection. No funded route, payment, claim or funding retry occurred in this CI verification.

The [remaining SDK contracts](https://github.com/Bradvani/getyoursats-wallet/blob/4c5fe8bddb7c71e44f2d0d1748d2b2054d506134/docs/security-review/remaining-sdk-contracts-20261027.md) require bounded Lightning execution, authoritative uncertain-deposit recovery and durable fresh/rebuilt exits. Fresh funded final-SDK testing, physical devices, separate-device restoration, original-origin rollout, critical-language/RTL/accessibility acceptance and qualified independent review remain open. Artifact digests in the receipt are GitHub API/upload metadata, not locally downloaded archive hashes.

## Subsequent source verification

The [fresh follow-up snapshot](followup-ci-20261027.md) records seven passing workflows and a successful separate CodeQL security verdict on `f5c31988`. Its dedicated Firefox job passed seven security and nine rollback cases. These are new source-specific results and do not change this historical head's failed verdict or uncertain retry acceptance.
