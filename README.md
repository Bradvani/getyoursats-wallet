# GetYourSats

**Bitcoin for everyday payments.**

GetYourSats is a standalone Bitcoin wallet for everyday payments. It brings sending, receiving and merchant Point of Sale into one product. This repository contains the React browser/PWA application and the public website.

[Open the wallet](https://wallet.getyoursats.com) · [Explore GetYourSats](https://getyoursats.com) · [Get help](https://getyoursats.com/support)

## What you can do

- Send and receive Bitcoin through supported Lightning, Bitcoin and Spark routes.
- Review the recipient, asset, network, amount and quoted costs before a payment.
- Use available USDC/USDT routes to move between supported networks and your wallet balance.
- Request a Lightning payment with Merchant Point of Sale and check its settlement status.
- View recent payments, transaction details and available history exports.
- Choose your display currency, language and appearance.

Route availability depends on the asset, network, direction, provider and destination. The wallet's live quote is authoritative; a network illustration on the website is not a promise of an available route. Buy Bitcoin and recurring fiat purchases are not currently enabled. Personal Lightning addresses use optional email verification and provider-confirmed registration. See the [product boundaries](GETYOURSATS.md).

## Your wallet and recovery

GetYourSats uses the Breez Spark SDK for wallet and payment infrastructure. Bitcoin received through an on-chain deposit is credited through Spark; this is not a separate native Bitcoin UTXO wallet. [How your wallet works](https://getyoursats.com/support#how-your-wallet-works) explains the distinction.

Keep the recovery method for your existing wallet safe. Email and support cannot recover lost keys. Browser, passkey and native protections differ: read the [security guidance](SECURITY.md) before using or modifying the wallet. A successful build or an available website is not a security certification.

## Develop locally

Use Node.js 22, matching CI, and npm.

```sh
npm ci
cp example.env .env.local
# Configure an approved, browser-distributable Breez SDK key locally.
npm run dev
```

All `VITE_` variables are embedded in browser code. Never put a private server credential in one. Request a suitable SDK key through [Breez](https://breez.technology/sdk/) and follow its [SDK setup documentation](https://sdk-doc-spark.breez.technology/guide/getting_started.html).

For changes, tests and review expectations, start with [CONTRIBUTING.md](CONTRIBUTING.md). Use disposable fixtures for development; real-value testing requires a separately agreed test plan.

## Repository guide

| Area | Contents |
| --- | --- |
| `src/` | Wallet application, payment flows and local preferences |
| `api/`, `server/` | Wallet service endpoints and server-side integrations |
| `public/` | Wallet static assets, PWA resources and public help pages |
| `site/` | Public website and its contact endpoint; deployed separately |
| `e2e/`, `tests/` | Browser and service tests |
| `vendor/` | Pinned Breez SDK distribution and source reference |
| [docs/](docs/README.md) | Architecture, contributor guidance and dated engineering records |

## Support and contributions

For wallet or payment help, use [GetYourSats Support](https://getyoursats.com/support#contact). Report vulnerabilities privately using [SECURITY.md](SECURITY.md). For non-sensitive bugs and improvements, include reproduction steps and the affected commit in a GitHub issue or pull request. Never include recovery words, private keys, credentials or unredacted wallet logs.

## Open-source foundation

GetYourSats builds on the MIT-licensed [Breez Glow web implementation](https://github.com/breez/glow-web) and [Breez Spark SDK](https://github.com/breez/spark-sdk). Upstream copyright and license notices are retained. See [LICENSE](LICENSE).
