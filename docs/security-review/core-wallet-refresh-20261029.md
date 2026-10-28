# Wallet data freshness and event identity fencing

Candidate: PR #71. **Security preview only. Production remains blocked.**

## Runtime changes
- Browser manual refresh requests `getOperationReconciliation(wallet).observe()`, which invokes the pinned SDK's observation-only provider read. The subsequent wallet-info and history reads are based on the updated cache. This is not a deposit claim, Lightning preimage release, send retry or active `syncWallet`.
- Each balance/history and deposit request holds the exact SDK instance, wallet connection epoch, browser unlock epoch and monotonically increasing read revision. Late results from an old wallet, a locked browser or an older in-flight request cannot replace a newer snapshot or display a stale error.
- SDK event listener callbacks are bound to the SDK instance, wallet epoch and browser unlock session. An asynchronous listener registration completing after its owner is disposed is immediately removed. Events from old wallets cannot paint the current UI.
- Generic SDK `paymentFailed` is no longer described to guarded browser users as proof their funds were not sent. The UI says to reconcile before repeating. The authoritative outgoing-operation journal continues to govern retry permission.

## Limits
Observation-only balance/history refresh **does not claim a pending incoming transfer**. The SDK's ordinary standard BOLT11 invoice can be issued in disposable regtest, but actual receipt settlement and recovery are not established. A failed read leaves the previous snapshot visible with a clear error and must not be represented as live confirmation. Complete local history verification, populated-wallet migration, fresh exit signing authorization and exact provider settlement still require separate acceptance.

## Test coverage
Tests inject an observer failure, out-of-order provider responses, background locking while a response is pending, stale deposit reads and failed-payment events before and after lock. The dedicated regtest invoice-probe and existing signed-payment/recovery suites remain independent. Build and browser CI for the exact final commit must be verified before giving this increment a pass.
