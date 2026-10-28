# RampNow integration and launch evidence

28 October 2026. Scope: GetYourSats BTC on/off ramps. **Integration in progress; public Buy/Sell remains disabled.**

## Preview configuration follow-up

The new separate `gys-rampnow-sandbox` database credentials are saved on wallet Preview under `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Vercel does not permit renaming sensitive variables, so both were scoped to `feat/rampnow-integration-20261028` and selected explicitly with branch-scoped `RAMPNOW_STORAGE_SOURCE=upstash_sandbox`. No secret values were retrieved. The existing production identity database and its integration were not changed.

The updated build check verifies a random expiring Redis record, atomic duplicate handling, readback and exact cleanup. It also invokes the actual raw-body webhook handler in-process with synthetic signed bytes, verifies tamper rejection and duplicate stability, and removes only the matching probe record. These are sandbox infrastructure tests, not proof of provider delivery or disk durability across an outage. A separate read-only chain-config request reports Bitcoin's provider-declared mainnet/testnet classification without inferring testnet3, testnet4, signet or wallet compatibility.

Local follow-up validation: 82 focused unit tests, seven real Redis concurrency/retention scenarios, full wallet build, and lint (eight existing warnings) passed. The previous integration deployment authenticated to RampNow and read active BTC/INR buy and sell capabilities. Its webhook handler was present, but unauthenticated external requests hit Vercel Authentication before reaching the handler. Provider callbacks still require a reachable sandbox endpoint; a handler self-test does not resolve deployment protection.

The user initially saved all three `RAMPNOW_*` API configuration variables on **getyoursats-site**, then corrected the target to **getyoursats-wallet** during this follow-up. Metadata now confirms all three on wallet Preview; key and secret are sensitive variables. The user redeployed main as Preview (`dpl_D1BKFVVprmzLZ5WdLGgSLSdC5JAW`), which does not yet contain this integration. Deploy branch `feat/rampnow-integration-20261028` to run the new check. No secret values were retrieved or copied.

`scripts/rampnow-preview-check.mjs` now runs after the build. It makes read-only provider requests only for that exact Preview branch with explicit sandbox configuration. It checks API authentication first, then BTC/INR account capability and India eligibility. Build logs contain fixed status labels and booleans only. Missing configuration or failed probes do not break unrelated wallet builds and never enable checkout. A successful capability probe is not proof of Bitcoin settlement.

The sandbox webhook receiver at `/api/rampnow/webhook` requires **dedicated test storage**, configured as server secrets `RAMPNOW_REDIS_REST_URL` and `RAMPNOW_REDIS_REST_TOKEN`, or the explicit Upstash sandbox pair described above. It must not fall back to production account storage. Verify storage and provider access through deployment protection before registering the URL in RampNow. A successful local test does not establish provider-to-preview delivery.

Validation for this follow-up: 47 focused unit tests passed, plus seven real Redis concurrency/retention scenarios. The full wallet build passed. Application lint passed with eight existing UI warnings; the repository lint configuration excludes the new server/scripts/tests, which were checked by Node imports and syntax tests. Review corrected the receiver to avoid Vercel's lazy `req.body` parser entirely. CI now runs the Redis scenarios after installing its isolated Redis dependency.

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
- `api/rampnow/webhook.js` and `server/rampnowStore.mjs`: sandbox-only raw-body intake and dedicated Redis persistence. Atomic compare-and-set protects bound order state; unbound events are held in a bounded, expiring quarantine. No webhook creates a wallet binding or credits funds. Test storage uses seven-day event retention and thirty-day state retention; this is not a production accounting ledger.
- `scripts/rampnow-preflight.mjs`: private operator-run capability and optional quote checks. No customer registration, order creation, financial submission or wallet signing. It never reports production readiness.
- `tests/rampnow.test.mjs`: 32 passing Node tests, including both official signing vectors, tampering/replay, quote-route binding, no retry, missing configuration and late settlement handling. No new dependencies. Existing CI includes `tests/*.test.mjs`.

Checkout and wallet binding remain incomplete. The sandbox receiver still needs deployed storage verification, public provider reachability and a reconciliation worker for quarantined or delayed events. No browser or wallet flow imports this module yet.

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
- Deploy and verify the sandbox webhook handler with dedicated storage. Complete authenticated binding creation and quarantine reconciliation, then establish production retention and support operations before adapting it for production. Configure the account-level URL and `ramp_order.status_change` subscription only after provider reachability is verified. Do not rely on per-order `webhookUrl` (current webhook guide says it is not used despite the OpenAPI field description).
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
