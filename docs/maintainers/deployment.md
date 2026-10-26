# Deployment and configuration

## Separate applications

| Application | Source | Build/output | Public host |
| --- | --- | --- | --- |
| Wallet/PWA | Repository root | `npm run build` → `dist/` | `wallet.getyoursats.com` |
| Website | `site/` | Static files plus contact and LNURL endpoints; use `site/vercel.json` | `getyoursats.com` and `www.getyoursats.com` |

Inspect the target Vercel project and its current domain assignment before releasing. Do not assume `main`, the latest PR head and the live domain resolve to the same commit. For a direct website deployment, record the Git commit, clean source tree and generated-asset hashes explicitly.

## Environment boundaries

Every `VITE_` variable is public after a build. `VITE_BREEZ_API_KEY` must be a provider-approved browser-distributable key. Keep server credentials, including Resend and datastore keys, in the relevant project's server environment using sensitive/Secret storage where supported. Do not copy credentials into documentation, issue bodies, browser bundles or test artifacts.

`VITE_STAGING_PASSWORD` is only a client-side preview convenience. It is not access control: the value and gate are delivered to the browser. Use hosting-level deployment protection for private previews.

For the website contact endpoint, configure `RESEND_API_KEY`, `GETYOURSATS_SUPPORT_FROM` and `GETYOURSATS_SUPPORT_TO` on the website project. Keep the sender verified, the inbox monitored and delivery privileges limited to the required service. Confirm delivery and a reply using an explicitly authorized test; a successful availability response alone is not delivery evidence.

The website also serves native Lightning-address routes. Preserve existing-name lookup, invoice callbacks and signed recovery when pausing new registrations. Follow the [native address rollout](../native-lightning-domain-rollout.md) for proxy, shared-datastore and rollback requirements.

Preserve passkey origins, RP IDs and wallet storage compatibility. Changing a hostname, branding or provider must not silently derive or connect a different wallet. Configure optional email, Lightning-address and purchase services only after their individual rollout requirements pass.

## Release record

Record all of the following with each release:

1. Full application commit SHA, SDK source revision and vendored artifact hash.
2. Build environment, commands, results and any skipped checks.
3. Preview and production deployment IDs, feature-gate state without secret values, and assigned domains.
4. Relevant browser/device, recovery and settlement evidence; distinguish mocks from live operations.
5. Approved rollback target and the state/schema versions it can safely read.
6. Post-release checks and the person responsible for triage.

Follow [release readiness](release-readiness.md). Test a preview before promoting the exact reviewed artifact. Never use a domain promotion to imply approval of unrelated draft security work.
