# Release audit: 2026-10-23

This feature branch implements actual Start + client wallet setup and places the Breez-issued anonymous Lightning Address on the wallet screen as soon as SDK registration completes. It does not claim email-verified GetYourSats names. Native first-run requires OS-backed vault persistence **before** SDK initialization, and a non-blocking backup reminder follows.

## Currency controls
- UI units: sats, BTC, INR across wallet header, send, receive, POS and DCA drafts. Payment settlement remains integer sats.
- INR requires Breez listFiatRates and currency-specific rate checks. It is **not an executable fiat ramp FX quote**. Merchant invoices use freshly requested rates; DCA draft saves need recent rates.
- DCA is local-only until contracted UPI AutoPay + Indian exchange APIs, consent, mandate lifecycle, refunds and reconciliation exist.

## Remaining release gates
- Run app on real iOS/Android devices and test keystore write/read, crash, reinstall and manual/PRF restore.
- Set client-distributable Breez SDK key directly in Vercel environment variables; never paste it into GitHub/chat.
- Stable wallet/passkey origin, domain and email-verified GetYourSats Lightning Address backend required.
- Live tiny-value send/receive, POS payment receipt and duplicate/reload reconciliation required.
- Vercel project access for `bradvani-8798` is not yet authorised to the available ChatGPT connector.
- FIU/licensed exchange and UPI partner contracts / compliant KYC/AML integration remain prerequisites for real ramp.
- Independent security audit before real-funds beta.
