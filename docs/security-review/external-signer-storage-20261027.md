# External signer storage identity correction

## Verdict and release boundary

The retained compiled candidate selected one shared storage namespace for different external signers. It also selected a different namespace from the same wallet's pre-existing seeded connection. This is a release blocker. The original negative proof is preserved in [the compiled receipt](evidence/sdk-storage-identity-20261027/compiled-namespace-collision.json) and [its offline reproduction harness](evidence/sdk-storage-identity-20261027/prove-original-compiled-namespace.mjs).

The successor source corrects the namespace derivation and the application refuses ordinary browser connection when the legacy shared SDK or tree database exists, or when its presence cannot be determined. No database is opened, renamed, copied, deleted or assigned to an identity by that application preflight. A stored record without trustworthy ownership remains a recovery matter.

At this receipt's creation, the application controls passed locally and the SDK source passed internal source review. The ten new Rust/WASM controls and the successor installed-package verifier still require the canonical successor build. Source review is not a compiled-artifact pass or an independent third-party audit. This change does not approve production or funded operations.

## Compiled follow-up, 27 October 2026

The source-review-only status above records the original receipt. The successor [build 40473745510](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40473745510) subsequently passed both build and preservation. Its exact `recovery.3` archive is preserved in `de5100c3728bc11d019744f09624648b4aff8803`, SHA256 `32715449ed2e670740befe31f0a466b2adc0ab83651f410295a7cb34af55440c`; browser WASM SHA256 is `d77b97e2041c62575702a3c1227c7efa1299b7c2ce2f6e05612b8c14992e206a`. All ten actual WASM identity cases passed. The installed verifier passed 18 path cases, 58 constructor checks, twelve invalid-identity controls and four durable-tree factory checks, with zero real storage opens, network attempts or other signer calls. All four production WASM binaries passed the test-export guard. The [build and offline artifact receipt](sdk-ci-0007-20261027.md) records the exact scope. Legacy ownership/migration, provider acceptance and independent release review remain open.

## Compiled failure evidence

The probe initialized the retained browser WASM, supplied public fixture keys, and intercepted its first `createDefaultStorage` call. That factory immediately rejected before opening storage or starting the core SDK. It invoked twelve builders: two public seed fixtures, two networks, and the seeded, full external-signer and signing-only external-signer constructors.

| Network | Public fixture | Seeded namespace suffix | Both external constructor suffixes |
| --- | --- | --- | --- |
| Mainnet | Published BIP39 vector | `d2ea863c` | `9ce7940a` |
| Mainnet | Public 64-byte raw fixture | `958a2438` | `9ce7940a` |
| Regtest | Published BIP39 vector | `da91de82` | `2687e55a` |
| Regtest | Public 64-byte raw fixture | `e14ea653` | `2687e55a` |

All names share the application root `spark-wallet-example/<network>/`. Network attempts, storage opens, tree factory calls, external signer identity reads, and signing calls were all zero. The absence of even a public identity read before external storage selection is part of the failure.

The executed WASM SHA256 was `fc9bc11b2ef30494aabd6f72c4817be1008b707814b93bb9d91f5cb2dc80d910`, from the retained `0.1.0-getyoursats.recovery.1` package. This is a historical compiled diagnostic, not the new successor package. The pinned upstream source and cumulative patch 0006 retain the same defective dataflow. The historical harness SHA256 is `34a830be7eeae09095ff7116584abdbd94aec1f5b3c89e0a0bd4dd15556c1806`.

## Source and mechanism

