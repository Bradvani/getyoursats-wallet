
# Browser recovery readiness from provider observation

**Gate 1 source correction. This is not a funded recovery or production sign-off.**

A restored/connected restricted browser wallet must first successfully perform
the SDK's read-only `observeWalletState()` through the guarded wallet operation
lock. It can then make the existing two full matching local-history scans,
deposit inventory, SDK identity check and durable-operation journal checks.

The SDK source for this pinned extension runs `observe_outputs`,
`update_balances` and `SparkSyncService.sync_payments(false)` without
triggering the effectful `syncWallet` / bulk claim. A provider failure blocks
publication of a *new* connected browser wallet rather than presenting an empty
or stale snapshot as a live restored wallet. The readiness check verifies the
origin's operation journal bytes did not change during provider observation.
Expired, missing or unresolved operations are never inferred to have returned.

This hardens first connection and unlock/reconnect paths that call
`readBrowserRecoveryReadiness`. It does not reconstruct SDK-private signing
state, prove complete provider history on a different device, restore already
started exits or authorize fresh claims. Legacy populated untagged store
ownership, funded-provider acceptance and independent security review remain
open. Native SDK behavior is unchanged.

Browser-guard-only activation prevents tests of SDK read helpers from acquiring
live-network permissions. The guarded operation gateway controls access;
unrecognized facades cannot obtain this capability.

Production interlock remains enabled. No live money, wallet keys, operator
deployments or existing browser state were modified.
