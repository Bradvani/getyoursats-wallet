# Gate 2 payment validation, 28 October 2026

Base: main 37abc88bd113d6c519911fd6773dc74ce603282a.

## Finding and fix
Confirmation treated null and NaN fees as zero, allowed a negative fee and allowed a fee-inclusive quote with no recipient output. New regressions reproduced four failures before the fix. Confirmation now requires valid positive whole-sat amount, a nonnegative whole-sat fee, a valid total and a positive recipient output. Missing or invalid quotes display pending figures instead of misleading zero fees. An actual zero fee remains valid. This is a presentation/confirmation boundary, not SDK authorization or provider settlement certification.

## Local evidence
137 tests across 19 selected files passed: send and receive features, payment history and payment moment policy. This includes seven new cases: five invalid fee values, zero recipient output and insufficient balance for added fees. Existing cases retain actual zero fee and recipient amount plus fee behavior.
Application TypeScript and ESLint for the two changed TSX files passed. Focused confirmation run: 12 passed. Tests used existing locally installed dependencies (Vitest 4.1.5); fresh lockfile install and CI remain separate. No live operator calls or real funds were used.

## Route acceptance status
- Direct Spark receive route remains isolated in draft PR #46 (775f50b). It is not in this main-based change. A GYS Lightning address must not be assumed free solely from its domain.
- Main confirmation regression tests support recipient amount plus fee and true zero fee. Live balance deltas and recipient settlement remain unverified.
- Local payment-state coverage is not durable SDK reconciliation. Lost acknowledgement, reload, backgrounding and reconnect require original-attempt authoritative receipt evidence on each enabled route.
- PR #43 remains separate Gate 1 work. This change neither closes A01–A03 nor authorizes funded rollout.

## Remaining Gate 2 acceptance
Use two disposable wallets and a separate external Lightning counterparty after the security gate and candidate are agreed. Record exact application commit and SDK hash, wallet/network pseudonyms, quoted recipient amount, fee and total, actual sender debit, actual recipient credit and authoritative receipt IDs. Do not record secrets.
Verify direct Spark transfer and external invoice/Lightning-address send and receive, including nonzero fees, insufficient funds, expired invoice and route failure. For each enabled route exercise acknowledgement loss, reload, background and reconnect; reconcile the same operation without sending again. Retain unresolved results as unknown, never infer failure from absent history.
Confirm production serves the accepted source before declaring Gate 2 complete. Physical devices and funded settlement were not tested here.
