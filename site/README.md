# GetYourSats public website

This directory versions the public marketing site hosted separately at `getyoursats.com`. The production wallet remains at `wallet.getyoursats.com` and is not changed by this site release.

## Experience v4

- `index.html`: the approved Brand Kit v2 landing page and the four product-specific Experience scenes
- `experience-v4.css`: scoped responsive product-preview design and motion, with reduced-motion support
- `experience-v4.js`: isolated UI walkthroughs (self-custody setup, USDC/USDT ↔ sats routes, merchant POS and recurring-buy planning)
- `assets/favicon-light.svg`: approved alternate light-monogram shape with Bitcoin-orange badge, optimized for browser tabs
- `scripts/build-favicons.mjs`: regenerates 16/32/48/64/180px PNGs and `favicon.ico` from the unchanged SVG master
- `support.html`, `privacy.html`, `delete-account.html`, `api/contact.js`: public support pages and contact delivery, kept intact

Preview illustrations **do not** create wallets, sign transactions, generate payable invoices or execute swaps. Merchant POS is accessible in the wallet; recurring fiat purchases remain labelled Coming soon. Actual quotes and fees are only presented during a live wallet operation.

## Deployment

The website currently uses a direct Vercel deployment on project `getyoursats-site`; it is not yet Git-connected. Do not deploy the wallet Vercel project in place of the marketing site. For a fresh deployment of this folder:

1. Run `npm ci` from repository root and `node site/scripts/build-favicons.mjs` to generate binary assets from the approved SVG.
2. Deploy the contents of `site/` as static files, retaining `api/contact.js` as the serverless endpoint.
3. Keep the server-side encrypted Vercel environment variables `RESEND_API_KEY`, `GETYOURSATS_SUPPORT_FROM` and `GETYOURSATS_SUPPORT_TO` in the marketing-site project's Production environment.
4. Verify `/support`, `/privacy`, `/assets/favicon-light.svg`, `/favicon.ico` and `/api/contact` after deployment.

The favicon asset URLs use `?v=4` to avoid older browser-tab icon caches. The site's other branding and wallet payment code should not be changed as part of this release.
