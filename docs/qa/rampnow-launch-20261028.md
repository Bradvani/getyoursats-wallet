# RampNow integration and launch evidence

28 October 2026. Scope: GetYourSats BTC on/off ramps. **Not deployed; public Buy/Sell remains disabled.**

## Verified current state

- Production Vercel project: `getyoursats-wallet`, `prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa`, team `team_6DfDWmDERMM9i9N4u4aEkHEI`.
- Latest production deployment returned by Vercel: `dpl_4RKC9Hq7uX55VBvbiQAGKK1ihrm2`, READY, source `37abc88bd113d6c519911fd6773dc74ce603282a`.
- No RampNow environment variables appeared in the production project's environment metadata. Secret values were not decrypted.
- Current main contains an inactive Onramper handoff, not a RampNow integration. `featureAvailability.buyBitcoin` remains false.
- The user provided a partner-console screenshot and a commercial offer. These do not establish the enabled routes, production credential scope or partner go-live approval. Do not commit those private materials or any credentials.
- A secure browser sign-in attempt returned `submitted`, but fresh inspection still showed the sign-in page. No authenticated console state or API keys were obtained.
- Security PR #43 remains draft/unmerged at `cc9f970`, with conflicts. The user's separately reported Gate 1 pass is acknowledged. Its recorded direct Spark test does not establish on-chain deposit/exit acceptance needed for RampNow BTC orders.

## Prepared here

- `server/rampnow.mjs`: server-only HMAC request signing, fixed sandbox/production hosts, non-binding BTC quotes, asset/country config reads and order lookup. Response bounds, sanitized errors and no automatic retries or arbitrary signed requests.
- Raw-body webhook signature verification with the documented five-minute replay window. Normalization binds events to an existing order intent, retains actual delivered amounts as decimal strings, handles delayed/late/out-of-order status and excludes bank/identity fields from the normalized record.
- `scripts/rampnow-preflight.mjs`: private operator-run capability and optional quote checks. No customer registration, order creation, financial submission or wallet signing. It never reports production readiness.
- `tests/rampnow.test.mjs`: 32 passing Node tests, including both official signing vectors, tampering/replay, quote-route binding, no retry, missing configuration and late settlement handling. No new dependencies. Existing CI includes `tests/*.test.mjs`.

These are integration primitives, not a completed checkout or webhook service. In particular, the event reducer must be used behind authenticated raw-body intake and a durable atomic event/intent store. It is not a substitute for them. No browser or wallet flow imports this module yet.

## Account inspection next

1. Establish console access and identify sandbox versus production credentials. Keep `RAMPNOW_API_KEY` and `RAMPNOW_API_SECRET` in server-side secrets, never VITE variables or a browser bundle. Select `RAMPNOW_ENVIRONMENT` explicitly.
2. Inspect live BTC/bitcoin buy and sell settings, fiat/payment methods, country eligibility, min/max amounts, KYC requirements and partner fee settings. Do not assume the commercial offer equals active account capability or silently set partner revenue fees.
3. Confirm the exact BTC testing path with RampNow. Their published sandbox testnet list includes EVM/Solana testnets but does not list Bitcoin, Lightning or Spark. Do not use an EVM success as BTC acceptance or send a mainnet address to a testnet flow.
4. Once credentials are injected securely, run `node scripts/rampnow-preflight.mjs --fiat INR --country IN`. Optional `--quote-buy 1000 --quote-sell 0.0001` requests prices only. Unknown/missing country or direction configuration remains unavailable. Fees and limits come from responses, not the offer PDF.

## Implementation still required before activation

- A durable wallet-bound order intent, saved before Create Order; atomically reserve submission once. A timeout is uncertain and must trigger order lookup, not blind resubmission. RampNow says repeated `externalOrderUid` values are **not rejected** and lookup can return multiple orders. Quarantine ambiguous matches.
- Create checkout only after the user reviews direction, destination, amount, costs and provider disclosure. Use the exact BTC/bitcoin route. Preserve the source amount, all fee currencies and inclusive/exclusive treatment. Obtain a fresh quote before execution.
- Buy: get the destination from the unlocked wallet's verified BTC deposit flow, bind it to the order and enforce deposit minimums/claim fees. Provider `completed` does not mean spendable Spark credit. Confirm the wallet received and credited the actual BTC delivery.
- Sell: use the provider's verified deposit instructions and their expiry. Bind amount/address/network to GYS's own send confirmation and fee quote. Never sign from widget messages. Network fees must not reduce the required provider deposit. Complete the protected on-chain exit path before enabling Sell.
- Prefer an external provider checkout initially: current CSP, COOP/COEP and Permissions-Policy block arbitrary payment iframes. Preserve wallet isolation rather than weakening it for a widget. Return safely to GYS and poll authoritative status; redirects and UI events are not receipts.
- Implement an HTTPS raw-body webhook handler with a configured, constant path, HMAC verification, durable `eventUid` deduplication and atomic `payload.updateTime` ordering. Persist before returning 2xx; use bounded retention and minimize PII. Configure the account-level URL and `ramp_order.status_change` subscription. Do not rely on per-order `webhookUrl` (current webhook guide says it is not used despite the OpenAPI field description).
- Authorize status reads to the owning wallet, poll as a webhook fallback and reconcile `dstFillAmount`. `failed` means delayed, and late payments may revive `expired` or `payment_failed`. Sell `walletAddress` is the bank account and sell `transactionHash` is a payout reference, not the BTC deposit hash.
- Integrate localized Buy/Sell UI, settings/support disclosure and restart-safe activity records. Keep the public feature gate off until each direction is proven.

## Release acceptance

Pass provider sandbox completed/failed/expired scenarios, duplicate/out-of-order/replayed callbacks, interrupted submission, mobile return and wallet reload. Obtain RampNow production approval and exact BTC route confirmation. Integrate the final wallet security build, prove deposit/withdrawal and recovery on that artifact, then perform explicitly controlled small production buy/sell acceptance with exact fiat/crypto reconciliation. Merge after required CI/review; stage and verify the production artifact before enabling the public direction gates. Retain a rollback that preserves pending order records and wallet data.

## Official references inspected

- https://docs.rampnow.io/api-reference/authentication
- https://docs.rampnow.io/api-reference/partner_external.yaml
- https://docs.rampnow.io/api-reference/go-live-checklist
- https://docs.rampnow.io/api-reference/sandbox-testing
- https://docs.rampnow.io/api-reference/webhook
- https://docs.rampnow.io/api-reference/order-status
- https://docs.rampnow.io/api-reference/configuration/get-order-config
- https://docs.rampnow.io/quickstart/resources/payment-methods

Current prose guides resolve conflicts with stale examples: no assumed checkout idempotency and no per-order webhook target. Account-specific behavior still requires provider verification. No keys, bank details, user identity data or real funds were sent in this work.
