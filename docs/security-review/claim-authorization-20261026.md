# Incoming-claim authorization foundation

Base: `983291f58eddec14adcfd690b857725f33a0feeb`. Production: NO-GO.

This change implements a claim-policy executor and durable journal, not an enabled receiving feature. The browser gateway continues to deny `claimDeposit`. No real funds or SDK claim calls were used in verification.

Implemented policy: exact mature-deposit quote; explicit fixed fee cap without proportional/rate authority; immutable outpoint, gross value and minimum credit; single-use preparation; 60-second approval expiry; persistence before invocation; receipt validation against receive/deposit/completed, source outpoint and credit-plus-fee conservation. Exceptions, deferred outcomes, submitted outcomes, lock/expiry and inconsistent receipts remain uncertain. A failed uncertainty write leaves the earlier submitting guard intact.

The journal preserves exact intent, rejects stale writers and replacement fee/outpoint budgets, rejects repeat submission and terminal-state reversal, strips extra fields and fails closed on malformed/unknown-version records. Pending claims now block existing operation/recovery and origin-removal guards through `assertNoUnresolvedRecovery`. There is no delete/reset/retry shortcut.

SDK inspection was against upstream `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`, the pinned source used by the installed extension:

- `sdk/deposits.rs::claim_deposit` uses the explicit request ceiling for the manual call, but stores that ceiling and rereads maturity. It can select an early claim after an application maturity check; unreadable depth falls back to mature. A caller-only maturity check cannot enforce a mature-only authorization.
- `sdk/sync.rs::claim_utxo` checks provider credit against the fixed ceiling before claiming.
- `models/adaptors.rs` represents a received static deposit as credited amount plus the deposit-minus-credit fee and binds its details to txid/vout.
- `sdk/recover_funds.rs::recover_funds` constructs a response after signing and returns it without a complete operation-specific durable request/result envelope. Existing leaf records are not proof of complete exit-result persistence.

Required before exposure: a compiled SDK primitive binding the approved claim route, wallet identity and deposit value; foreground approval bound to the actual session and origin/wallet locks; restart reconciliation using provider/operator evidence; journal visibility in recovery UI and containment inventory; migration/rollback and physical-device tests. The dependency-injected executor is not itself a signer boundary or a completed SDK integration. Ordinary Spark incoming-transfer claims and Lightning receives are separate operations not implemented by this module.

Validation: 113 focused tests passed across claim policy/journal, gateway and signed-recovery suites. Of these, 33 are new claim tests. These use disposable fixtures and simulated SDK outcomes, not live settlement. TypeScript and scoped lint must pass before publication. Fresh/rebuilt exit construction remains unimplemented and the production interlock is unchanged.
