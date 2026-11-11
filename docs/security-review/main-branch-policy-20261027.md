# Prepared protection for the default branch

## Status

This policy is prepared for approval. It is **not active**. The repository rulesets endpoint returned an empty list on 27 October 2026 at approximately 07:37 UTC. No policy was created or activated in this continuation.

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

## Activation handoff

Obtain explicit approval for the policy above before activation. Re-read the current rulesets and default branch first to preserve any intervening owner change. Verify the saved rule and its effective branch targeting after activation. Do not bypass the earlier automatic-review rejection through another administrative tool.

Repository protection is an additional merge control. It does not close the SDK execution and recovery contracts, physical-device acceptance or independent security review described in the [release gates](reconciled-release-gates-20261027.md).
