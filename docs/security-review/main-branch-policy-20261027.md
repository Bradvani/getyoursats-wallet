# Prepared protection for the default branch

## Status

This policy is prepared for approval. It is **not active**. The public repository rulesets endpoint returned an empty list on 27 October 2026 at 10:22:35 UTC; the earlier 07:37 observation is retained in the candidate history. This endpoint does not establish classic branch-protection settings. No policy was created or activated in this continuation.

Automatic approval review previously rejected activation because this exact consequential default-branch policy had not been explicitly authorized. Activation can block legitimate merges if a required check becomes unavailable. The proposed policy includes no owner bypass, so that consequence also applies to the repository owner.

## Exact policy to approve

| Setting | Prepared value |
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

## Activation handoff

Obtain explicit approval for the policy above before activation. Re-read the current rulesets and default branch first to preserve any intervening owner change. Verify the saved rule and its effective branch targeting after activation. Do not bypass the earlier automatic-review rejection through another administrative tool.

Repository protection is an additional merge control. It does not close the SDK execution and recovery contracts, physical-device acceptance or independent security review described in the [release gates](reconciled-release-gates-20261027.md).
