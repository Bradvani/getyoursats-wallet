# Active protection for the default branch

## Status

The repository owner explicitly approved activation of the prepared policy. GitHub created **`main-release-protection`**, ruleset **`25954746`**, with active enforcement on **27 October 2026 at 17:33:21 IST** (`2026-10-27T12:03:21Z`).

The saved configuration and the effective rules for `main` match the approved policy. The bypass list is empty and GitHub reports `current_user_can_bypass: never`. See the [activation receipt](main-protection-activation-20261027.md) for original API responses and the saved UI screenshot.

The earlier [prepared policy at commit 44980ac2](https://github.com/Bradvani/getyoursats-wallet/blob/44980ac254685c0d498b7665e338cd317a7f64e8/docs/security-review/main-branch-policy-20261027.md) remains the immutable approval baseline. Automatic approval review had previously rejected activation because explicit authorization was missing; activation followed that authorization and GitHub's account verification. There was no bypass of the review rejection.

An unavailable required check can block legitimate merges, including owner merges. This is the approved consequence of enforcing the policy without bypass actors.

## Activated policy

| Setting | Active value |
| --- | --- |
| Repository | `Bradvani/getyoursats-wallet` |
| Target | The default branch, currently `main` |
| Enforcement | Active |
| Bypass actors | None, including the repository owner |
| Pull request | Required before merge |
| Approving reviews | Zero required; this does not replace the independent security release gate |
| Required status checks | `verify`, `setup-smoke` and `Analyze (javascript-typescript)` |
| Status-check source | GitHub Actions, app ID `15368` |
| Up-to-date requirement | The pull-request branch must be current with the target branch |
| Code scanning | Require CodeQL results and block high-or-higher security findings and error-severity findings |
| Force pushes | Blocked |
| Branch deletion | Blocked |

The policy does not add a paid service, require the optional funded end-to-end workflow, require a Vercel status, require signed commits or require linear history.

## Verified check availability

All three named checks reported success on PR #43 source [`6c695aa6`](https://github.com/Bradvani/getyoursats-wallet/commit/6c695aa6ce3f39a3fb2f0915e10df1ffa0b80129). Their reported app ID was `15368`. The `setup-smoke` job runs on pull requests, so its absence from a later merge-commit check list is expected. This establishes the configured check names, not approval of a later security candidate.

The final candidate `c47ffeda0550f08e3cda994bba06c9745adbdc3a` also reports all three proposed required checks successful, with GitHub Actions app ID `15368`, at the final 10:25:03 UTC snapshot:

| Required check | Observed check/job ID | Conclusion |
| --- | --- | --- |
| `verify` | `122130541385` | Success |
| `setup-smoke` | `122130541321` | Success |
| `Analyze (javascript-typescript)` | `122130541293` | Success |

The separate CodeQL findings check `122130969914` succeeded with no new alerts reported in PR-changed code and zero annotations. The [final CI receipt](pr43-recovery3-ci-20261027.md) retains its scope and the analyzer warnings. These observations establish current check identities and outcomes, not activation of this policy or real-funds clearance.

## Activation verification

The pre-activation read confirmed that the default branch was `main`, the rulesets list was empty and PR43 still referenced source `c47ffeda0550f08e3cda994bba06c9745adbdc3a`. No intervening ruleset was overwritten.

After creation, GitHub's saved ruleset API and its effective-rules API for `main` both showed all five approved rule types. The UI displayed **Ruleset created**, **Active**, **Bypass list is empty** and **Applies to 1 target: main**. No test push, merge attempt or production deployment was used to verify the policy.

PR43 remains draft and unmerged at the same candidate. Main remains `07ddf16068cc5bd7ed09397e221800ad7b12d767`.

Repository protection is an additional merge control. It does not close the SDK execution and recovery contracts, physical-device acceptance or independent security review described in the [release gates](reconciled-release-gates-20261027.md).
