# GetYourSats integration build
Forked from Breez Glow (MIT). Original upstream license retained. This branch replaces onboarding and core branding, adds a merchant POS using the actual Spark SDK invoice method and preserves upstream Bitcoin/Lightning send/receive/recovery.

## Important boundaries
- Web Start uses upstream mnemonic backup flow. Native Start connects to SDK using CSPRNG-backed BIP39 seed generation; native secure vault must still be independently verified.
- A Spark Bitcoin deposit address is not independently controlled on-chain UTXO custody.
- Merchant POS creates invoices, **not settlement receipts**; do not release goods without verified payment status.
- Email login, Lightning Address domain services, Indian exchange partner ramps, UPI AutoPay, income tax integrations and multi-tenant APIs remain unconnected.
- Need approved VITE_BREEZ_API_KEY for mainnet; Vite variables are bundled into client and require an explicitly client-shareable provider key.
- This branch requires CI TypeScript/build/unit/e2e validation, testnet/regtest payments, independent security review and regulatory signoff before funds-enabled release.
