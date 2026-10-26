# GetYourSats public website

This directory versions the public marketing site hosted separately at `getyoursats.com`. The production wallet remains at `wallet.getyoursats.com` and is not changed by this site release.

## Experience v5

- `index.html`: the approved Brand Kit v2 landing page and the four product-specific Experience scenes
- `experience-v5.css`: scoped responsive product-preview design and motion, with reduced-motion support
- `experience-v5.js`: isolated UI walkthroughs (self-custody setup, USDC/USDT ↔ sats routes, merchant POS and recurring-buy planning)
- `assets/favicon-light.svg`: approved alternate light-monogram shape with Bitcoin-orange badge, optimized for browser tabs
- `scripts/build-favicons.mjs`: regenerates 16/32/48/64/180px PNGs and `favicon.ico` from the unchanged SVG master
- `support.html`, `privacy.html`, `delete-account.html`, `api/contact.js`: public support pages and contact delivery, kept intact

Preview illustrations **do not** create wallets, sign transactions, generate payable invoices or execute swaps. Merchant POS is accessible in the wallet; recurring fiat purchases remain labelled Coming soon. Actual quotes and fees are only presented during a live wallet operation.

## Deployment

The website currently uses a direct Vercel deployment on project `getyoursats-site`; it is not yet Git-connected. Do not deploy the wallet Vercel project in place of the marketing site. For a fresh deployment of this folder:

1. Run `npm ci` from repository root and `node site/scripts/build-favicons.mjs` to generate binary assets from the approved SVG.
2. Deploy the contents of `site/` as static files, retaining `api/contact.js`, `api/breez-lnurl.js` and `server/breezLnurlProxy.mjs`. Preserve the security headers, `robots.txt`, `sitemap.xml` and LNURL rewrites in `vercel.json`.
3. Keep the server-side encrypted Vercel environment variables `RESEND_API_KEY`, `GETYOURSATS_SUPPORT_FROM` and `GETYOURSATS_SUPPORT_TO` in the marketing-site project's Production environment.
4. Verify `/support`, `/privacy`, `/assets/favicon-light.svg`, `/favicon.ico` and `/api/contact` after deployment.

The native Lightning-address proxy additionally uses server-only `BREEZ_LNURL_PROXY_SECRET`. Keep new registrations disabled until the shared verified-email database and wallet integration are ready. See [the native address rollout](../docs/native-lightning-domain-rollout.md) for deployment and rollback checks. If files are uploaded directly after local favicon generation, set the uploaded build/install commands to empty without changing the committed reproducible build commands.

The favicon asset URLs use `?v=4` to avoid older browser-tab icon caches. The site's other branding and wallet payment code should not be changed as part of this release.

## V5 QA invariants

- A reverse route changes source and destination identity, not just arrow direction; no demo converts real funds.
- Experience POS is a narrative animation, not a duplicate of the dedicated merchant counter below.
- Recurring buys use an illustrative, pausable four-contribution rolling timeline and remain labelled Coming soon.
- The sats slider and wheel are both linear over 1–100,000,000 sats: 25M = 25%, 50M = 50%, 75M = 75%.
- The hero animates illustrative incoming sats and cross-rail value without inventing a funded user account.
- Reduced-motion preferences replace automatic animations with completed readable states; keyboard navigation remains usable.
## Bitcoin-first network showcase

The marketing page features **seven curated network examples**:
Ethereum, Solana, Base, BNB Chain, Arbitrum, TRON and Monad as a curated *visual* gallery. These are not a guarantee of active receive/send routes; Monad is not yet confirmed in live receive routing. It keeps the USDC/USDT
selector and the sats ↔ stablecoin reversal so visitors can understand
the wallet's purpose without a technical swap diagram.

**Runtime availability is authoritative.** The Breez Spark SDK discovers
routes by token, network, direction, provider and destination. The site
must not claim that all listed chains work simultaneously for every asset
or transfer direction. When a visitor needs a specific network, direct
them to the wallet to check available routes and review a live quote.

No route is quoted, funded or executed by the marketing preview.
The previous four-step technical Spark/Flashnet journey was intentionally
removed to keep the public experience friendly to first-time Bitcoin users.

## Seven-chain logo gallery (October 2026)

The Bitcoin-First Routes card features seven user-selected networks: Ethereum, Solana, Base, BNB Chain, Arbitrum, TRON and Monad. Original chain logos are served from the Trust Wallet assets repository (the same upstream logo source used by the wallet's CryptoIcon component). Every image URL was checked for HTTP 200. The marketing gallery is **not** derived from a live `getCrossChainRoutes` response. Asset, direction, and provider availability are determined at runtime in the actual wallet; Monad routes are explicitly unconfirmed.

## Network gallery visual finish

The seven official third-party logo files are kept unchanged. Their *presentation* is normalized: a single hairline-bordered editorial rail, equal optical sizing and centrally aligned labels without individual heavy cards. At narrow widths, the four-plus-three arrangement is deliberately centered rather than leaving a blank eighth tile. The live-route caveat and the direct wallet route checker remain unchanged.
