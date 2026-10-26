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

## Recovery-first passkey onboarding (2026-10-23)
- A single **Start** button selects Breez's existing PRF-derived passkey onboarding if the device supports PRF and an explicit stable, audited origin is configured.
- Required for browser: `VITE_GETYOURSATS_PASSKEY_ORIGIN=https://the-canonical-wallet-host`. Preview branch URLs and unapproved origins fail closed to handwritten BIP39 setup.
- Native builds also require `VITE_GETYOURSATS_NATIVE_PASSKEY_READY=true` only after Associated Domains / Digital Asset Links, native passkey plugin support and cross-device recovery have been verified. This flag is **not** permission to skip testing.
- Passkey wallets derive their Bitcoin seed via WebAuthn PRF, not via a custodial email identity. The existing Backup page can re-derive and display the *same* wallet mnemonic after passkey authentication. This manual backup is **optional** but strongly recommended because losing a passkey without backup can lose funds.
- **Removed** mnemonic clipboard export in onboarding and Backup. Manual setup now requires an offline two-word verification check before connecting the wallet. Native phrase screens request OS screenshot protection when supported; web browsers cannot enforce blocking screenshots or browser extensions.
- This is not a GetYourSats cloud-backup server: account/email linking, provider sync diagnostics, authenticated restore on a second device and RP migration still require testing/implementation. PRF-compatible synced passkeys work according to the provider and domain configuration.
- Never enable a passkey relying party on temporary Vercel PR hostnames. A future custom-domain change needs credential migration strategy.
- Reference: https://sdk-doc-spark.breez.technology/guide/passkey.html .
