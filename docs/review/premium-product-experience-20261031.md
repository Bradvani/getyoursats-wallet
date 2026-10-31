# Product experience release, 31 October 2026

Baseline: `4023ea1bf42ea0a9edbf9d88e0d5e6a9fa0f12dd` (includes passkey confirmation, fee-free GYS routing and the iOS keyboard fixes).

## Customer changes

- Bitcoin Market includes circulating supply, a 21 million supply indicator, estimated market capitalization in the selected currency and Alternative.me Fear & Greed. Currency grouping follows the existing regional formatter. The market amount buttons affect the reference price only, never total supply or market capitalization.
- Market capitalization uses issued BTC multiplied by the existing current fiat/BTC rate. It is labelled as an estimate in Sources & Method. Supply comes from Blockchain.com, with its actual timestamp. Issued supply includes lost coins. Sentiment uses the provider's classification and actual daily timestamp, with adjacent attribution.
- Public market data is fetched by fixed server endpoints without sending a wallet identifier, selected currency or account data upstream. Requests are bounded, time out and share a five-minute cache. The two upstream feeds fail independently. Invalid, future and expired data cannot render as a fabricated zero or neutral score. Existing payment-rate freshness rules remain in place.
- The main sats balance uses the approved stacked wordmark in monochrome. The denomination selector uses plain SATS, BTC and the selected fiat code. The mark participates in layout rather than hanging outside it at enlarged text sizes.
- Settings has distinct Currencies, Language and Appearance destinations with visible current choices. Dedicated preference pages support keyboard controls and immediate persistence. English section headings use Title Case; existing localized recovery terminology is retained.
- Account Identity uses the active SDK session's confirmed GYS address, with copy and Manage Account controls. It does not add a status-signing request or trust an unrelated local address cache.
- Help & Information is a disclosure containing support, guide replay, privacy, ChainReaction Instagram and GetYourSats X. Payment vibration is within Payment Settings. The website's homepage and help-page footers link to both social destinations.
- On phones, the scanner requests portrait orientation where the browser supports it. For browsers that expose orientation but cannot lock it, the scanner keeps a portrait-shaped surface using a counter-rotation. The decoder continues to read the original video frame. Desktop and tablet layouts are not forced into portrait. Closing the scanner releases successful orientation locks, including locks that resolve after dismissal.

## Evidence

- Type checking and production build pass.
- 1,416 application tests and 161 server tests pass locally. Lint has zero errors and eight pre-existing warnings.
- Targeted browser coverage exercises actual production components using disposable fixtures: INR market-cap formatting, unchanged supply across denomination selection, stale feeds, account identity, social destinations, preference persistence, keyboard selection, 320px enlarged-text layouts in English/Hindi/Arabic/Tamil and both landscape rotation directions.
- Existing customer, theme, QR handoff and keyboard regression checks remain in the release matrix. The new cases run on Chromium, Firefox and WebKit before the broader journey suite in CI.
- Visual review corrected the narrow market-cap layout, the enlarged balance mark and a missing copy glyph. A reflow assertion was corrected to measure content rather than the price card's deliberately clipped decorative pseudo-element and horizontally scrollable price-unit rail.

CI on the final commit and verification of the production deployment are required before calling the release shipped. Test data appears only in test fixtures. No real wallet or payment was created for acceptance.

## Acceptance limits

This is a web UI and public-data release. It does not ship native binaries, change wallet storage/signing/migration or approve the separate security candidate. Safari does not reliably provide the orientation-lock API. Simulated viewport tests establish layout and cleanup behavior, not the physical camera's response to rotation. Physical iPhone Safari/PWA and Android camera acceptance remains necessary. Translation and accessibility checks are automated; native-speaker and physical-device screen-reader review are not represented as complete.

## Additional proposals for discussion

1. Balance privacy: a visible eye control that consistently masks the main balance, fiat equivalent and transaction amounts during public use, without changing payment values.
2. Settings protection summary: show the actual backup-verification state and current spend-authentication method together, linking to the relevant action. Do not infer that having a passkey alone establishes recovery acceptance.
3. Historical receipts: persist the displayed fiat estimate and its timestamp when confirming a payment, so a receipt can distinguish that historical estimate from today's conversion. This needs a storage/data-model decision and must not reclassify old estimates as settlement amounts.

## Source references

- https://www.blockchain.com/explorer/api/charts_api
- https://api.blockchain.info/stats
- https://alternative.me/crypto/fear-and-greed-index/#api
- https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock

## Final local acceptance and publication state

Implementation commit: `e8ca6aa49afd62a9953fee3657a726be8ef5101c`.

The final local Chromium run passed all 44 scenarios across the new product-experience cases, customer settings, theme switching, QR handoff and iOS keyboard-geometry suites without retries. The 1,416 application tests, 161 server tests, typecheck and build also passed. The package lock and SDK were not changed. The reviewed commit contains no attached project-source documents, environment files, deployment credentials or private-key files.

The user explicitly approved publishing this candidate to `Bradvani/getyoursats-wallet` and deploying the wallet and website after the remaining release checks pass. Hosted CI on the published candidate, staged deployment verification and production verification are still release gates. Physical-device scanner acceptance remains open independently of those automated checks.
