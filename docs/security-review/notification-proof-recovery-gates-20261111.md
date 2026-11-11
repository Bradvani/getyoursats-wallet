# Notification proof and current recovery gates

Reviewed against combined candidate `28f2afce09ee3785ec208b19aa57f9673bcc6360`,
11 November 2026. This is a candidate-only compatibility correction, not a
production deployment or release approval.

## Narrow notification proof capability

The restricted gateway now accepts the existing `gys-push-v2` device contract:
the exact `https://wallet.getyoursats.com` origin, one of `subscribe`, `activate`,
`status`, or `unsubscribe`, the current compressed wallet public key, a lowercase
16-byte nonce and a lowercase 32-byte operation payload hash. Only mainnet and
compact signatures are admitted. The shared browser/server message builder
remains unchanged.

The signer must remain unlocked with the same wallet identity and storage
generation across identity lookup and signing. The returned public key must
match the challenge owner. A separate connection-local nonce cache reserves
synchronously before signing, retaining failed and ambiguous attempts for the
server's five-minute challenge lifetime. It is bounded to 1,024 active entries;
the server's existing Redis `GETDEL` and TTL remain the durable anti-replay
boundary. Notification identity proofs grant no payment or recovery permit.

Arbitrary message signing, mainnet Rampnow checkout proofs and raw SDK webhook
registration remain denied. In particular, fresh invoice-alert enrollment still
calls `registerWebhook` from `PaymentPushSetting.tsx`, which the gateway refuses.
The existing Lightning-address push fallback is a separate path. This change
must not be described as complete notification enablement.

The new contract fixture exercises the actual `signedPushOperation` browser
client, gateway and server `verifyOwnership` with ephemeral secp256k1 compact
signatures for all four actions. Modified device payloads fail verification.
Challenge transport/provider responses are fixtures; this is not real provider
registration or a Redis durability test. Separate tests cover malformed fields,
foreign origins/networks, owner/session/storage changes, concurrent nonce reuse,
failed signing, capacity and expiry. Existing email and sandbox checkout proofs
remain covered. Independent code review found no blocking defect.

Local validation: 173 tests passed in six proof/gateway/client suites; 60 tests
passed in four notification UI, SDK connection/lifetime and recovery-readiness
suites; 20 Node notification API/core/service-worker tests passed. TypeScript,
changed-file ESLint and diff checks passed. A Vercel production build was refused
with the expected security-release error. These checks did not use live funds or
provider registration.

## What still needs implementation versus acceptance

| Remaining gate | Work required | Current implementation and precise limit |
| --- | --- | --- |
| Populated legacy wallet ownership | Code and old-release fixture acceptance | `storageMigration/ownedStorage.ts` refuses assigning untagged populated stores to the presented seed. Build an evidence-backed ownership bridge or reconstruction; preserve original databases and unresolved records. |
| Replacement-device operational recovery | Provider integration/code and acceptance | `browserRecoveryReadiness.ts` already performs guarded provider observation followed by two full matching local-history scans. It does not reconstruct every pending provider operation, SDK-private signing state or exit on a replacement device. |
| Supported-network BTC receiving/claims | Reviewable implementation exposure and provider acceptance | Bounded deposit claims and `continueClaim` exist, but `DEPOSIT_CLAIMS` and Bitcoin-address receiving are development/regtest-only. Establish supported-network minimums, fees, interruption/reconciliation and spendable-credit evidence before extending that capability. |
| Ordinary Lightning receiving | Execution-contract/code and provider acceptance | A standard invoice capability exists in development/regtest; normal receiving is restricted. Complete bounded invoice/claim authorization and recovery. A special HODL contract is not a prerequisite for ordinary invoices. |
| Fresh or rebuilt exits | Code and settlement acceptance | The recovery controller adopts and resumes existing exact signed transactions. A new authorized builder still needs durable intent, selected inputs, fee/minimum-payout bounds, checkpoints, final sweep and rebuild lineage. |
| Fresh invoice webhook registration | Separate scoped SDK capability and acceptance | The notification proof added here does not expose `registerWebhook`; registration needs its own bounded, owner-controlled target contract. |
| iPhone/Android/PWA and rollout recovery | Physical/manual acceptance | Test the final artifact on Safari/PWA and Chrome/PWA, interrupted migration, old/new tabs, service-worker update and compatible recovery/rollback. Existing Linux browser tests do not establish these results. |
| Final independent security verdict | External review | Review the final application commit, exact modified SDK/WASM archive and release manifest. Implementation review and passing CI are not that verdict. |
| BTC production receipt | Provider configuration, code and owner-operated acceptance | Production origin/network/auth/storage and order-to-chain-to-claim-to-spendable-credit matching remain unfinished. The eventual minimum live BTC purchase must be personally authorized and funded by the wallet owner after the release gates pass. |

Provider-first observation, full local-history pagination, deposit continuation
and the SDK signer/storage-identity correction are implemented; older reports
that describe them as wholly absent are superseded. The unresolved ownership
bridge and complete replacement-device recovery are distinct work.

Source records: [current combined status](../qa/onramp-security-preparation-20261111.md),
[provider-first recovery](provider-first-recovery-20261030.md),
[migration acceptance](../review/security-migration-acceptance-20261031.md) and
[reconciled release gates](reconciled-release-gates-20261027.md). The production
build interlock remains enabled. No live wallet, provider registration, real
funds, production credentials or feature flags were changed.
