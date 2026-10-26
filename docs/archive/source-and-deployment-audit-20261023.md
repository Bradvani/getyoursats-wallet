# GetYourSats wallet — source and deployment audit
**Date:** 2026-10-23  
**Scope:** `Bradvani/getyoursats-wallet`, Breez Glow/Spark SDK fork, Vercel Git deployment.

## Evidence and audit limitations
- Baseline production-branch GitHub Actions: build/test/lint passed on `093c0cf` (GitHub run `39852166190`).
- GitHub Vercel commit status for `093c0cf` reports success, linking to `vercel.com/bradvani-8798/getyoursats-wallet/EqBDy3Soushi1w6DeyK6wj5XqLra`.
- **No deployed browser runtime audit or Vercel environment/runtime logs has been performed**: the connected Vercel app currently accesses `bharat-5695` team rather than deployment owner `bradvani-8798`.
- Green compilation/unit tests are *not* evidence of bitcoin settlement, backup recovery, wallet threat-model suitability, or partner regulatory approval.
- Upstream Breez Glow Web is presented by Breez as a **web reference demo, not intended for production use**: https://sdk-doc-spark.breez.technology/guide/getting_started.html .

## Critical (P0) findings
| ID | Issue | Verified evidence | Fix / release condition |
|---|---|---|---|
| GYS-SEC-001 | Native Start could create wallet immediately without proving independent recovery | `src/App.tsx` pre-audit | **Patch:** all platforms now visit existing mnemonic/backup page before SDK connection. True one-tap creation requires audited vault and restore path |
| GYS-SEC-002 | Missing Breez SDK key could silently return from connect, while upstream navigation tried to advance | `src/hooks/useBreezSdk.ts` | **Patch:** propagate connection failure; avoid fake connected state; retain visible failure |
| GYS-SEC-003 | Tutorial API keys may reach SDK as if valid | `src/services/sdkConnect.ts`, `example.env` | **Patch:** empty/tutorial placeholders rejected with tests; user obtains approved browser-distributable API key |
| GYS-IDENT-001 | Custom LNURL domain could be activated by env/local developer settings without verified email → username entitlement | `sdkConnect.ts`, `SettingsPage.tsx` | **Patch:** disable overrides until domain approval and identity service exist. Cannot launch `@getyoursats` aliases yet |
| GYS-SEC-004 | Browser recovery phrase can persist in localStorage in fallback mode | Upstream `src/hooks/useBreezSdk.ts`, upstream README | Production browser wallet requires key custody threat model, passkey/recovery review, CSP/XSS review and migration policy |
| GYS-POS-001 | POS invoice is SDK-created and `paymentSucceeded` matched, but durable merchant order ledger, idempotency, reconciliation and reload recovery do not exist | `src/getyoursats/PosPage.tsx` | Test real event/settlement, offline/restart recovery, duplicate events; implement server-side merchant sale ledger before launch |
| GYS-OPS-001 | New deployment cannot be inspected through connected Vercel team | GitHub Vercel status vs connected Vercel `list_teams` | Grant connector to correct Vercel team or provide permissioned access and exact preview URL |

## High (P1) product/integration gaps
- **BTC network:** Spark deposit addresses offer Bitcoin on-chain interoperability. They do **not** mean users own independently managed native UTXOs. Add separate, audited BDK-based wallet only if independent native custody is a launch requirement.
- **Lightning:** Spark SDK is nodeless. It is **not linked** to existing GetYourSats Lightning channels and does not automatically implement zero-fee intra-app routes or node-controlled fee policies. Choose Spark settlement economics vs dedicated LSP/channel strategy explicitly.
- **Account:** Email verification/login, secure account linking, verified Lightning username claims, passkey RP/domain migration and device-loss recovery require dedicated implementation.
- **India fiat:** UPI collection/payout, live INR/BTC quote/fee/spread, licensed exchange execution, KYC/AML, refund/reconciliation and bank/mandate approval are not implemented.
- **DCA:** INR 20 minimum, fixed fee economics, mandate schedule/notification/dunning, provider supports remain unimplemented.
- **Tax:** transactions can be stored by the SDK, but jurisdiction-specific TDS/VDA tax classification, merchant cost basis and export integration are not production-complete.
- **White-label:** no production tenant isolation, partner API authentication/quotas, entitlements, webhooks, partner settlements or branded mobile SDK builds.
- **Mobile & accessibility:** no verified signed iOS/Android GetYourSats builds, secure storage restore tests, accessibility or device test matrix.
- **Operations:** fraud limits, rate limits, dispute/refund operations, incident response, customer support, privacy policy and legal terms are not approved or complete.

## Breez setup: corrected links
- Landing/contact form: https://breez.technology/sdk/
- Documentation: https://sdk-doc-spark.breez.technology/guide/getting_started.html
- Branded LNURL domain: https://sdk-doc-spark.breez.technology/guide/custom_domain.html
- `/contact/apikey` is intended for HTTP POST from scripts, not a web-browser form.
- Use **approved client-distributable** SDK key in Vercel `VITE_BREEZ_API_KEY` for preview and production separately. Vite embeds it in browser JavaScript. Do not commit it to Git.
- Use an owned, stable GetYourSats domain for web wallet/passkey RP before real funds; domain changes can break credential discovery.

## Release gate — evidence to obtain
1. Confirm Vercel build matches exact reviewed `main` SHA; collect build/runtime logs and browser smoke test, responsive Safari/Chrome.
2. Confirm SDK init with explicitly approved key, plus disconnected/reconnect and fail-closed missing key behavior.
3. Prove wallet key creation, backup, device reinstall and second-device restore in supported environments.
4. Prove real tiny test-value BOLT11 send/receive, Spark deposit/withdrawal, invalid invoice, fee disclosure and offline resumes; no fabricated receipts.
5. Merchant POS: create invoice, pay via separate wallet, verify event, reload/recover, reconcile paid/expired/refunded/duplicate transactions.
6. Email verified alias registration with idempotent username assignment; wallet linking must not send private signing material to backend.
7. Approved exchange/UPI sandbox integration with refunds/reconciliation and regulatory sign-off; validate fee schedule and minimum amount.
8. Security audit and operational readiness (CSP, password/passkey domains, recovery, wallets, monitoring, privacy, support).
9. Signed native builds / external beta review; only then consider widening to real funds.

**No investor or public copy should claim functioning UPI, native on-chain self-custody, verified GetYourSats Lightning usernames, free intra-wallet node routing, or tax automation until they are actually integrated and tested.**
