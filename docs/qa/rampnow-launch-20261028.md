# RampNow integration and launch evidence

28 October 2026. Scope: GetYourSats BTC on/off ramps. **Sandbox integration in progress; public Buy/Sell and checkout submission remain disabled.** No provider order, customer registration or real payment has been submitted.

## Current implementation

- `server/rampnow.mjs`: fixed-host HMAC authentication, read-only account/asset/country/network configuration, BTC quotes and order lookup. Preserves decimal amounts and itemized fee currencies, including USDT/USDC. No automatic retries or arbitrary signed requests.
- `api/rampnow/webhook.js` and `server/rampnowStore.mjs`: bounded raw-body HMAC verification, replay window, atomic event deduplication, wallet/order/route binding and delayed/late status handling. Unbound events enter a bounded seven-day quarantine. Events never create ownership or credit a wallet.
- `server/rampnowAuth.mjs` and `api/rampnow/checkout.js`: wallet-signed, single-use challenges bind the origin, operation and exact payload. The endpoint pins the sandbox wallet project, integration branch and browser origin, enforces request bounds and challenge quotas, and returns sanitized errors. Owner-authenticated status/reconciliation remain available when creation is disabled.
- `server/rampnowIntentStore.mjs`: a saved intent binds the owner, normalized request, destination hash, reviewed quote and two-minute review expiry. An atomic Redis reservation permits at most one Create Order dispatch. Binding and provider-order collision checks are atomic. Customer profile fields and the raw destination are not stored in the intent.
- `server/rampnowCheckout.mjs` and `server/rampnowService.mjs`: sandbox INR-to-BTC buy orchestration, exact Bitcoin route, checksum/network address validation, seven required customer fields, fresh quote verification and reviewed payment mode. The documented nested `wallet.crytpoAccountDetail` is always supplied. Hosted URLs are restricted to RampNow's sandbox origin. Timeouts and post-dispatch failures require lookup, never a second create call.
- Reconciliation requires exactly one lookup match with the saved route, source amount and destination hash. Missing, multiple or mismatched results cannot bind. A matched provider status still reports `walletReceiptVerified: false`; provider completion is not spendable Spark credit. Reconciliation is owner-requested; no background worker is implemented.
- `src/services/rampnow.ts`: browser API client independently hashes a frozen payload and verifies the entire challenge before invoking wallet signing. It validates response shapes and checkout URLs and never retries creation. It is **not yet connected to wallet UI, a deposit adapter or a return/activity flow**.
- The checkout return URL now includes the reviewed intent's explicit `network=signet`. Before creating an SDK configuration, wallet startup rejects missing, duplicated, unsupported or conflicting network/intent return parameters and returns from an unapproved origin. The URL provides navigation context only; it cannot establish order ownership or payment completion. The return/activity UI is still unfinished.
- `scripts/rampnow-preview-check.mjs`: branch-scoped build checks for provider authentication, BTC/INR account capability, dedicated storage, signed handler behavior and real HTTP delivery to the receiver. The new callback inspection reads only aggregate counts of recent non-probe quarantine records; a candidate is not proof of a particular provider order or production readiness.

## Verified infrastructure

Wallet project: `getyoursats-wallet` (`prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa`), team `team_6DfDWmDERMM9i9N4u4aEkHEI`. Integration branch: `feat/rampnow-integration-20261028`; draft PR: https://github.com/Bradvani/getyoursats-wallet/pull/72.

The latest checked wallet preview before this checkout update was `dpl_7JL8UvXpGpkkds5ckruAUTthfsNy`, source `076912df3adb1389c8c32f8132c125ac6fa5d319`, READY. Its build verified sandbox API authentication, BTC/INR buy/sell capability candidates, the dedicated Upstash connection and atomic write/read/duplicate/cleanup checks. The external HTTP probe received 401 for a tampered signature, 200 for a valid synthetic event and 200 for the unchanged duplicate; readback and exact cleanup passed. These checks prove our signed delivery path, not provider-originated delivery.

The separate receiver project `gys-rampnow-sandbox-webhook` (`prj_A4rcsAjtYNd6RgdyJoo8zrTLFa1P`) exposes only:

https://gys-rampnow-sandbox-webhook.vercel.app/api/rampnow/webhook

Receiver deployment `dpl_2sWX3duQzZSZvQw3Jnx1SP8M5LmC` is READY. The stable hosting Production alias is public while immutable deployments/previews remain protected. RampNow itself is still sandbox. Source files and unrelated paths return a fixed generic 404. Its six-file source package excludes checkout code and wallet UI.

The user reports completing account-level webhook registration. Actual provider delivery still requires a provider test event or sandbox order linked to its console/lookup evidence. The new preview callback report will distinguish recent non-probe candidates from our synthetic probes.

Existing wallet production remained at source `37abc88bd113d6c519911fd6773dc74ce603282a`, deployment `dpl_4RKC9Hq7uX55VBvbiQAGKK1ihrm2`. No production feature gate, credential or identity database was changed. The reported Gate 1 pass does not by itself establish on-chain receipt/exit acceptance for RampNow.

## Configuration and remaining network blocker

Wallet Preview has sensitive `RAMPNOW_API_KEY` / `RAMPNOW_API_SECRET` and explicit `RAMPNOW_ENVIRONMENT=sandbox`. The separate `gys-rampnow-sandbox` database is selected by branch-scoped `RAMPNOW_STORAGE_SOURCE=upstash_sandbox`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Secret values were not decrypted or exported. The production identity integration remains installed.

The isolated receiver has its own sensitive secret/storage variables plus explicit sandbox environment, storage source and `RAMPNOW_DEPLOYMENT_ROLE=sandbox_webhook_receiver`. The production-hosted storage exception requires that exact receiver project ID and role; it does not permit wallet production checkout.

