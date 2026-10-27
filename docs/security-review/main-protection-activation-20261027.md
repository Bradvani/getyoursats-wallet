# Main branch protection activation

## Result

**Activated and verified.** The repository owner approved the exact prepared default-branch policy and completed GitHub's account verification. GitHub created [main-release-protection](https://github.com/Bradvani/getyoursats-wallet/rules/25954746), ID `25954746`, on **27 October 2026 at 17:33:21 IST**.

The approved baseline is the [policy at 44980ac2](https://github.com/Bradvani/getyoursats-wallet/blob/44980ac254685c0d498b7665e338cd317a7f64e8/docs/security-review/main-branch-policy-20261027.md). The current [policy document](main-branch-policy-20261027.md) records activation. The prior automatic-review rejection was resolved through explicit approval before the creation action.

## Verified configuration

| Control | Saved and effective value |
| --- | --- |
| Enforcement | Active |
| Branch target | Default branch, currently `main`; no exclusions |
| Bypass actors | None; current-user bypass is `never` |
| Pull request | Required |
| Required approvals | Zero |
| Required checks | `verify`, `setup-smoke`, `Analyze (javascript-typescript)` |
| Source of each check | GitHub Actions, integration `15368` |
| Branch freshness | Strict; branch must be current with the target |
| Code scanning | CodeQL; security threshold `high_or_higher`, alert threshold `errors` |
| Force pushes | Blocked by `non_fast_forward` |
| Branch deletion | Blocked by `deletion` |

The effective-rules response for `main` contains exactly these five rule types, all sourced from ruleset `25954746`: `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks` and `code_scanning`. No paid service, deployment status, signed-commit requirement or linear-history requirement was added.

## Evidence and verification

Original decoded API responses, their byte lengths and SHA256 digests are retained in the [activation evidence directory](evidence/main-protection-active-20261027/). The [receipt](evidence/main-protection-active-20261027/receipt.json) records the validation result and observation bounds.

- [Saved ruleset response](evidence/main-protection-active-20261027/after_ruleset.json)
- [Effective rules for main](evidence/main-protection-active-20261027/effective-main-rules.json)
- [Saved UI screenshot](evidence/main-protection-active-20261027/active-ruleset.jpg)
- [PR43 metadata snapshot](evidence/main-protection-active-20261027/pr43.json)

The UI displayed **Ruleset created**, **Active**, **Bypass list is empty** and **Applies to 1 target: main**. An independent internal read-only check compared the saved and effective rules with the approved values. This is configuration verification, not qualified independent security approval.

The connector supports saved-ruleset reads but rejected the effective-rules endpoint as an unsupported URL. A normal unauthenticated public HTTPS GET retrieved that response after the public-read escalation was approved. It was not an authentication or access-control workaround.

The effective-rules read occurred after `2026-10-27T12:04:13Z` and before `2026-10-27T12:05:16.776994Z`; its exact observation timestamp was not retained. The saved-ruleset read completed no later than the root clock snapshot `2026-10-27T12:04:12Z`.

## Release boundary

PR43 remains **draft, open and unmerged** at `c47ffeda0550f08e3cda994bba06c9745adbdc3a`. Main remains `07ddf16068cc5bd7ed09397e221800ad7b12d767`. The application candidate was not moved, no merge was attempted and no production deployment was performed during this activation.

This completes the approved repository-protection action. The [real-funds release gates](reconciled-release-gates-20261027.md) remain open where previously recorded, including legacy-storage ownership and migration, execution and interruption-recovery contracts, provider acceptance, physical-device recovery and qualified independent review. Green CI and branch protection do not close those gates.
