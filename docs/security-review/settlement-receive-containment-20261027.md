# Settlement proof and receive containment

Verification date: 26 October 2026 UTC. Candidate branch: `review/security-adoption-20261027`.

**Latest integration:** [Final main integration and incoming discovery](final-main-integration-20261027.md) supersedes the current-source statement below with tested implementation `d0d85e30e4ef48cafa33c5060d1a5ee5450e315c` and 1,482 passing unit cases. It adds paginated incoming discovery and preserves concurrent main startup/theme changes. This document retains the exact earlier `48e1659` snapshot, including its blocked hosted-regtest attempt.

**Production decision: NO-GO.** This continuation closes additional implementation defects and merges the corrective release. It does not complete Lightning receiving, mainnet deposit claims, fresh unilateral exits, physical-device acceptance or independent security review. The production build interlock remains enabled. No deployment, real funds, funded transaction, new claim or broadcast was performed for this continuation. A fresh public-regtest faucet request was rejected before funds arrived.

## Exact implementation and integration

| Input or result | Local source identity |
| --- | --- |
| Earlier combined security candidate | `c5e2b2eb6c4756c97bec04b920b20a40e883874f` |
| Settlement, schema and receive fixes | `d86fb97a4f700d0a44379a2d14c56a636030a80e`, tree `d0bcf89fa3d4a62ca244ebc8b69e3d5153c6f9d9` |
| Published corrective PR #56 head | `64408512c4c7fd74d81e3f28e129f9a5be87274b`, tree `41c0f800e76dc2c72b431640681e6ff944833192` |
| Tested combined implementation | `48e1659da9f57cf008e6b22f525cf106fd9aae29`, tree `a7db33b0916a25b6a45af45a36ba2d81ac3484fe` |

The corrective merge retains its website/help, support endpoint, paginated payment history, startup, service-worker and source-manifest improvements. The merge preserves the candidate's SDK package, lockfile, signer boundary, encrypted vault and production interlock. The only test adaptation waits for the corrective POS identity lookup before asserting receive availability. These local source hashes identify the tested checkout; a later publication must record its own commit and verify tree equivalence.

The new machine-readable receipt is [settlement-receive-containment-20261027.json](../../evidence/security-review/settlement-receive-containment-20261027.json). Earlier test and protocol evidence remains separate in [adoption-integration-20261027.md](adoption-integration-20261027.md) and [disposable-acceptance-20261026.md](disposable-acceptance-20261026.md).

## Implementation changes

### Terminal payment results require fresh evidence

An immediate SDK send result previously could mark a journal record completed without the recipient-bound observation required after restart. The gateway now records that result as pending or unknown and then requests fresh observation of the exact stored payment identifier and recipient commitment. Only a matching completed payment or verified returned ownership can release the retry guard. Wallet identity, network, amount, fee ceiling and observation freshness must match. Session and connection checks surround the SDK result, observation and asynchronous identity verification.

If observation is missing, stale, mismatched, interrupted or unsuccessful, the UI receives an uncertain outcome and the persisted operation continues to block another payment. A plain pending SDK result remains pending. The returned result uses the verified observation, so the UI cannot show a raw success while the journal remains unresolved. The current journal revision is retained for subsequent compare-and-update checks.

### Invalid records remain preserved and blocking

Outgoing amounts and fees must be canonical decimal strings within Bitcoin's supply bound. Operation identifiers and commitment hashes require actual strings and the expected shape; regex coercion no longer admits numeric amounts or singleton arrays. Incoming-transfer and deposit records apply the same explicit identifier type checks. Signed-recovery reads and cross-tab notifications now inspect the complete journal namespace, including unknown versions, before selecting a wallet. Invalid records are not deleted, normalized or silently skipped.

The first settlement/recovery reproduction snapshot had 21 failing cases. Additional malformed-record regressions were added before final verification. A separate internal reviewer reproduced six malformed variants against the corrected reader, confirmed byte preservation and acceptance of a canonical record, and reviewed the settlement/session correction. That scoped internal review is not an independent security audit.

### Payable receive requests follow claim availability

