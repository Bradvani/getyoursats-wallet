# Fresh observation of historical completed regtest receives

## Prepared scope, no live result

This harness is prepared against application base
`2f01c410a5d4e5a419f3a945cecc4cc93871a435` and cumulative SDK `0006` patch
`526a66a84989313aa91a391e2681635d147bfa934d8d8310358e19725609e195`.
It has not connected a wallet or requested provider data. **Execution is
explicitly blocked, including when all environment flags are supplied.** The
subsequently confirmed external-signer default-storage namespace defect affects
`0006`, and these retained profiles use its placeholder namespace. A successor
package and an explicit reviewed storage-provenance plan are required before
any connection, profile copy or migration. Historical funded `0005` acceptance
is not a `0006` pass.

The only intended result is fresh positive compatibility of three already
completed incoming Spark receipts with the strict `observeIncomingTransfer`
implementation. It does not exercise a new claim, initial/continued deposit,
withdrawal, Lightning execution, unilateral exit, interrupted execution or
physical recovery. It supplies no real-funds release approval.

| Copied profile | Exact receiving transfer | Sats |
| --- | --- | ---: |
| wallet-0 | 01a17af2-82f5-7b40-ae7e-d961eac979b7 | 1000 |
| wallet-0 | 117da763-c299-49af-b9d6-e6181cf00693 | 50 |
| wallet-1 | cc62e536-6124-4abd-9f72-c4c33f75f8ad | 100 |

The public identities and plan are fixed in
`e2e/fixtures/settled-incoming-contract.ts`. The prior successful receipt SHA256
is `c6913279fc88bbc6415f08728155faf4bc5d8f331ad2538c6b94421da0000d26`.
The receipt next to the original profiles must also exactly match
`0b9084e2a47420b379525f70faae4141d9240e3c18bd81254e8aa5f5d15ea27f`.
No uncertain stranded deposit is included.

## Boundaries in the prepared code

The runner requires explicit expected canonical package, `0006` patch, and
generated browser WASM SHA256 values. It compares the complete installed SDK
file inventory and every file's bytes to that exact archive, including wrappers
and storage helpers, then runs the existing installed source/API verifier.
An old package, partial installation, additional installed file, symbolic link,
or dirty tracked application source fails before profile copying or connection.

Original profile contents are streamed into SHA256 inventories without decoding
or logging their values. The task directory is newly and exclusively created
under `/tmp`, with mode0700. Only Local Storage and the retained
`http://127.0.0.1:5183` IndexedDB store are copied into brand-new browser profiles.
Each copied store must match its source inventory. Startup preferences, tabs,
extensions, service workers, cookies and caches are not copied or launched.
The original profiles are never opened in Chromium. Their complete file-content
inventories must still match after the run. Full inventories are private local
task files; the public receipt contains counts and aggregate hashes only.

The browser fixture exposes one one-shot `observe(profile)` function, whose
first statement enforces the same execution block as the CLI. It never
calls application `connectSdk`, `getInfo`, `syncWallet`, `receivePayment`, an
application journal controller or an approval function. Its raw SDK and signer
handles remain private. It checks the restored public identity before SDK build
and on every identity read, and checks each fresh response's identity, network,
transfer ID, timestamp, receive status, exact amount and zero fees.

The private builder uses external signers and explicit server mode. Background
work, realtime sync, cross-chain work, stable balance, leaf/token optimization,
private-mode initialization and the LNURL domain are disabled. A separate
signer proxy permits only identity reads, `isRemote` and schema-bound
authentication challenge signing. Every Breez signer method and every other
Spark signer method is denied, including unknown future methods. A rejected
method, malformed challenge, wrong identity, exceeded budget or underlying
signer error permanently closes this attempt, even if the SDK catches the
exception. Payment-observer vetoes use the same retained failure state. It is
checked before reads and after disconnect/disposal, so cleanup cannot leave a
stale success result. Authentication
challenges must decode to the pinned exact schema, version and public identity
before reaching the underlying signer. This is an API restriction, not
cryptographic domain separation: authentication and ordinary identity signing
share underlying ECDSA machinery.

The runner also denies all network methods/endpoints outside exact coordinator
authentication, `query_transfers_by_id`, `query_htlc`, and SSP authentication or
`Transfers`. RPC bodies bind the expected network where that protobuf has a
network field, the profile identity where present, exact selected transfer IDs,
and the two-row HTLC limit. Unknown/duplicate fields, integer overflow, status
filters, other roles and nonzero offsets fail closed. The entire SSP query
document is bound to pinned SHA256
`8b580121176b9e2bdf7f3015da7ae9dd0eefd8a881ba89f35addbc79bb9c31fc`;
the operation name and exact variables are independently checked. The test
fixture document is stored as a JSON-encoded copy, whose decoded bytes equal
`crates/spark/schema/queries.graphql` at SDK
source `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`.

