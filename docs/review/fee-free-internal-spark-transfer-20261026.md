# Direct Spark transfers for GetYourSats wallets

Date: 2026-10-26. Scope: reviewable, isolated receive UX and tests. **Not a funds-enabled production approval.**

## Problem and behavior

Two GetYourSats Spark wallets paying each other through an LNURL/Lightning Address can pay Lightning interoperability fees. This is not a GetYourSats platform markup. Spark-to-Spark BTC transfers have no Spark network transfer fee. The wallet already supports SDK `receivePayment({paymentMethod:{type:'sparkAddress'}})` and direct Spark address `prepareSendPayment` / `sendPayment`.

This change makes the direct path discoverable on Receive → BTC → **Pay me directly on Spark**. It only generates a Spark receive address when explicitly requested. The recipient can scan/copy/share the Spark QR and the payer can scan/paste it into the existing Send flow. The SDK parses the Spark address and prepares the payment. Users still confirm the exact recipient and amount.

**Do not reinterpret ordinary Lightning Addresses or LNURL-Pay as Spark.** Those protocols do not reveal authenticated Spark wallet identity. Routing them directly without an identity binding could misroute funds and would break Lightning preimage/invoice and merchant settlement assumptions. The existing LNURL and BOLT11 send behavior is intentionally unchanged.

## Supported fee claim

A plain Spark BTC-to-BTC transfer has zero Spark network transfer fee. This does not mean every transaction between two GetYourSats users is free today: Lightning, conversions, cross-chain deposits and chain exits can have network/provider costs. We have not installed a GetYourSats internal service fee. No fee is hidden or waived by altering SDK accounting. Sender confirms actual SDK preparation before execution.

Spark receiving uses a static address and has linkability/privacy trade-offs. The receive UI discloses this, and it provides a retry on SDK generation failure without displaying an empty QR.

## Verification

- Unit/integration fixture: direct Spark address request, no Lightning invoice, return to Lightning, generation failure and retry.
- Send fixture: direct Spark address is prepared with the SDK and executes `sendPayment`, not `lnurlPay`.
- Required before funds-enabled release: run and record TypeScript, lint, test, full browser accessibility, physical iOS/Android and tiny-value payments between **two independently restored test wallets**, verifying sender debit equals receiver credit, zero direct transfer fee and durable status after reload/offline.
- Independently close the source and WASM signer/reconciliation/rollback security NO-GO in PR #43. No auto-routing or fee-free promise on arbitrary Lightning addresses until verified GetYourSats public recipient identity mapping exists.
- Keep marketing language honest; do not claim username-based fee-free payments or general zero-cost Bitcoin operations are live.

## Future verified contact flow

Store a user-authorized Spark destination alongside an optional verified GetYourSats handle, with authenticated binding, revocation, key rotation and anti-substitution checks. Prepare direct Spark BTC when the binding and fee/asset quote are valid. Otherwise stay with the chosen external Lightning route and disclose fees. Never silently substitute an unrelated Spark recipient.