`RAMPNOW_CHECKOUT_ENABLED` and `RAMPNOW_BITCOIN_TEST_NETWORK` are deliberately unset. Do not enable checkout by setting these alone: the wallet adapter, user review, network match, safe return flow and acceptance scenarios below are still required.

Live configuration exposed exactly one Bitcoin UTXO entry and BTC support, but failed the documented node protocol/testnet/address-type checks. The last safe diagnostic was `nodeProtocol: other`, `testnetFlag: null`, `addressTypePresent: true`, `addressTypeValid: false`. This is not an API authentication failure. No mainnet/testnet/signet assumption was made and strict validation was not weakened. RampNow must confirm its exact Bitcoin sandbox network and provide compatible configuration or an authoritative alternative contract.

The published sandbox network list describes EVM/Solana testnets but does not establish Bitcoin compatibility. The installed wallet SDK supports mainnet, regtest and signet, not Bitcoin testnet. Even a valid `tb1` address cannot distinguish signet from testnet. A provider testnet-only route therefore cannot be wired to this SDK as if it were signet.

The return-network correction restricts new checkout preparation/submission and browser availability to signet. Setting `RAMPNOW_BITCOIN_TEST_NETWORK=testnet` no longer makes that route eligible. The existing durable intent schema is retained so older records remain available for authenticated status and reconciliation; no records are deleted or resubmitted. Regtest remains unsupported by this checkout's address contract even though the wallet SDK supports it.

## Validation

The previous checkout source `2d64eb12decbb7599536fb161a733561833e07e1` passed all 208 RampNow Node tests with no skips, including the service scenarios and real Redis intent tests. Its browser client passed all 59 tests. Tests cover concurrent one-time reservation, expiry at Redis commit, consumed uncertain submissions, cross-wallet isolation, challenge tampering/replay, fresh-quote changes, malformed destinations, lookup ambiguity and no wallet-credit inference. Real Redis tests exercise reservation, retention, capacity and provider-ID collisions. CI requires these Redis intent tests after installing Redis.

The full TypeScript/Vite wallet build passed. Repository lint passed with eight pre-existing UI warnings. Local builds skip external probes; the deployed branch build performs the actual sandbox infrastructure checks. Tests do not prove provider settlement or a completed customer flow.

For the return-network correction, 23 negative regression cases failed against that predecessor while six valid-network controls passed. All 29 pass with the correction. The combined network/configuration/browser-client suite passes 102 cases; the complete application suite passes 1,286 across 128 files. The full RampNow Node suite passes 197 cases with one Redis suite skipped because Redis is unavailable in this workspace. These counts overlap and must not be added together. Type checking, the full build and repository lint pass, with the same eight lint warnings. The full application run also emitted localhost-navigation diagnostics from happy-dom while exiting successfully. Local dependency files were copied from the matching lockfile checkout after an offline install found an uncached dependency; installed SDK runtime files match the unchanged vendored archive. Clean CI, deployed checks and actual provider/device acceptance remain separate.

## Work still required before activation

1. Obtain RampNow's exact BTC sandbox network, compatible chain metadata, KYC test procedure and any required console activation. Verify a provider-originated signed event against its console/order evidence.
2. Connect Buy to the unlocked wallet's generated BTC deposit address and confirmed matching network; never accept a provider mainnet address in sandbox. Verify the proof with the actual installed SDK signing wrapper, then show source amount, BTC estimate, all fees, legal provider disclosure and the required profile collection before a fresh signed submission. The SDK returns receive-address fee information, while claim quotes require an existing deposit outpoint; establish deposit minimum/claim-fee treatment before acceptance.
3. Implement the `/rampnow/return` and activity/reload UI without inferring payment from a redirect. Network selection is now explicitly checked before wallet configuration; the owning wallet and saved intent still need to be verified by the return flow. Persist pending IDs safely and reconcile them with the owning wallet. Provider `completed` must be independently matched to actual wallet receipt and spendable credit.
4. Finish background reconciliation and operations for quarantined/delayed events, support recovery and production retention. Current sandbox intent/state retention is thirty days and is not an accounting ledger.
5. Implement Sell separately using verified BTC funding instructions, expiry, exact amount and fee treatment. Current Create Order response supplies only order/user IDs and a hosted URL, not validated BTC funding instructions. INR beneficiaries require tax ID and IFSC in `bic`. Complete the protected wallet on-chain exit path before enabling Sell.
6. Pass sandbox completed/failed/expired, duplicate/out-of-order/replay, interrupted submission, mobile return and wallet reload scenarios. Integrate the final wallet security artifact and prove deposit/withdrawal/recovery on it. Obtain provider production approval, then conduct explicitly controlled small live buy/sell acceptance with exact fiat/crypto reconciliation. Merge/deploy/enable each direction only after those checks.

## Contract references inspected

- https://docs.rampnow.io/api-reference/authentication
- https://docs.rampnow.io/api-reference/partner_external.yaml
- https://docs.rampnow.io/quickstart/ramp-intent/create-order
- https://docs.rampnow.io/api-reference/sandbox-testing
- https://docs.rampnow.io/api-reference/webhook
- https://docs.rampnow.io/api-reference/order-status
- https://docs.rampnow.io/api-reference/configuration/get-order-config
- https://docs.rampnow.io/api-reference/go-live-checklist

Current Create Order prose resolves stale examples: repeated `externalOrderUid` values are not idempotent, omitting the wallet sends buy funds to the partner wallet, and webhooks use account-level registration rather than a per-order URL. Account-specific settlement behavior still requires verification. No private partner material or credentials are committed.
