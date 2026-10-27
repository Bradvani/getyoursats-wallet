# Fresh public REGTEST probe: source boundary assessment

**Recommendation: do not run the existing probe unchanged as strict observation-only acceptance.** This is an internal, read-only source assessment, not a demonstrated automatic-claim vulnerability or release approval.

The reviewed application files match frozen commit `1298724dfe1d95b7a0a24f19be80e6e977cec011`. Primary sources are [`scripts/security/probe-public-spark-regtest.mjs`](https://github.com/Bradvani/getyoursats-wallet/blob/1298724dfe1d95b7a0a24f19be80e6e977cec011/scripts/security/probe-public-spark-regtest.mjs), [`e2e/fixtures/public-spark-regtest.ts`](https://github.com/Bradvani/getyoursats-wallet/blob/1298724dfe1d95b7a0a24f19be80e6e977cec011/e2e/fixtures/public-spark-regtest.ts), and [its workflow](https://github.com/Bradvani/getyoursats-wallet/blob/1298724dfe1d95b7a0a24f19be80e6e977cec011/.github/workflows/public-spark-observation.yml).

## Protections established by source inspection

The runner creates two fresh, nonpersistent browser contexts with service workers blocked. It supplies no retained profile or storage state. The fixture generates random disposable seed material, refuses existing vault/mnemonic markers, requires explicit REGTEST, clears the API key, and uses a unique SDK storage directory. Only connect, observe and stop are exported; no approval-completion hook is installed.

[`src/services/sdkConnect.ts`](https://github.com/Bradvani/getyoursats-wallet/blob/1298724dfe1d95b7a0a24f19be80e6e977cec011/src/services/sdkConnect.ts) disables background tasks, realtime sync, conversions and automatic optimizers, installs the operation observer before building the SDK, and attaches session/lifetime guards. `src/security/operationGateway.ts` maps facade `syncWallet` to `observeWalletState`, never raw active sync. The pinned SDK runtime selects `ServerRuntime` when background tasks are disabled; its startup does not launch the client initial-sync/automatic-claim loop. **No automatic-claim bug was demonstrated.**

## Concrete limitations of the existing evidence path

- The runner unconditionally opens the public faucet UI after the wallet checks, exceeding the proposed connection/observation-only scope even though it does not submit a funding request.
- The fixture calls `receivePayment` for Spark and Bitcoin addresses. The DEV REGTEST facade permits this provisioning path; these are additional provider operations, not merely balance/history observation.
- Neither runner nor workflow invokes the canonical installed-package preflight before browser SDK imports. TypeScript checking and a source-commit label do not bind the executed archive, patch, wrapper and WASM.
- `src/security/guardedExternalSigners.ts` is a session-revocation guard: while unlocked, it forwards available signer methods. The outgoing observer rejects missing authorization, but the probe has no separate deny-only signing/transport boundary or attempt counters. Its `gatewayInstalled`, `spendingAttempted` and `claimsAttempted` fields are constants, not measured evidence of denied execution.

A fresh empty-wallet probe could establish basic connectivity/authentication and zero-balance observation. It cannot establish positive settled-receipt compatibility, funded settlement, claim/exit safety or legacy database ownership. Distinct random storage directories also do not prove separation of different identities sharing the normal storage prefix.

**No probe, build, SDK initialization, profile/seed access, faucet visit, funding request or provider operation was performed for this assessment.** No harness, guard or release policy was changed. The settled-receipt observer remains unconditionally blocked and was not routed around. No live execution command is recommended.
