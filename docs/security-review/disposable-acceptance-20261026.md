# Disposable-wallet acceptance continuation — 26 October 2026

**Direct Spark settlement and a cooperative Bitcoin exit passed on public regtest. Full product acceptance remains incomplete and production remains NO-GO.**

The source continuation starts at `4664c6d1358ecc2389f0b9df3df18b84ab27a192` on PR #43. This work does not merge PR #43 or #46, deploy production, or authorize use of user funds. The public-regtest run used two newly generated disposable wallet identities, the actual compiled browser SDK, encrypted browser vaults and the operation gateway. It supplied no Breez API key or user credentials. That initial run reached no funded send, claim, refund or exit. Later human-funded attempts are recorded below.

## Implemented and compiled

- Direct incoming BTC claims now bind one exact transfer ID, receiving identity, network, amount, zero fee and an approval expiry. They do not enable bulk claims, deposits, Lightning receives, tokens or counter-swaps.
- The SDK re-queries operators, validates the transfer, and stores a single-attempt marker before claiming. The browser journals before invoking the SDK. Timeout, mismatched receipt and a locked session remain uncertain. Restart reconciliation queries the same transfer without claiming it again. Unresolved incoming records block new payments and origin-wide wallet removal.
- The wallet has a foreground review/claim action and a status check. After an uncertain attempt its repeat-claim action disappears; UI regression tests cover this and the absence of automatic claims. The containment rollback reader inventories incoming and deposit-claim records without changing them.
- A clean SDK source reconstruction found that cumulative patch 0003 referenced `sdk/observation.rs` but omitted its file. Complete cumulative patch 0004 includes the exact observation source preserved in patch 0002 and the incoming extension. The build and packager now reject source files omitted from the supplied patch. Patch 0003 and its historical binary remain preserved; their hash check alone did not establish complete source provenance.
- Exit funding addresses now use the test-network derivation on signet, reject unknown networks, and reject invalid/hardened address indexes. The existing valid mainnet/testnet/regtest derivations remain covered by vectors. This correction does not enable new or rebuilt browser exits.

The isolated Vercel build used pinned upstream `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`, Rust 1.95.0 and wasm-bindgen 0.2.120. It compiled the WASM and passed 7 incoming-intent Rust tests, 8 observation tests and 8 signed-refund envelope tests. Installed compiled-WASM identity, revocation, API/hash and browser PBKDF2 checks passed.

Tested SDK package SHA-256: `62e4e42c96ea42a25eafd91f0a4e7449c6a2846cac72ff750050cdd4f3c3fe84`.

Tested browser WASM SHA-256: `3dc338e2d7e7e42f85939adb81402520ba456d0f28eb1e5bd841cf78a60bc58b`.

Cumulative source patch SHA-256: `77407dafbc05893a5be89a012ab2ccfabf269eec14b63cbcb891f9bf18f96b6c`.

GitHub clean-build run `40251209478` passed and preserved the compiled SDK in `55651bc25f4d1265c01702a2184b8722b1fc1d6e`. Its package SHA-256 is `0b37230dace9be42c83b75d3e8c19e54ab56e97742201f74af9a5e22255f298f` and browser WASM SHA-256 is `ec96d375e5afec1eff42cb635050015cabee6197d2e935384088163eacfa2b29`. The source patch hash matches the sandbox network-test build. The package and browser binaries differ from the sandbox build; byte-for-byte build reproducibility is not established. Both builds passed their installed-artifact checks; the network receipt above applies to the exact hashes it records.

## Actual network result

Receipt: `evidence/disposable-spark-acceptance-20261026.json`, SHA-256 `602bf5d5faea4b0569500fcbca029b333fe92386c208510b21897356d4777c0e`.

1. Two different disposable identities connected to real public Spark regtest operators through the browser gateway. Both started at zero balance and generated regtest Spark addresses.
2. An initial 500-sat faucet request was rejected because the displayed minimum is 1,000 sats. The subsequent attempt used fresh profiles and requested 1,000 **valueless regtest** sats.
3. The faucet explicitly reported bot detection. Funding/settlement was not observed in the acceptance window. No CAPTCHA or bot-protection bypass was attempted. HTTP 200 responses from the faucet's GraphQL endpoint were not treated as funding evidence.
4. The runner exited with a blocked result. It did not pass debit/credit conservation, zero-fee settlement, restart balance/history, return transfer or exit acceptance.
5. Both profiles were closed. **Do not fund the addresses in the receipt.** They are evidence of discarded disposable test identities.

The receipt pins the exact fixture/runner hashes used for that attempt. At that checkpoint the human-assisted funding mode and additional progress/deadline reporting had only been syntax/type checked. Subsequent human-funded attempts are recorded below. Fixture approval uses the application approval API; it is not physical-device biometric/passkey UI acceptance.

## Verification