| Browser candidate route | Current behavior |
| --- | --- |
| Direct Spark address and Bitcoin-denominated Spark invoice | Available through the guarded facade for disposable acceptance work. Token invoices remain blocked. |
| Lightning invoice or Lightning address sharing | Unavailable. The gateway rejects invoice creation on every browser network. Receive, home, POS and native-name screens withhold payable QR/copy paths. |
| Bitcoin deposit address | Unavailable unless the existing development-regtest mature-deposit controller is exposed. That path is labelled for valueless test funds only and does not start a claim automatically. |
| Stablecoin or cross-chain receiving | Remains unavailable. No new deposit address is offered. |
| Existing names, orders and receipts | Preserved. Name recovery reads continue. Completed receipt evidence remains readable. Pending merchant invoices and unresolved incoming Lightning invoice strings are withheld from sharing. |
| Retained exit funding records | Preserved. Pending rows no longer ask for more funding, and archived fee addresses carry an explicit instruction not to send additional bitcoin. |

The initial receive regression snapshot had 10 failing cases before containment. The UI tests include saved Lightning names, address prewarming, direct Spark, development-regtest availability, merchant charging and historical records. Chromium tests at 390, 768 and 1366 pixels assert that the unsupported routes make zero raw receive requests, then confirm that only the direct Spark request is made.

UI containment cannot revoke names or invoices already shared outside this client. It does not prevent another wallet or an older application version from paying a previously published address. Operational containment of those existing routes remains a release concern.

## Final merged verification

| Check on `48e1659` | Result and boundary |
| --- | --- |
| Full unit suite | 1,474 passed, one opt-in Bitcoin Core regtest case skipped, zero unhandled errors; 146 test files passed and one skipped. |
| Build and TypeScript | `npm run build` passed, including TypeScript. The manifest records a clean source checkout, source `48e1659` and release ID `0d843582b8d3519561ee`. |
| Lint | Zero errors and eight existing warnings. |
| Chromium vault and receive checks | Seven passed using disposable state and mocked SDK responses. |
| Built application checks | Three passed: removed debug route, readable font fallback and source/service-worker manifest. The production-labelled test filenames refer to the local built artifact, not a deployed product. |
| Built rollback compatibility | Nine passed with byte-preserved disposable vault, payment, recovery and exit records, denied network access and service-worker takeover checks. |
| Email and address services | Four test files passed. Provider calls are test doubles. |
| Service-worker and manifest policy | Fifteen cases passed. The initial combined run also attempted a missing system Redis executable; that infrastructure failure was not counted as passed. |
| Support budget integration | Eleven cases passed after selecting the existing disposable Redis binaries. The test uses a private Unix socket and mocked provider delivery. No messages were sent. |
| Production interlock | The production-mode build returned the expected exit 1 before bundling: security release not approved. |
| Fresh dependency audit | Zero reported vulnerabilities for the exact candidate lockfile. Installed versions, SDK bytes and runtime module reachability were checked independently by another internal agent. No dependency changes were needed. |
| Fresh final-SDK public-regtest attempt | Two new disposable wallets connected with the actual installed SDK and had zero balances. The faucet rejected its 1,000-sat request with a bot/CAPTCHA response. No funding, claim or payment was observed. Direct Spark, cooperative withdrawal and mature-deposit acceptance remain unexecuted. |

Retained logs remove terminal control sequences and trailing whitespace only. The machine-readable receipt records both the retained-file hashes and original local log hashes.

The previous `d86fb97` snapshot separately passed 1,463 unit cases, 145 focused receive/integration cases, typecheck, build and seven Chromium checks. The settlement/schema focused snapshot passed 196 cases. These counts overlap and must not be added together.

The dependency receipt is [toolchain-audit.json](../../evidence/security-review/settlement-receive-containment-20261027/toolchain-audit.json). Its runtime graph was built in memory and is not a deployed artifact. The SDK tarball remains `cbb19e1e16760d63e8cba74a33e21ec75dac6684bc8d389da6c9921b8ba58505`; installed browser WASM remains `886b8d0be34acf32569ba9b79171f7fb7b86865b93e8b0b331f55e25ead176d8`. No protocol acceptance is inferred from a clean registry audit.

## Fresh public-regtest attempt

