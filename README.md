# GetYourSats Wallet

Standalone GetYourSats Bitcoin/Lightning wallet foundation, forked from the MIT-licensed [Breez Glow web reference implementation](https://github.com/breez/glow-web). Upstream copyright and license notices are retained.

## Current release status

This repository builds and runs a Breez Spark-backed React wallet. **This is not yet a funds-enabled public beta**. The wallet depends on an approved Breez API key and independent device/web security and recovery testing. The web PWA has the upstream recovery-phrase storage security trade-offs.

GetYourSats-specific features: official brand, one-button Start, SDK-backed Lightning merchant POS, and build/test CI. See [GETYOURSATS.md](GETYOURSATS.md) for implementation boundaries.

### Run locally

```sh
npm ci
cp example.env .env.local
# Replace tutorial placeholders in .env.local with an approved Breez SDK key.
npm run dev
```

### Deploy to Vercel

- Import `Bradvani/getyoursats-wallet` as a **single Vite project** from the repository root `./`.
- Build command: `npm run build`; output directory: `dist`.
- Configure **VITE_BREEZ_API_KEY** for the relevant environments with a provider-approved *browser-distributable SDK key*. Vite embeds it into client JavaScript; do not use a private server API secret here.
- Deploy to a protected preview until the funds-enabled release gates pass.
- Domain setup and LNURL are separate from wallet host/domain; a username under GetYourSats requires verified email ownership and an approved LNURL domain.

Official setup instructions: https://sdk-doc-spark.breez.technology/guide/getting_started.html

To request an API key, use the contact form on https://breez.technology/sdk/ (the `/contact/apikey` path is a programmatic POST endpoint, **not** an ordinary browser page).

### Release blockers

- Real funded Lightning send/receive, Spark deposit/withdrawal and restore testing
- Verified merchant POS settlement and crash/reload recovery
- Independent wallet security assessment and signed native builds
- Email account linking and unique LNURL username claims
- Contracted Indian fiat/UPI/exchange APIs, KYC/compliance and tax reporting
- Verified Vercel environment/deployment logs (different account scopes may apply)

Do not treat green TypeScript/unit tests as wallet acceptance certification.