- Full two-worker application suite: **1,136 passed, 1 skipped, zero failures** (with the GitHub-built SDK installed). The skipped case is the opt-in Bitcoin regtest integration; the independent Bitcoin-regtest CI run at the source head passed.
- The first unrestricted-parallel local run had one existing modal-animation visibility failure. Its complete file and the full two-worker suite passed on rerun. No assertion was relaxed or removed.
- TypeScript, scoped lint, preview build and 9 Chromium containment/rollback cases passed. The production interlock still rejects a production build.
- These automated results do not replace funded protocol acceptance, physical devices or independent review.

## Human-assisted valueless funding

Use a local checkout with the newly compiled incoming SDK installed. In one terminal start `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`. In another:

```sh
GYS_MANUAL_REGTEST_FUNDING=1 GYS_ACCEPTANCE_HEADED=1 npm run test:acceptance:spark
```

The runner creates fresh profiles and prints one new `sparkrt1…` address. A human can use the public Lightspark regtest faucet to send 1,000 regtest sats to that address during the five-minute funding window. Use only the address from that live run; never a historical receipt or a Bitcoin mainnet address. The runner then checks actual 100-sat forward and 50-sat return transfers, exact balances/fees, and same-profile restart. It writes `disposable-spark-acceptance.json` under `/tmp/gys-disposable-acceptance` and closes the profiles. It never exports the seed or treats a timeout as a pass.

## Remaining release blockers

New/rebuilt exits still require a durable SDK build-intent/result contract, authorization of all funding inputs/fees/destination, original passkey seed-compatible funding signatures, interruption recovery and actual exit acceptance. Mature/early deposit claims and Lightning receiving need separate bounded execution and reconciliation. The direct Spark claim path now has funded operator acceptance as recorded below. Physical iPhone/Android recovery, cross-device restoration, original-origin service-worker/rollback rehearsal, complete security-copy localization and independent review remain open. There is no justified production launch date yet.

## Human funding follow-up (26 October 2026)

The human-assisted faucet step succeeded twice, according to the operator's displayed confirmations reported by the tester:

- First request reference: `01a1774a-0352-99c5-0000-f41ddbee61ff`. Receipt `evidence/human-faucet-first-20261026.json` (SHA-256 `baff65b033701517a0c9540ae95bf95c44ae294c78fd3a3cea35a17b38025d00`) records a claim-approval timeout. The old runner hid a rejected claim behind its approval wait and discarded both temporary profiles. Settlement was not verified.
- Second request reference: `01a1774d-8c7b-99c5-0000-1690f7df3f21`. Receipt `evidence/human-faucet-second-20261026.json` (SHA-256 `9dece62faa56f2fb3368dd16f22ceadc65d597dc0e3f26120c8d16b36a1ad339`) records a pending 10,000-regtest-sat receive transfer `01a1774d-8c7b-7b67-bc9c-cf4e56703876`, zero spendable balance and no incoming or outgoing journal entries. The SDK rejected observation before approval with `Transfer is not the authorized direct BTC receipt`. The faucet request reference and observed transfer ID differ; neither their equivalence nor the reason for the amount difference has been established.

The runner now preserves disposable browser profiles locally, reports an operation's rejection immediately instead of hiding it behind an approval timeout and records read-only observations on failure. `GYS_ACCEPTANCE_RESUME=1` reuses those profiles without another faucet request. It refuses to repeat an acceptance sequence after a send has been submitted. Do not publish the profiles, fund historical addresses or use this fixture for real funds. Approval is still through the test fixture, not human biometric UI acceptance.

A diagnostic rebuild of the same checks isolated the second rejection to `Incoming transfer involves the SSP identity`. The corrective source accepts an ordinary `Transfer` sent by an SSP identity, while still rejecting attached SSP requests, preimage requests, every other transfer type and mismatched ID, recipient, direction or amount. Claim approval, one-attempt persistence and fresh completion evidence remain required. Sixteen native Rust claim tests and seventeen application claim-controller tests passed. The following live run subsequently verified the corrected source in the compiled browser SDK.

## Funded direct Spark result: PASS

Receipt: `evidence/human-funded-spark-pass-20261026.json`, SHA-256 `b4a09952ce061f8227c4f2fb28cf09857e070ce9e1bc7e6b6500be6d382d855f`.

The retained wallets completed the actual public-regtest sequence at 08:39 UTC (14:09 IST). No further faucet submission was made. The receipt records checkout base `6c87074`; its exact runner/fixture hashes and SDK source-patch hash were independently compared with corrective source commit `165fb6a8e476e6086f45a3936af2d65f9818e7e4` and match. The SDK package was compiled in the sandbox from that corrected source, not downloaded from the later GitHub rebuild.

