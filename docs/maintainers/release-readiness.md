# Release readiness

This is a reusable acceptance checklist, not a completed release record. Record evidence against a full application commit and SDK revision. A passing build does not establish safe custody or successful settlement.

## Wallet integrity and authorization

- [ ] Creating, restoring, reconnecting and migrating retain the intended wallet identity, balances, history and independent recovery route.
- [ ] Storage writes tolerate interruption, quota errors, damaged records and concurrent tabs without destroying the last recoverable state.
- [ ] Every applicable value-moving operation has an explicit authorization policy, including refunds, claims, conversions, migration and exits.
- [ ] Authorization is bound to the reviewed destination, network, asset, amount and fees; changes require a new approval.
- [ ] Cancellation, authentication failure, timeout, locking and backgrounding fail closed before execution.
- [ ] A duplicate action or stale callback cannot replay approval. SDK observers are not assumed to cover every spending path.
- [ ] Uncertain execution survives reload and reconnect and is reconciled before a fresh payment can be offered.
- [ ] Browser/passkey/native guarantees are described accurately. App authentication is not marketed as hardware-backed transaction signing.

## Payment and merchant reliability

- [ ] Quote expiry, fees, buffers, destination assets and unavailable routes are presented accurately.
- [ ] Bitcoin deposits include loading, retry, claim, refund and recovery states where supported.
- [ ] History and exports disclose their coverage; pagination does not lose or duplicate records.
- [ ] Merchant settlement remains accurate beyond one page of payments, after restart and during polling.
- [ ] Required regtest and authorized small-value settlement cases have independent wallet/network evidence.

## Interface and operations

- [ ] Verify 360, 390, 768, 1024, 1366 and 1920px, plus small-screen reflow, 200% zoom, keyboard operation and reduced motion.
- [ ] Verify supported browser engines and physical iOS/Android devices for relevant platform capabilities.
- [ ] Localize complete critical journeys and obtain native-speaker review of financial and security language.
- [ ] Measure cold/warm startup, interactions and offline/update behavior; record device/network conditions and asset budgets.
- [ ] Support delivery and replies work, and abuse controls apply across service instances.
- [ ] Public claims, feature gates, privacy notice and live integrations agree.
- [ ] Production contains no development fixtures or simulated financial state.

## Rollout and recovery

- [ ] The deployed artifact matches the reviewed commit; website and wallet releases are identified separately.
- [ ] A staged rollout and supported rollback/recovery path have been rehearsed with disposable data.
- [ ] Rollback never clears local wallet material or restores an older app that cannot read migrated state.
- [ ] Pending payments and exits survive updates and interrupted sessions.
- [ ] Unresolved blockers, monitoring and rollback triggers are recorded explicitly.

Security fixes may require a forward recovery release rather than a simple deployment rollback. Do not trade wallet recoverability for an apparently clean reset.
