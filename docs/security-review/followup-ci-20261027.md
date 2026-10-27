# Diagnostic-host follow-up: CI evidence

Observed **27 October 2026, 00:15:38 UTC**. All seven Actions workflows and the separate CodeQL security verdict passed on draft PR #43 head `f5c319882d172ec2710a712aa02f15497b6eb2e7`. **The candidate remains unapproved for production or expanded real-funds adoption.**

The [machine-readable receipt](../../evidence/security-review/followup-ci-20261027.json) records each workflow and check, source identity, actual counts and limits. This evidence is specific to the diagnostic-host fix and preserved passkey support guide. It does not cover the subsequent SDK source work.

## Source identity

The published tree is `aac378618ad62773216d2970ad121ca77b9fd9c2`, equal to local integration commit `b042afc208d75ef4685aacd75d84f3e8027175a9`. The actual PR test merge `821fef2a5bcbb4a531df679e38246062c332d92d` has the same tree and parents `72f92220078a2c4628a408fe82d4beb27d944e1c` and `f5c319882d172ec2710a712aa02f15497b6eb2e7`. This confirms the tested content includes the current corrective main release.

The update preserves concurrent support-guide commit `2993b24409f9734b7fc4f7c80a8b9cba39b13d63`. It fixes diagnostic Lightspark hostname matching, adds 22 offline URL regressions, gives four historical workflow checks distinct names and makes three completed source-writing integration jobs manual-only. No alert was dismissed or suppressed. The SDK package and production interlock are unchanged.

## Observed results

| Verification | Result |
|---|---|
| Actions workflows | Seven of seven successful |
| Separate CodeQL security verdict | Success: no new alerts in code changed by this PR |
| Unit suite | 1,482 passed, one opt-in Core case skipped; 147 files passed and one skipped |
| Node service and policy | 145 passed, including the 22 new hostname regressions |
| Actual isolated Redis | 11 passed with external email delivery mocked |
| Lint | Zero errors, eight existing warnings |
| Broad browser suite | 305 passed: nine built-artifact, 136 Chromium and 160 Firefox/WebKit executions |
| Dedicated security and rollback | Chromium, Firefox and WebKit each passed seven security and nine rollback cases |
| Separate Chromium checkpoint | Seven passed |
| Separate rollback artifact | Nine passed |
| Installed SDK checks | 36 mnemonic, 108 raw-seed, 18 revocation/guard, 17 PBKDF2 and 12 API/artifact checks passed without network calls |
| Dependency audit | Zero findings in both all-dependency and runtime scopes |
| Production build interlock | Expected refusal verified |
| Optional funded E2E | Intentionally skipped |

The [separate CodeQL verdict](https://github.com/Bradvani/getyoursats-wallet/runs/121923399518) is distinct from the successful analysis workflow. It resolves the new-alert condition on this source; it does not assert that every historical alert or possible vulnerability is absent.

The [broad browser run](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40423400397) reported all 9, 136 and 160 planned cases passing with no failure, flaky, skip or retry summary. Counts are separate executions and overlapping suites, not unique security guarantees. The added passkey guide has automated browser coverage; physical cross-device restoration and language accuracy remain separate acceptance work.

## Earlier results remain historical

The [corrected earlier snapshot](final-candidate-ci-20261026.md) retains the failed high-severity CodeQL verdict on `4c5fe8bd`, the original Firefox setup timeout and the later retry invocation whose acceptance was never acknowledged. The successful Firefox job on this follow-up is a new source-triggered run. It does not prove the ambiguous retry was accepted or change the earlier cancellation into a pass.

The live corrective wallet and website retain source `13f7ff73` and their recorded deployment identities. No security-candidate promotion, real-money transfer, hosted funded acceptance, faucet retry, support email, physical-device acceptance or qualified independent release review occurred in this follow-up.
