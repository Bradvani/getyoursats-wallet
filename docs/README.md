# Engineering documentation

For the product introduction, see the [root README](../README.md). For development and review expectations, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Maintained guidance

- [Product capabilities and boundaries](../GETYOURSATS.md)
- [Security reporting and platform boundaries](../SECURITY.md)
- [Deployment and environment configuration](maintainers/deployment.md)
- [Release readiness](maintainers/release-readiness.md)
- [Cross-chain verification](cross-chain-testing.md)
- [Browser and settlement testing](../e2e/README.md)
- [Local regtest setup](../local-regtest/README.md)
- [Public website maintenance](../site/README.md)

## Design and integration references

These documents describe design intent or implementation details. Check their assumptions against the exact commit under review; they are not release approvals.

- [Payment finality architecture](getyoursats-finality-architecture-20261024.md)
- [Stable balance model](stable-balance-spec.md)
- [Unilateral exit model](unilateral-exit-spec.md)
- [Unilateral exit implementation](../src/features/unilateral-exit/README.md)
- [Payment motion](product/payment-motion-v1.md)
- [Payment balance and localization QA](qa/payment-balance-localization.md)
- [Verified email rollout](verified-email-rollout.md)
- [Native Lightning address rollout](native-lightning-domain-rollout.md)
- [Lightning address rollout](wos-style-lightning-alias-rollout.md)

## Dated review evidence

Historical findings may have been fixed, superseded or transferred to another branch. Preserve the original record and cite its commit and date when using it. Never infer current production state from a checklist tick or an old deployment note.

- [23 October source and deployment audit](archive/source-and-deployment-audit-20261023.md)
- [23 October functional audit](archive/functional-audit-20261023.md)
- [23 October release audit](archive/release-audit-20261023.md)
- [23 October integration notes](archive/integration-notes-20261023.md)
- [Implementation register](review/implementation-register.md)
- [Candidate validation](review/candidate-validation.md)
- [25 October security trace](review/security-trace-20261025.md)
- [25 October transaction-authorization review](review/transaction-authorization-P0-20261025.md)

Keep detailed unresolved security reproductions in a private review channel. Public product copy should explain meaningful limitations without exposing credentials or exploit instructions.
