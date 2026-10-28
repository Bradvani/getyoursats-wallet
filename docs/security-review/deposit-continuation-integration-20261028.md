# Original-deposit continuation integration

**Engineering acceptance path only; production receiving remains restricted.** This revision uses the already compiled `continueMatureDepositClaim` capability. It does not change SDK bytes or claim that every interrupted deposit is recoverable.

## Runtime behavior

The development-regtest controller now exposes an explicit continuation for an existing journaled outpoint. It never calls initial claim submission, general synchronization or a new quote. It requires a fresh observation whose durable correlation matches the original SDK intent commitment. It then requests a new bounded foreground approval using the original amount, maximum fee and minimum credit. The deadline is renewed; economic terms and the original journal intent are not changed.

After approval, a second fresh observation must retain the same correlation, wallet, network and outpoint. The controller persists an immutable single-attempt continuation marker inside the existing deposit journal before invoking the SDK. An error, lost response, lock or inconclusive settlement leaves that marker and the original uncertain operation intact. A second continuation is blocked. Normal observation-only reconciliation can later close the operation without repeating execution.

A successful SDK response alone is not enough: the application requires a fresh matching completed observation and verifies exact transfer, outpoint and economic bounds before writing settlement. Journal updates preserve the continuation marker; malformed continuation records block reads. Wallet-removal and recovery-readiness checks already consume the same deposit journal, so the new record does not sit in an untracked side journal.

The exact selected outpoint is copied before asynchronous work. Other unresolved payments, incoming claims, deposits or exits block execution. Cancellation, changed correlation, expired approval, state drift, a failed persistence write or unavailable continuation capability do not invoke the SDK.

## Acceptance boundaries

The new tests use actual application authorization/journal code and synthetic SDK responses. They do not demonstrate a real provider deposit, modified operator semantics or a receiving attempt already interrupted inside the SDK. Existing SDK CAS protection and its receiving-attempt guard remain authoritative. A previously attempted receiving step remains observation-only; this integration does not clear or bypass that guard.

The original development-only REGTEST capability gate, production interlock and unsupported receiving restrictions remain unchanged. The disposable acceptance fixture gains an explicit `depositContinue` method but no funding or provider call is executed by this change. There is no newly enabled production UI route.

## SDK investigation retained

The pinned Breez source's `ProvidePreimageRequest` includes a `transfer_id` field with rollout semantics, while the inspected public Spark operator source at `buildonspark/spark@0b3a32a05c9ac06cc411683551dd1f1bde9d0caa` has a request definition without that field and selects the preimage request by payment hash and receiver. The installed SDK currently sends an empty transfer field. These are source observations, not evidence about the actual deployed operator version. Setting a field locally would therefore not establish enforced server-side binding. No preimage was disclosed and no operator operation was performed during inspection.

Incoming Lightning execution and durable fresh/rebuilt exit construction still require SDK implementation and matched provider acceptance. The legacy storage admission gap described in `owned-storage-handover-20261028.md` also remains open. This commit is not a Gate 1 pass or authorization for live-funds Gate 2.
