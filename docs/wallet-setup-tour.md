# Wallet setup tour

## Product behavior

The inline guide covers language, recovery backup, balance display, receiving sats, Point of Sale and a GetYourSats name, in that order. **Next** advances one step; the last action is **Finish**. **Skip for now** collapses it without completing recovery. Wallet navigation and payment controls remain available. There is no timed advance, modal scrim, focus trap or automatic seed reveal.

**Back Up Wallet** opens the guarded backup flow, which recommends writing and checking an independent recovery copy before adding funds. A compact Home card tracks two separate tasks: a verified phrase backup and guide completion. It disappears once the phrase backup is verified, even if the optional tour was skipped or never started. Its × button dismisses the card for that wallet without marking backup or tour completion. Dismissal survives sign-in and reload on the same browser. A passkey review alone does not complete the backup task. Email verification and name selection remain optional; email does not recover the wallet.

The guide pauses while the app is locked, another wallet screen is active or a payment, scanner, migration or other blocking flow is open. It preserves its layout beneath covering screens and becomes inert until they close. **Settings > Help & information > Replay Wallet Guide** starts it from language while preserving recovery status. The Home card can resume a skipped guide. History and merchant navigation remain independent of guide progress.

Device language is the initial default unless the user has saved a preference. The language step exposes the existing selector and applies changes immediately. All new guide and backup copy covers the ten supported app languages, including RTL layout. Feature previews use finite motion, preserve all meaning with reduced motion and never display real recovery words or fabricated payment records. Opening the POS showcase does not create an invoice.

## Enrollment and local progress

Automatic enrollment requires an explicit new-wallet action and a successful, non-null SDK client returned by `connectWallet`. The creation event is bound to that exact client object. Enrollment waits for a connected wallet with a valid public identity and network; a replacement client cannot inherit the earlier event.

- New passkey creation and a newly created native vault start with recovery pending.
- New phrase creation records phrase verification because `GeneratePage` reaches its connection callback only after its backup challenge succeeds.
- Restore, passkey sign-in, unlock, native vault reopening, and ordinary reconnect do not create enrollment events. Returning wallets can resume their own previously stored progress.
- A failed connection or an already-connected call returning `null` cannot enroll a wallet. Existing skipped/completed tour state is preserved.

Progress is local to the device/browser, scoped by network and public wallet identity under `gys:wallet-setup:v1:<network>:<public-wallet-identity>`. It contains only version, tour status, current step, recovery status and the `cardDismissed` preference. Existing version-1 records without that preference keep their recovery evidence and default to not dismissed. It is not a server attestation or a recoverable wallet backup. Clearing site data removes it; blocked storage retains progress only for the current session. Old unscoped backup flags are not treated as verification.

`App` keys backup and email screens by wallet scope and rejects recovery callbacks from an older client or scope. Successful explicit phrase connections and new native vault creation clear stale passkey-session mode only after success. Existing native vault reopening preserves its mode. This cleanup preserves registered credential history, the credential registry, and RP metadata.

## Recovery status meanings

| Status | Meaning |
| --- | --- |
| `pending` | No recovery review or phrase check has been recorded for this wallet on this device. |
| `passkey-reviewed` | The user explicitly acknowledged which provider/account holds the passkey and the need for the same passkey and wallet label on another compatible device. This does not prove syncing or complete the independent recovery-backup task. |
| `phrase-verified` | The user passed a two-word check after explicitly revealing the phrase and acknowledging a handwritten copy. Words are hidden during the check. Revealing, skipping, or finishing the tour alone cannot set this status. |

Phrase verification cannot be downgraded by a later passkey review. Existing PIN, credential pinning, private-viewing, and native capture protections remain in the backup flow. Challenge answers and recovery words are not added to setup persistence.

## Verification boundaries

- `e2e/tests/getyoursats-wallet-tour.spec.ts` uses a synthetic browser fixture with the real wallet/tour UI and isolated read-only SDK responses. Recovery and identity destinations in that fixture are stand-ins. It checks interaction, layout, navigation, persistence, and wallet isolation without live payments or credentials.
- `e2e/tests/getyoursats-backup-setup.spec.ts` renders the actual Backup page with synthetic passkey-mode metadata and no seed or credential. It checks initial guidance and guarded action layout without invoking reveal or authentication.
- `src/App.walletSetup.test.tsx`, `src/pages/BackupPage.test.tsx`, and the setup-state/hook tests exercise actual App enrollment/auth-mode and backup handlers with synthetic dependencies, including failed connections, fallback, privacy gates, incorrect answers, and registry preservation.
- These tests do not establish physical passkey-provider syncing, account recovery, cross-device PRF compatibility, or a live wallet restoration. The UI deliberately makes no such claim.

Implementation: `src/App.tsx`, `src/hooks/useWalletSetup.ts`, `src/getyoursats/walletSetupState.ts`, `src/getyoursats/WalletSetupTour.tsx`, `src/getyoursats/WalletSetupCard.tsx`, and `src/pages/BackupPage.tsx`.