The source pin is [`57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`](https://github.com/breez/spark-sdk/tree/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4).

- The [WASM builder](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/wasm/src/sdk_builder.rs) stores empty seed material in both external-signer constructors. Its `build` method derives storage identity from that placeholder before constructing the SDK, durable tree store, or SQL tenant stores.
- [PrebuiltBackend](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/persist/backend/prebuilt.rs) returns its already-opened stores and ignores the later identity passed by the core builder. The core's real identity lookup therefore does not repair the earlier namespace selection.
- The [core builder](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk_builder.rs) and [Spark wallet constructor](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark-wallet/src/wallet.rs) read the signer identity at different construction stages. Comparing only the first two reads would leave an `A, A, B` identity-change gap.
- The [existing path function](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/persist/path.rs) uses eight hexadecimal characters from SHA256 of the compressed public key. Compatibility with this existing path is retained. A 32-bit pathname is not a collision-resistant proof of database ownership.

The application's browser `connectSdk` path uses the full external-signer constructor with `spark-wallet-example`. Its native seeded path does not have this particular placeholder bug. Temporary Lightning-name sessions use a fresh UUID directory for each invocation, which already separates those temporary sessions; that directory policy is unchanged.

## Narrow successor correction

The isolated SDK correction is commit `c52853fd898c76d99ce971c0089c540a5dd5b384`, tree `0fad9ee69476211ee47bafb413ba75639a22014f`. Its parent reconstructs the exact prior cumulative 0006 source. The cumulative 0007 patch SHA256 is `e56dde90e545646dbce6e6f3218bb67c54084f13110fcbbafdb1eccc211b3eb7`; applying it to the pinned upstream source reproduces that exact tree. The prior 0006 patch remains unchanged at SHA256 `526a66a84989313aa91a391e2681635d147bfa934d8d8310358e19725609e195`.

The correction changes only `wasm/src/sdk_builder.rs`, `wasm/src/signer.rs` and a new `wasm/src/sdk_builder/storage_identity_tests.rs`, relative to 0006:

1. Storage identity is explicitly seeded or external. The seeded branch keeps its original derivation and account selection. The external branch obtains and validates the actual Spark signer public key before opening any store.
2. The shared WASM external-signer adapter pins the first successfully validated public point. Every later identity read still invokes the underlying signer and must match. Rejection, revocation and malformed responses are propagated. Concurrent different responses cannot replace the winning identity.
3. A full public-key and network check binds the resolved backend to the core's later store handoff. The existing SDK, durable tree, token, session, PostgreSQL and MySQL resolver paths remain in place. Caller-supplied custom-storage semantics remain the caller's responsibility.

This public-key binding concerns storage selection and identity reads during construction. It does not verify arbitrary signer implementations or every signing operation. No new signing primitive, network execution path or release interlock change is included.

## Application preservation policy

`assertNoLegacyExternalSignerStorage` reads IndexedDB database metadata only. It checks the selected network and the application's single-component directory against the known default-account placeholder SDK name and its `-tree` companion. Any matching database, including one that might be empty, blocks the connection. It does not open the database to infer emptiness or ownership. Missing APIs, rejected metadata reads, malformed metadata and unsupported path/network shapes fail closed.

The guard runs at `connectSdk` entry before `rememberSignerIdentity`, signer construction, or SDK storage/build. The literal seed representation and selected network are snapshotted before the new asynchronous boundary. A session change during enumeration rejects the pending connection. Native seeded connections retain their existing path.

The enumeration is not an atomic fence against an older tab creating a legacy database later. Higher-level browser resume may already have stopped its old SDK as part of its existing lock lifecycle before entering `connectSdk`; this guard does not claim to reverse that stop. It preserves persisted records and does not authorize an automatic reset, import or migration.

If both a correctly scoped seeded database and a legacy shared database exist, the application blocks ordinary connection. It must not choose one and hide the other. SQL-backed consumers also need explicit legacy shared-tenant handling before upgrading; the application browser preflight is not a SQL data migration or ownership proof.

## Verification and pending acceptance

The local application command was:

```sh
npx vitest run src/services/browserSdkStorage.test.ts src/security/sdkConnect.security.test.ts src/services/sdkConnect.test.ts --maxWorkers=1
```

It passed 50 cases in three suites. TypeScript and changed TypeScript-file lint passed. The earlier integration baseline reproduced six failures before the guard; that first diagnostic capture also contained an assertion-handler warning, which is not presented as an acceptance run. The final application run had no unhandled errors.

The ten new SDK controls must run through the actual WASM bridge:

```sh
cargo test --locked -p breez-sdk-spark-wasm storage_identity_ --lib --release --target wasm32-unknown-unknown --features storage-cas-tests
```

They cover repeated underlying identity reads, `A, B`, `A, A, B`, later revocation, initial errors, malformed initial and later keys, concurrent differing responses, exact seeded default namespaces, and full-key/network backend binding. They are compiled only in a test build and do not add production exports.

The installed successor verifier is intended to check the actual compiled package, with canonical package provenance validated before any import. It compares seeded and both external constructor namespaces across fixture identities, networks and accounts; verifies identity-before-storage ordering; reaches both SDK and durable tree factory boundaries without opening storage; and rejects invalid or failed identity lookups before either factory. The retained pre-fix package fails its namespace expectation. Successor compilation, these new WASM cases and the installed successor checks remain pending at this document's creation.

No production profile, provider call, funded wallet, email or physical device was used for this work.