Requests have finite total/per-kind budgets. Every redirect and websocket is
rejected, and any policy violation prevents all subsequent forwarding. Fetch
uses zero automatic transport retries and no TLS bypass.
The runner owns a fresh Vite server on strict port5183 with no proxy or HMR.
It cannot silently attach to an existing server on that port. Any denied request
prevents a pass, even if later observations return successfully.

Authentication may create a disposable provider session, and SDK storage
initialization can update/migrate the copied database. The claim is **no
economic operation**, not absence of all local or authentication writes.
Missing or incompatible provider evidence stops this attempt without any
execution fallback. The SDK's bounded internal read/auth retries, if any,
remain visible within the overall request budget; the runner itself has no
observation retry loop.

## Startup source review

The pinned source trace is `SdkBuilder::build` / `build_instance` in
`crates/breez-sdk/core/src/sdk_builder.rs`, then `WalletBuilder::build` and
`SparkWallet::new`, followed by `BreezSdk::init_and_start` and
`ServerRuntime::start_sdk_services`. Under the fixed configuration above,
server startup signals locally synced and registers a local event handler.
It does not start client workers or perform a wallet sync. REGTEST without an
API key does not start the partner-JWT provider. The exact allowlisted raw
observer does not call signing, processing, claim or transfer execution.
The additional signer and transport controls remain required even with this
source trace. The separate source-level peer receipt records 15 unchanged pinned
boot files, their SHA256 and Git blob identities, and its scope/limitations in
`evidence/settled-incoming-observation-20261027/boot-source-review.json`
(SHA256 `4c8d41196b649be47642fed488c7f773cb01e084be9312643427cbf9e9029d70`).

The external-signer default-storage namespace finding is not repaired or
accepted by this harness. The CLI immediately throws
`BLOCKED_PENDING_SUCCESSOR_STORAGE_PROVENANCE`; the prepared implementation is
private and is not invoked. Future retargeting must review the correct identity
namespace and preserved placeholder database without automatic copying or
migration. A public-key check or successful receipt observation alone would
not establish correct namespace isolation or migration for the application.

## Offline verification and future invocation

The prepared guards passed 62 Node offline cases plus 1 direct-fixture case,
zero skips, covering accepted
controls and negative receipt, signer, protobuf/GraphQL, package and filesystem
cases. TypeScript passed. The TypeScript fixture modules, direct-entry test and
focused test configuration passed ESLint with `--no-ignore` and zero warnings;
normal repository lint deliberately ignores
these fixture/script directories. The new `.mjs` files passed Node syntax
checks. Evidence is in
`evidence/settled-incoming-observation-20261027/preparation.json` and its logs.
The first restricted run failed at local child-process setup; its log is kept
separate and is not counted as a test pass. The intermediate TypeScript errors
and initially ignored lint invocation are also retained separately. A final
source-level peer re-review cleared the two discovered guard gaps: non-sticky
denials and direct fixture access around the CLI block. The reviewer did not
run wallet/provider operations or independently repeat the final tests. This
is internal implementer peer review, not qualified release approval. Two
published logs remove exactly one final blank line for repository whitespace
checks; the receipt records original and published SHA256 values, and the raw
logs remain under `/tmp`. No test conclusion or source query bytes changed.

Offline gate:

```sh
node --experimental-strip-types --test tests/settled-incoming-observation.test.mjs
node node_modules/vitest/vitest.mjs run --config vitest.observation.config.ts --configLoader runner
```

The prepared implementation records the following prerequisites for a future
reviewed successor. **These variables do not unlock the present CLI**, and the
current `0006` hash must not be replaced without source/provenance review:

```text
GYS_OBSERVATION_AUTHORIZED=settled-regtest-receipts-only
GYS_OBSERVATION_EXPECTED_PACKAGE_SHA256=<verified canonical archive SHA256>
GYS_OBSERVATION_EXPECTED_PATCH_SHA256=526a66a84989313aa91a391e2681635d147bfa934d8d8310358e19725609e195
GYS_OBSERVATION_EXPECTED_WEB_WASM_SHA256=<verified canonical web WASM SHA256>
GYS_OBSERVATION_PROFILE_ROOT=<retained funded disposable directory>/profiles
GYS_OBSERVATION_PRIOR_RECEIPT=<exact successful reconciliation receipt>
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<trusted installed Chromium, if needed>
```

The current `node scripts/security/observe-settled-incoming.mjs` command fails
before filesystem preparation or wallet activity. The future prepared design
has no faucet, CAPTCHA, top-up, send or claim. Any later authorized result must
be narrowly named completed-receipt compatibility or blocked, with
original-preservation status separate. Independent review and all other release
gates remain open.
