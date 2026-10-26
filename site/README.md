# GetYourSats website

The public website introduces GetYourSats, explains Bitcoin and provides support. It is deployed separately from the wallet at `wallet.getyoursats.com`.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Product introduction, educational explorer and feature previews |
| `experience-v5.css`, `experience-v5.js` | Responsive interactive previews and motion |
| `support.html` | Wallet explanations, lessons and contact form |
| `privacy.html`, `delete-account.html` | Privacy and account-removal information |
| `api/contact.js` | Server-side contact delivery |
| `api/breez-lnurl.js`, `server/breezLnurlProxy.mjs` | Native Lightning-address proxy and registration policy |
| `scripts/build-favicons.mjs` | Generates favicon assets from the SVG master |
| `vercel.json` | Website routing and deployment configuration |

## Product claims and illustrations

Previews illustrate a journey; they do not create wallets, sign transactions, generate payable invoices or execute swaps. Keep simulated amounts visibly illustrative. Merchant payments are available in the wallet. Recurring purchases must remain labelled coming soon until an executable service is verified.

The network gallery is editorial, not a live route directory. SDK availability varies by asset, chain, direction, provider and destination. Keep the route caveat visible and direct users to a live wallet quote. Do not promote an unverified network as an available payment route.

Lead with GetYourSats. Keep infrastructure explanations in **How your wallet works** and where they affect a user's decision. Support content must distinguish recovery, network settlement and optional account services accurately.

## Maintain and verify

Install dependencies from the repository root. When changing the favicon master, run:

```sh
node site/scripts/build-favicons.mjs
```

Verify mobile, tablet and desktop layouts, keyboard navigation, text zoom, language selection and reduced motion. Animations should pause when hidden and should not compete with reading or form entry. Keep support anchors, footer links and the wallet link working. Check the website tests in `e2e/tests/` and `tests/contact-enquiries.test.mjs` for relevant coverage.

Keep corresponding public help/privacy/removal content under `public/` consistent where the wallet serves its own copies. Do not copy website deployment status into the wallet's release description.

## Deployment

Use the website project and configuration in this directory. Record the source SHA and generated assets even for direct deployments. Configure the contact endpoint's server credentials on that project only; keep Resend keys out of browser code and source control.

Preserve `api/contact.js`, `api/breez-lnurl.js`, `server/breezLnurlProxy.mjs`, security headers, `robots.txt`, `sitemap.xml` and LNURL rewrites. The website also serves payment discovery for personalised Lightning addresses; a marketing deployment must not interrupt those routes.

The native address proxy uses server-only `BREEZ_LNURL_PROXY_SECRET` and the shared verified-email datastore. Follow the [native address rollout](../docs/native-lightning-domain-rollout.md) for registration gates, identity checks and rollback. Pausing new registrations must preserve public payments and recovery for existing names.

Follow the [deployment guide](../docs/maintainers/deployment.md). After a release, verify `/`, `/support`, `/privacy`, `/delete-account`, favicon assets, contact availability and the existing-name LNURL routes. Verify actual contact delivery and a reply using an authorized test. For direct uploads, generate assets first and record source/artifact hashes; preserve the committed reproducible build configuration.
