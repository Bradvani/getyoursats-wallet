# GetYourSats — functional and experience audit
Date: 2026-10-23
Git source: `Bradvani/getyoursats-wallet`
Purpose: distinguish compiled frontend, functioning SDK features, and unimplemented money-moving products.

## Evidence boundary
- Source reviewed at `main` plus `getyoursats/setup-ux-audit` PR. Unit/TypeScript/lint CI verifies code, not network settlement.
- GitHub commit statuses confirm Vercel builds; the Vercel app connector currently responds **link_id must identify an eligible linked account** and live runtime/browser tests could not be performed.
- GitHub E2E test added for failed-closed setup only. It is not a funded payment test.
- Public Vercel app URL could not be fetched from available browser tool.

## Functional audit (claim only what evidence supports)
| Area | Source finding | Release state |
| --- | --- | --- |
| Startup | Start checks SDK key configuration before creating/showing keys | Tested by unit; browser smoke added |
| Passkey | Breez PRF flow wired to one-button entry only on approved origin + supported device | Requires actual RP association and cross-device restore tests |
| Manual recovery | BIP39 mnemonic, offline challenge; seed clipboard buttons removed | Native screenshot behavior, encrypted storage and restore still require physical-device QA |
| Signing / Lightning | Breez Spark SDK wiring exists for BOLT11/LNURL/send/receive | SDK key/network/payment E2E unverified |
| Bitcoin address | Spark-compatible on-chain deposit address via SDK | NOT independent on-chain UTXO custody |
| Merchant POS | SDK creates BOLT11, event matches invoice before paid confirmation | No durable order ledger, settlement replay, refund reconciliation or POS audit; not merchant-ready |
| History | Upstream payment history on device | GetYourSats type indexing/export, multi-asset basis and optional India TDS ledger not implemented |
| Buying with INR | Legacy Glow MoonPay/Cash App integration in fork (now hidden by default) | No approved Indian exchange/UPI partner connector, funds escrow policy or spread service |
| DCA | No approved UPI recurring mandates; ₹20 economics not tested | Not implemented |
| Identity | Breez Lightning Address username registration in upstream | No email verification, customer consent, GetYourSats LNURL domain or unique username ownership backend |
| Multilingual | No confirmed Hindi/regional-language translation coverage | Not implemented |
| White label | No separate-tenant auth/scoping/webhooks/partner ledger | Not implemented |
| Fees / shared nodes | Spark routing is not GetYourSats Lightning channel provisioning | No demonstrated zero-fee intra-app settlement via owned channels |
| Security | Browser key storage fallback, secrets in local storage and unverified domain migration remain risks | Independent audit required |

## Major UX findings
1. Critical: Starting onboarding without valid service setup exposed backup phrase before error. **Code patched:** client preflight + persistent user-facing error.
2. Critical: Seed phrase clipboard control was previously present. Removed, static CI guard added in earlier PR.
3. High: Home page used inline isolated layout. Now replaced with consistent gold/black typography, responsive touch targets and reduced motion.
4. High: Floating POS action overlapped wallet bottom bar. Consolidated into Send / Receive / Scan / Accept dock.
5. High: Upstream purchase providers inappropriate for Indian UPI launch. Hidden pending a contracted GetYourSats rail.
6. High: Invalid / expired LN invoices, offline transaction states and POS settlements need device+integration testing.
7. Medium: Only one icon mark asset and developer-era assets persist in source; replace with reviewed app icon, launch splash, design tokens.
8. Medium: Regional-language support and accessible error localization require translation infrastructure.
9. Medium: Merchant POS needs native INR input + real-time quote + settlement evidence, not sats-only form.
10. Medium: New customer recovery story needs in-app education about passkey sync support and fallback.

## Test release gates (must all have evidence, not marketing)
- Confirm Vercel environment includes a Breez-approved **client-distributable** `VITE_BREEZ_API_KEY`, both Preview and Production as applicable. Values must never be committed or pasted in chat.
- Assign an owned permanent wallet HTTPS domain. Configure WebAuthn RP and passkey association; set `VITE_GETYOURSATS_PASSKEY_ORIGIN` to its exact origin only after restore QA.
- Test on iOS/Android + Chrome/Safari: new passkey, fresh reinstall, phone change, passkey missing/deleted, offline sync, manual recovery.
- Real small-value Lightning send and receive, Spark deposit and withdrawal, fee display, offline/error recovery; testnet/regtest where possible before mainnet funds.
- Merchant POS test invoice creation, external payment, duplicate event, reload, idempotency, reconciliation, refund, receipt.
- Exchange partner sandbox integration, legal / FIU / KYC / sanctions and UPI mandate review, settlement refunds; **do not** describe integration as live until contracted.
- External security assessment (CSP, seed storage, WebAuthn RP, supply chain, audit logs, incident playbooks) and beta limits.

## Required external dependencies from founder
P0: Breez-approved browser client API key; permanent wallet domain and DNS; connected Vercel team access; iOS/Android app/signing accounts for native recovery tests; identify real backend ownership.
P1: Email verification provider (identity not wallet custody); verified LNURL domain + Breez registration; merchant backend/DB/ledger; exchange/UPI/fiat ramp sandbox contracts; India fintech legal/compliance advisor.
P2: Channel node API endpoints/channel policy if genuinely using your channels, local language translations, tax app export specs, support and incident response coverage.

**Verdict:** Code-compiling wallet foundation / controlled technical preview. NOT funds-enabled public beta or investor demonstration of live on/off ramps.
