# Product capabilities and boundaries

This guide describes the implementation in this repository. Actual availability also depends on the deployed commit, feature gates, platform and provider response. It is not a release approval or a guarantee of settlement.

| Capability | Implementation and boundary |
| --- | --- |
| Bitcoin and Lightning payments | SDK-backed send/receive and payment details. Review costs and destination; reconcile uncertain outcomes before paying again. |
| On-chain Bitcoin deposits | Deposits are credited through Spark with applicable confirmation and claim rules. This is not a separate native UTXO wallet. |
| USDC/USDT routes | Sending and receiving workflows use SDK-discovered routes and quotes. Availability varies by token, network, direction and destination. |
| Merchant Point of Sale | Requests Lightning payment and matches incoming wallet records. A QR code or payer screenshot is not proof of settlement. The local sale record is not a cloud accounting backup. |
| History | Reads paginated SDK payment records through a displayed time cutoff before connected-wallet export. A page failure blocks export; selected filters define the exported scope. Loaded-record fixtures are explicitly labelled. Provider sync and local merchant order metadata are separate from payment-history coverage. |
| Recovery | Supports compatible passkey and recovery-phrase paths. Compatibility depends on wallet derivation, platform and passkey origin; arbitrary BIP39 imports are not a promise of balance discovery. |
| Languages | Language controls and translated journeys are present. Coverage and native-language verification must be checked per journey; a selector alone does not establish complete localization. |
| Buy Bitcoin and recurring buys | Conditional integrations. Planning UI or a coming-soon label does not establish an executable purchase, mandate or scheduled payment. |
| Personal Lightning addresses | Optional names under GetYourSats use wallet-bound email verification and provider-confirmed registration/recovery. Preserve existing addresses and recovery when pausing new registrations; availability depends on the deployed client and server configuration. |
| Native builds | Platform adapters are present. Native storage, biometric and recovery guarantees require verification in signed builds on real devices. |

## Brand and terminology

Lead everyday interactions with **GetYourSats**. Use Bitcoin, sats, Lightning, the selected stablecoin and the selected network when they help users understand a payment. Explain Spark and provider dependencies in [How your wallet works](https://getyoursats.com/support#how-your-wallet-works) and at decisions where custody or settlement differs. Branding must not obscure those distinctions.

Display exact asset units. A fiat estimate is not a purchase quote; a recipient's LNURL limit is not the user's available balance; a provider's deposit buffer is not automatically a fee. Keep those values separate.

## Implementation references

- Feature gates: `src/getyoursats/featureAvailability.ts` and relevant server-side configuration.
- Wallet connection and refresh: `src/hooks/useBreezSdk.ts`.
- Send and receive journeys: `src/features/send/` and `src/features/receive/`.
- Merchant requests and local records: `src/getyoursats/PosPage.tsx` and `src/getyoursats/posLedger.ts`.
- [Security boundaries](SECURITY.md), [cross-chain verification](docs/cross-chain-testing.md) and [release readiness](docs/maintainers/release-readiness.md).

Earlier implementation notes are preserved as [dated historical evidence](docs/archive/integration-notes-20261023.md). They do not describe the current release state.