| Check | Evidence |
| --- | --- |
| Explicit funding claim | 10,000 regtest sats became spendable; incoming journal settled |
| A sends B 100 sats | Transfer `4e20a87e-80e8-42b9-b81c-d7fafeb692ae`; zero fee; A 9,900, B 100 |
| B restarts | Same encrypted profile and identity; 100-sat balance restored |
| B returns 50 sats | Transfer `6fdb3198-7721-4abb-9bf6-f7d977cdc9d8`; zero fee; A 9,950, B 50 |
| Finality and conservation | Matching completed receiving receipts and completed sending journals for both transfers; combined balance remains 10,000 |

Tested source-patch SHA-256: `60bceecd63c7c20172ea78e59bcfb9d94ab251bcf4930938479534eefb85d045`.
Tested package SHA-256: `59db0896e6d7913c5c7002d158a3dbb5321cdcbf1720d44f00949270fe82839e`.
Tested browser WASM SHA-256: `02c67174cda118f747fe2da5fc1ac3729e20557a2bc3cb0b5c6084d7ce2152b8`.

The result is deliberately `PASS_DIRECT_SPARK_ACCEPTANCE_ONLY`, with `fullProductAcceptance: false`. Approval was supplied by the regtest fixture. This run does not establish exit/refund/deposit/Lightning acceptance, biometric approval, a fresh-device seed restore, physical iPhone/Android behavior, rollback acceptance or independent security approval. The retained profiles contain only disposable valueless-regtest wallets and are not published. Do not fund their historical addresses.

## Cooperative Bitcoin exit and mature-deposit continuation

Source commit `ac6aea94eee86db378f52f6430c631e81ae01aa9` adds a separate bounded mature-deposit SDK method, foreground authorization, durable browser and SDK attempt records, and read-only receipt reconciliation. It checks the exact outpoint, identity, network, amount, confirmation depth, fee ceiling and expiry. It never invokes the general deposit-claim API, early credit or a saved fee mandate. The browser exposes this controller only in development on regtest. Production deposit claims remain disabled.

The application suite passed **1,155 tests with 1 skipped**, TypeScript and the preview build. Lint had zero errors and nine existing warnings. Eleven mature-deposit Rust checks and the compiled signer/API/hash checks passed in the sandbox. These checks are distinct from the pending GitHub rebuild of the package.

The retained sender withdrew **5,000 regtest sats** to the second wallet's Bitcoin address, paying **2,430 sats**. Payment `5cb42e09-27bc-4c1d-829c-9075dfa65e1f` links to confirmed transaction `c49b23b1e762fcf7add88f0e8741c7d6c54f3ae5ff83a5a719d45c65ba2a2b6c`, output 0, block 3657960. The sender balance became 2,520 sats. Its history and durable outgoing journal both subsequently became completed. The first immediate journal check was still pending; a fresh observation after restarting reconciled it without another send. The runner now polls reconciliation and supports continuing from the saved withdrawal receipt without submitting another withdrawal.

- Initial receipt: `evidence/cooperative-exit-first-20261026.json`, SHA-256 `093ea5d6b8b751c2b43d0bee62672eb82db69c30f468b37a85380e7d659b97dd`.
- Resumed receipt: `evidence/cooperative-exit-deposit-blocked-20261026.json`, SHA-256 `b56fa75ff5aa206bd760908887dde19140e630c27581b3ec479c5573e8616f73`. Its cooperative-exit step is PASS; its overall result is BLOCKED because the mature-deposit claim did not settle.

The deposit quoted a 99-sat fee and 4,901-sat credit at seven confirmations. After one explicit approval, the browser retained an uncertain record; no completed operator receipt or spendable credit was observed. Read-only inspection found no SDK attempt marker and no matching deposit receipt. The browser record was preserved, and the claim was not resubmitted. This is not a successful interruption-recovery test or proof that clearing an uncertain record would be safe.

Read-only backend diagnostics found HTTP 404 at `/tx/<txid>/outspend/0`, while `/tx/<txid>/outspends` returned a valid array identifying output 0 as unspent. The SDK requires the former check before persisting its attempt marker. The compatibility correction falls back to the transaction-wide response only after a 404, selects the exact output index, and rejects missing, malformed, spent or unavailable evidence. Five new Rust cases plus one related existing case passed. This source correction requires a new compiled package and fresh funded acceptance. Diagnostic evidence is in `evidence/deposit-readonly-diagnostic-20261026.log`.

The receipts pin the sandbox's actual SDK artifacts, not a later GitHub rebuild. The first mature package is `1cd66fea863c4e8989b713f6acf84ad75bac572c29640f0ec1fc260f374e6d64`; its source patch is `a5e0a2261470a91eeeab2fcc4f3e92d069006bcf207b47b8daae5646d55282ad`. Fixture approval is not physical-device biometric acceptance. The original uncertain deposit remains quarantined; fresh/rebuilt unilateral exits, bounded Lightning receiving, physical-device recovery, rollback acceptance and independent security approval remain open.
