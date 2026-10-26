# Wallet setup tour

## Product behavior

The manual tour covers recovery, balance display, receiving sats and an optional GetYourSats name, in that order. **Next** advances one step; the last action is **Finish Tour**. **Skip for now** dismisses it without completing recovery. There is no timed advance or automatic seed reveal.

**Review Recovery** opens the existing guarded backup flow. The wallet remains usable with setup unfinished. A home card tracks two separate tasks: recovery review and tour completion. It disappears when both are complete. A custom name is not a completion requirement: email verification and name selection remain optional, and email does not recover the wallet.

The tour pauses while the app is locked, another wallet screen is active or a payment, scanner, migration or other blocking flow is open. **Settings > Wallet Tour** replays it from the recovery step while preserving the recorded recovery status. The home card can resume a skipped tour.

## Enrollment and local progress

Automatic enrollment requires an explicit new-wallet action and a successful, non-null SDK client returned by `connectWallet`. The creation event is bound to that exact client object. Enrollment waits for a connected wallet with a valid public identity and network; a replacement client cannot inherit the earlier event.

- New passkey creation and a newly created native vault start with recovery pending.
- New phrase creation records phrase verification because `GeneratePage` reaches its connection callback only after its backup challenge succeeds.
- Restore, passkey sign-in, unlock, native vault reopening, and ordinary reconnect do not create enrollment events. Returning wallets can resume their own previously stored progress.
- A failed connection or an already-connected call returning `null` cannot enroll a wallet. Existing skipped/completed tour state is preserved.

Progress is local to the device/browser, scoped by network and public wallet identity under `gys:wallet-setup:v1:<network>:<public-wallet-identity>`. It contains only version, tour status, current step, and recovery status. It is not a server attestation or a recoverable wallet backup. Clearing site data removes it; blocked storage retains progress only for the current session. Old unscoped backup flags are not treated as verification.

`App` keys backup and email screens by wallet scope and rejects recovery callbacks from an older client or scope. Successful explicit phrase connections and new native vault creation clear stale passkey-session mode only after success. Existing native vault reopening preserves its mode. This cleanup preserves registered credential history, the credential registry, and RP metadata.

## Recovery status meanings

| Status | Meaning |
| --- | --- |
| `pending` | No recovery review or phrase check has been recorded for this wallet on this device. |
| `passkey-reviewed` | The user explicitly acknowledged which provider/account holds the passkey and the need for the same passkey and wallet label on another compatible device. This is a review, not proof of syncing or backup. An independent offline phrase backup remains optional. |
| `phrase-verified` | The user passed a two-word check after explicitly revealing the phrase and acknowledging a handwritten copy. Words are hidden during the check. Revealing, skipping, or finishing the tour alone cannot set this status. |

Phrase verification cannot be downgraded by a later passkey review. Existing PIN, credential pinning, private-viewing, and native capture protections remain in the backup flow. Challenge answers and recovery words are not added to setup persistence.

## Verification boundaries

- `e2e/tests/getyoursats-wallet-tour.spec.ts` uses a synthetic browser fixture with the real wallet/tour UI and isolated read-only SDK responses. Recovery and identity destinations in that fixture are stand-ins. It checks interaction, layout, navigation, persistence, and wallet isolation without live payments or credentials.
- `src/App.walletSetup.test.tsx`, `src/pages/BackupPage.test.tsx`, and the setup-state/hook tests exercise actual App enrollment/auth-mode and backup handlers with synthetic dependencies, including failed connections, fallback, privacy gates, incorrect answers, and registry preservation.
- These tests do not establish physical passkey-provider syncing, account recovery, cross-device PRF compatibility, or a live wallet restoration. The UI deliberately makes no such claim.

Implementation: `src/App.tsx`, `src/hooks/useWalletSetup.ts`, `src/getyoursats/walletSetupState.ts`, `src/getyoursats/WalletSetupTour.tsx`, `src/getyoursats/WalletSetupCard.tsx`, and `src/pages/BackupPage.tsx`.
