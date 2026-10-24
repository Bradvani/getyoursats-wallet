# GetYourSats finality architecture | 24 October 2026

## Core product decisions
- Keep Breez Spark as the default self-custodial consumer wallet rail while putting a GetYourSats-owned payment adapter between wallet engine and business features.
- Wallet authority: seed/passkey-derived user signing keys. Backend never receives wallet seeds or unrestricted signing power.
- Merchant authority: optional verified email/business account; it binds to a wallet PUBLIC identity using a fresh signed wallet challenge. An email session may view account/ledger records, but cannot authorize a spend or silently change the receiving wallet.
- Separate native BDK descriptor/UTXO wallet only if we keep the independent on-chain custody promise. Spark-compatible BTC deposits are not that independent wallet.
- BOLT11 is the per-order POS invoice today. Add reusable Lightning Address/LNURL receiving. Evaluate BOLT12 against the **actual released Spark SDK build** before claiming support.
- Our LND/CLN channels do not control Spark routing. Remove assumed channel setup/routing revenue from forecast until separately proven.

## Storage and authority matrix
| Resource | Trust boundary | Backend data |
| --- | --- | --- |
| Wallet spend and recovery | User signing keys / vetted secure vault | None of seed, mnemonic, private key |
| Wallet identity | User-signed fresh nonce | Public identity and nonce use record |
| Email identity | Delivered OTP, provider KYC as applicable | Verified address, consent, revocation |
| Merchant organization | Business session and cryptographic wallet binding | Organization ID, roles, public payment destination |
| Order | Immutable idempotent merchant ledger | Order ID, money amounts, denomination, quote, invoice, status history |
| Fiat ramp | Regulated exchange and authorized PSP | Partner order and quote IDs, receipts and compliance references |
| DCA | PSP mandate and exchange execution | Consent, schedule, per-attempt receipts, retry/cancel state |

## Merchant state machine
Create immutable order ID and price snapshot -> issue invoice through selected rail -> mark pending -> obtain independently verifiable payment evidence -> reconcile exact order/payment/amount/network -> mark paid once, idempotently -> issue receipt, reports and tax classification.
- A UI click, localStorage flag or a similar amount in history is never sufficient proof of payment.
- Webhook raw body signatures, replay window, dedupe, timestamp and source rules must be provider-specific and audited.
- Late payment after expiry, duplicate events, app restarts, partial payments and Spark invoice-correlation loss must never silently show paid.
- Multi-cashier support requires safe restricted invoice creation/delegation; do not duplicate a signing seed across POS devices.
- Refund requires a new outbound authorization and proof, not a reversible Lightning charge assumption.

The current POS branch implements **only device-local public invoice journal + SDK reconciliation**. It is NOT the server merchant ledger described here.

## Intended interfaces
- Account: signed wallet challenge, email OTP, server session, refresh/revoke, account deletion.
- Domain: username uniqueness + ownership proof, LNURL address registration, external resolution tests, migration policy.
- Merchant: order/create, invoice/create, payment/status, signed webhook, staff/roles, receipt, reports, manual-review queue.
- Ramp: firm executable quote, KYC redirect, order, UPI settlement, BTC delivery, fees, payout and refund.
- DCA: mandates, schedule, execution, pause/cancel, retries, cost-basis and statements.
- Wallet adapter: createInvoice, listenPayments, reconcilePayment, receiveAddress, sendPayment, capability flags; unsupported features disabled rather than faked.

## Sequenced release gates
0. POS crash and key integrity: actual Safari/Chrome reproduction, sanitized component stack, valid BOLT11 QR and external tiny payment, restored wallet keeps same identity.
1. Merchant reliability: persistent backend ledger, signed payment evidence, replay/idempotency, multi-session recovery, receipts, refunds, cashier permissions.
2. Optional identity: production OTP service, wallet signed challenge, account sessions, account deletion, functioning custom username@domain LNURL, distinct wallet recovery.
3. Indian buy/sell: Hypermid named operator, signed commercial terms, FIU/UPI/KYC checks, firm quote and minimums, verified Spark delivery, payout/refunds, pilot reconciliation.
4. DCA: approved mandates, real minimum including all fees, scheduler, pause/cancel, tax records.
5. Mobile/global and native on-chain: signed iOS/Android with device restore test matrix, human reviewed locales, optional audited BDK rail.
6. Developer/white-label: separate tenants, scoped API keys, quotas, signed callbacks, portal and usage metering.

## External release blockers
Hypermid sandbox/live access and entity agreements, legal FIU/PSP allocation, domain owner-controlled DNS + LNURL proxy, Resend/Upstash credentials, real iOS/Android recovery QA, and independent security review. Do not enable fiat execution or loosen wallet storage safeguards to bypass any blocker.

## Evidence policy
Passing build/CI or receiving a Vercel READY deployment is not evidence of real payment settlement, secure restore, approved UPI processing or complete merchant accounting. Preserve test evidence and deployment SHA for each gate. Never paste seeds or production secrets into this repository or tickets.
