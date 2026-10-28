# Gate 1 operator and wallet-state compatibility contract (2026-10-28)

**Decision: BLOCKED. This document does not approve a production wallet, funds or Gate 2.**

## Verified inputs

- Wallet candidate: PR #71 at `29e49bee563e462824e5c7f61539dbe16436ff59`, pinned SDK source `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4` plus reviewed project patch `vendor/patches/0007-signer-storage-identity.patch`.
- The pinned project SDK proto adds `ProvidePreimageRequest.transfer_id = 4` specifically because (payment hash, receiver public key) alone do not distinguish a cancelled HTLC from a replacement reusing the hash. This is an unverified change to the public operator contract.
- Inspected public operator source `buildonspark/spark/main/protos/spark.proto`, 2026-10-28: `ProvidePreimageRequest` exposes **only** `payment_hash = 1`, `preimage = 2`, `identity_public_key = 3`. The public source's `ValidatePreimage` selects by hash, receiver and allowed preimage-request states. None of this proves the exact version deployed in the public regtest or mainnet operator fleet.
- Public Lightspark regtest read-only probe `40699276885` passed: two disposable distinct wallets connected, zero balances, no spend/claim. Valueless settlement attempt `40700202149` connected two wallets, attempted the publicly documented faucet UI but was rejected by its bot-detection challenge. No funding observed; zero claims and sends. No automated CAPTCHA bypass was attempted.

## Contract A: incoming Lightning preimage release

A signed invoice, matched provider record or a local content-addressed observation is **not sufficient** to release a preimage. The operator must atomically reject a release unless the authenticated wallet identity, payment hash, exact transfer ID, receiver, original invoice, amount/fee bounds, deadline and committable transfer status all match the retained authorization.

Mandatory negative tests against the **deployed** operator implementation:

1. Original transfer cancelled and replacement created with the same hash/receiver must not consume an old approval or settle the replacement.
2. Two concurrent release requests and lost acknowledgements cannot produce a different-transfer release or any unsafe retry.
3. Stale, expired, returned, mismatched network, altered invoice and incorrect fee/credit requests do not release the preimage.
4. Release success must return exact transfer ID and authoritative correlated state; a generic HTTP 200 or cached payment label is insufficient.
5. Operator fleet/protocol versions must be identified, including handling of unknown protobuf fields and any mixed-version rollout.

**No-go** until these semantics are demonstrated on the actual deployed operator and the compiled exact SDK pair, with independent reviewer approval. Do not lift `browserReceivingRouteRestriction('bolt11Invoice',...)` or raw claim preimage restrictions merely because a local fixture passes.

## Contract B: fresh/rebuilt exit creation

The SDK `prepareRecoverFunds` and `recoverFunds` APIs can build or sign unilateral/cooperative exit transactions. Before any CPFP signer invocation, an immutable durable intent must bind:

- full wallet signer identity, network and named authorized leaves
- destination address and script, value/credited amount and total fee ceiling
- exact funding outpoints, amounts, public keys and permitted change outputs
- fee rate, parent/child relationship and any permitted CPFP inputs
- explicit rebuild generation, original transaction set, expiry and operation ID.

A crash, lost receipt or partially broadcast transaction must enter **observation-only reconciliation**. Reuse exact signed transaction bytes if still valid. Rebuilding new inputs, prices, destination or children requires a new approval with no old signing permission. Tests must verify actual signed PSBT and transaction economics before broadcast, not merely trust the SDK quote or verify after signing. Include chain reorganization, UTXO replacement, fee bump, duplicate request, partial package and concurrent old/new app flows.

Existing `SIGNED_RECOVERY` controls already-signed continuations. It does not authorize first construction by `recoverFunds`; the browser gateway remains restricted for this reason.

## Contract C: populated untagged historical wallet admission

A shared short-hash namespace does not identify the wallet responsible for its database rows. A *new* signature from the current seed does not authenticate preexisting mixed-wallet records. Populate no owner tag unless original provenance is established.

An eligible migration must preserve a complete, immutable old-release snapshot and verify each operation/leaf/history row against its real wallet identity or provable provider/chain evidence. Unknown rows and unresolved outpoints remain quarantined and cannot grant spend authority. Prove rollback and interruptions on populated old-release profiles from at least two distinct wallets previously sharing a namespace. Missing SDK session journals and pending transfer state on replacement devices must not be treated as permission to resubmit.

The app now fences provably empty untagged SDK and tree stores with a version-change transaction, without deleting them. **Populated untagged stores remain unsupported and block the upgrade** until these proofs exist.

## Access required to finish

- Actual deployed Spark operator preimage-release protocol version and technical confirmation of exact-transfer binding (or an operator-side patch tested and deployed).
- Approved valueless regtest funding for disposable wallets, not automated CAPTCHA circumvention. The public faucet currently challenges automated CI traffic.
- A test fixture representing the actual old populated production database with authorized, disposable keys and pending operations. Do not submit real user seeds, encrypted backups or private data to external services.
- Independent security review of the completed exact source, SDK and deployed app before Gate 1 release approval.

## Release decision

Gate 1 **NOT PASSED**; PR #71 remains draft. No production alias, main branch or user funds changed. Any route unable to satisfy its contract stays explicitly unavailable; passing local browser/unit tests cannot override a missing operator-side guarantee.