The exact final candidate and existing `accept-disposable-spark.mjs` harness were exercised against the actual hosted regtest operators, with no API key. The first connection failed because local Chromium did not trust the environment's supplied certificate authority. Chromium 147 was then launched with a temporary, isolated NSS trust database containing that already-configured public CA. TLS verification remained enabled. No system or user trust database was changed. Chromium's [XDG trust-database lookup](https://chromium.googlesource.com/chromium/src/crypto/+/cd0cd74231854ee6c56ae566ffd4d32bf994b8cc) and [Linux certificate-management instructions](https://chromium.googlesource.com/chromium/src/+/ece3098a2d62b418a4ff4b59b37ddbcad2c13d1e/docs/linux/cert_management.md) describe this configuration.

Both fresh wallets then connected through the guarded browser facade with balance zero. The public [Lightspark regtest faucet](https://app.lightspark.com/regtest-faucet) rejected the single 1,000-sat request with an explicit bot-behaviour response and a reCAPTCHA frame. The harness ended `BLOCKED`: both wallets still had zero balance, zero payments, zero incoming claim records and zero outgoing operation records. No incoming candidate was discovered. No challenge was bypassed and no automatic funding retry or alternate-client attempt followed the rejection.

The sanitized [public-regtest attempt receipt](../../evidence/security-review/settlement-receive-containment-20261027/public-regtest-attempt.json) records the source and SDK hashes, successful connection boundary, faucet failure and final counts. The disposable profiles and original receipts remain private locally; their seed material, browser databases, tokens, certificate material and profile paths are not included in published evidence. A separate local operator handoff identifies the public regtest funding address and the existing resume sequence. Manual funding must first recheck that no delayed funds or unresolved operation appeared. A single 10,000-sat valueless funding event would support the existing direct-Spark sequence and then its original 5,000-sat cooperative-withdrawal/mature-deposit scenario with the configured fee caps. Funding and those transactions remain unexecuted.

## Stranded regtest deposit

Three read-only public-chain GET requests observed the retained outpoint `c49b23b1e762fcf7add88f0e8741c7d6c54f3ae5ff83a5a719d45c65ba2a2b6c:0` still containing 5,000 valueless regtest sats and reported it unspent. The observation is retained in [stranded-regtest-deposit-readonly-20261027.json](../../evidence/security-review/stranded-regtest-deposit-readonly-20261027.json).

No wallet was connected, no claim or broadcast was invoked, and no journal was modified. An unspent chain output does not establish remote claim non-execution or settled operator credit. The original browser attempt remains uncertain, and its retained browser profile was not available in this session. Do not reset its record or retry it on the strength of this chain observation.

## Remaining engineering and release boundaries

1. **Bounded Lightning receiving is missing.** The installed `claimIncomingTransfer` validates a plain direct BTC transfer and rejects SSP user requests and HTLC preimage obligations. It is not a Lightning claim primitive. A Lightning path still needs an exact invoice/payment/identity/network/economic authorization, durable attempt handling, and fresh settlement or verified return/non-execution reconciliation in a rebuilt and reviewed SDK.
2. **Deposit uncertainty is not resolvable in every case.** `claimMatureDepositOnce` is bounded, but `observeDepositClaim` returns completed/payment evidence only. If an acknowledgement lost the transfer identifier, it examines one fresh transfer page; absence is not proof of non-execution. Authoritative attempt recovery, complete outpoint-to-transfer correlation and safe interruption acceptance remain necessary. Early deposit claims and production activation remain disabled.
3. **Fresh and rebuilt unilateral exits need a durable construction contract.** The current signed-recovery controller can continue exact saved bytes and freshly check their status. It cannot safely authorize arbitrary new `recoverFunds` construction, replacement funding inputs or fee changes. New builds need preserved intent/result state, complete input/destination/fee binding, original raw-seed signing semantics and interruption/rebuild acceptance.
4. **Withdrawal and other enabled route acceptance remains open on the exact final SDK.** Fresh journal proof now applies to Spark, Lightning sends and Bitcoin withdrawals. Mocked observations do not establish live provider/operator correctness, confirmed payout under failures, return ownership or independent chain consensus. The previous funded receipts identify different exact artifacts and are not reassigned to this build.
5. **Release validation remains open.** Original-origin old/new service-worker and funded-state rollout, physical iPhone and Android behavior, original passkey and phrase restoration on separate trusted devices, complete sensitive-copy localization/RTL/accessibility acceptance, and qualified external source/artifact review must be completed. Native builds are outside this browser candidate's security release scope.

These include remaining software work, not only approval paperwork. Preserve the interlock and all existing wallet/recovery state until the complete release criteria are met.
