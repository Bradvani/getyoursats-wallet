# Contributing to GetYourSats

Make changes that help people understand, control and recover their Bitcoin. Prefer small, reviewable changes with evidence for the behavior they affect.

## Before you start

Read the [product boundaries](GETYOURSATS.md) and [security guidance](SECURITY.md). Check current pull requests before starting work; a draft, a passing check and a production deployment are different states. Preserve wallet identity, storage compatibility, passkey relying-party configuration and upstream license notices.

Use a topic branch. Do not test with a user's recovery phrase, credentials or funded wallet. Use disposable fixtures and mocked SDK responses first. Local regtest and funded settlement have separate setup and approval requirements.

## Local verification

Use Node.js 22 and the lockfile:

```sh
npm ci
npm run build
npm test
npm run test:email-service
npm run lint
```

Run browser tests relevant to your change. This explicit selection uses UI fixtures and onboarding checks, not funded payment scenarios:

```sh
npx playwright install chromium
npx playwright test --project=chromium getyoursats-desktop-navigation.spec.ts payment-locales.spec.ts send-destination.spec.ts getyoursats-premium.spec.ts getyoursats-landing.spec.ts
```

Read [the E2E guide](e2e/README.md) before running other scenarios. Do not run the entire E2E suite against mainnet by default. A skipped settlement test provides no settlement evidence. Report browser-engine, device and test-environment limitations explicitly.

## Review expectations

Describe the user-visible problem, resulting behavior, exact commit tested and relevant validation. For payment changes, cover incorrect input, cancellation, fee/quote changes, duplicate actions, interrupted execution and reconciliation. For storage changes, prove identity preservation and recovery before removing any prior state.

For interface changes, verify narrow mobile, tablet and desktop layouts, keyboard navigation, 200% zoom and reduced motion. Translate complete journeys, including validation, loading, success, uncertain outcomes and accessibility labels. Financial and recovery wording needs native-speaker review before claiming full localization.

Keep SDK/provider jargon in contextual help when it does not aid a decision. Keep asset, network, recipient, fees, expiry and custody explanations explicit where they do aid a decision.

## Documentation and public claims

- The root README introduces the product and directs contributors to maintained guidance.
- Product availability belongs in [GETYOURSATS.md](GETYOURSATS.md); precise release evidence belongs in the release record.
- Architecture and operational procedures belong in `docs/`. Dated audits belong in `docs/archive/` or `docs/review/` with their scope and commit.
- Keep internal conversation, account-access troubleshooting, temporary approvals and release chat out of public product copy.
- Retain upstream attribution. Do not rename storage keys, passkey identifiers or protocol names as a branding exercise.

Never commit secrets or real recovery material. Report security vulnerabilities privately, not in public issues or PR reproduction steps.

## Release changes

Follow the [deployment guide](docs/maintainers/deployment.md) and [release checklist](docs/maintainers/release-readiness.md). Opening or merging a documentation PR does not authorize a production wallet deployment or establish security readiness.
