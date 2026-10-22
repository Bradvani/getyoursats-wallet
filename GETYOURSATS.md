# GetYourSats integration build
Forked from Breez Glow (MIT). Original upstream license retained. This branch replaces onboarding and core branding, adds a merchant POS using the actual Spark SDK invoice method and preserves upstream Bitcoin/Lightning send/receive/recovery.

## Important boundaries
- All Start paths currently route through the upstream mnemonic backup screen, including native. Immediate anonymous access without proven recovery is an explicit release blocker, not a completed feature.
- A Spark Bitcoin deposit address is not independently controlled on-chain UTXO custody.
- Merchant POS creates invoices, **not settlement receipts**; do not release goods without verified payment status.
- Email login, Lightning Address domain services, Indian exchange partner ramps, UPI AutoPay, income tax integrations and multi-tenant APIs remain unconnected.
- Need approved VITE_BREEZ_API_KEY for mainnet; Vite variables are bundled into client and require an explicitly client-shareable provider key.
- This branch requires CI TypeScript/build/unit/e2e validation, testnet/regtest payments, independent security review and regulatory signoff before funds-enabled release.

## Branded Lightning address integration
Breez Spark supports custom hosted Lightning Address domains. The branded domain configuration is **deliberately disabled** until verified email ownership, backend username entitlement checks, and Breez DNS/domain approval are live. The wallet continues using the upstream LNURL domain. Before activating: own/control the DNS, register the domain and SDK API key with Breez, arrange CNAME or LNURL proxy and complete email verification plus entitlement checks for username claims. The environment configuration is implemented here, **not the identity verification nor DNS setup**.
Docs: https://sdk-doc-spark.breez.technology/guide/custom_domain.html

## API key request and deployed preview
Use [Breez SDK official form](https://breez.technology/sdk/) to contact Breez for a client-distributable key. [SDK onboarding docs](https://sdk-doc-spark.breez.technology/guide/getting_started.html). The previously shared `https://breez.technology/contact/apikey` is meant for programmatic POST, not browsing.

The web PWA is a demo/reference foundation; the upstream project explicitly says its web demo is not intended for production use. No public real-funds release without security and recovery sign-off. Exact Vercel deployment needs auditing in the owning Vercel team (not the separate previously connected account).
