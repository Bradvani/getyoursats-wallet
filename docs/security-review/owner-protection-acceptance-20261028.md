# Owner-reported same-wallet protection acceptance

## Scope

The owner performed the isolated, no-payment protection-page checks associated with PR #70, source `9f3f04443e4b948d7b3a76519f3f2eeb48fa18f3` and visible build `9f3f04443e4b`. The primary device was reported as iPhone 17 Pro / iOS 27.1. Results below are the owner's conversational reports, not independently observed device telemetry. The second browser/device combination and installed-PWA coverage were not fully specified.

No recovery phrase, password, encrypted backup file, biometric data or passkey material is included in this receipt. The fingerprint was a test identifier, not a Bitcoin address. The test page made no wallet-service or blockchain connection.

## Completed checks

| Owner test | Reported outcome |
| --- | --- |
| Add passkey protection to the existing disposable wallet | Same displayed fingerprint after passkey unlock |
| Cancel unlock, then authenticate on retry | Remained locked on cancellation; later authentication succeeded |
| Original password unlock after passkey enrollment | Succeeded for the same wallet |
| Separate-browser encrypted-file recovery with linked passkey | Succeeded for the same wallet; password unlock also remained available afterward |
| Clean-browser encrypted-file recovery with password only | Owner explicitly reported success after being asked to avoid passkey authentication in that restoration |

These checks are complete as owner-reported acceptance for the tested protection flow. Do not ask the owner to repeat them merely because a later, unrelated integration candidate is assembled. A later change to the protection implementation may require a specifically justified regression check, not automatic invalidation of this evidence.

## Boundaries

This receipt does not establish authoritative balances, complete transaction history, outstanding payment/claim/exit recovery, old/new-tab storage migration, Android/native-shell behavior, all passkey providers, physical hardware isolation or an independent audit. The original recovery-word display gap was not retested or declared fixed here. Full Gate 1 remains separate from this accepted key-protection sequence.
