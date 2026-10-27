# Passkey recovery support guide

The user-facing guide is **Support → Restore wallet access**, anchored at `/support?lang=en#section-1`. It is included in both `site/support.html` (public website) and `public/support.html` (wallet-hosted support).

## Scope

Eight scenarios have numbered instructions in every current app language: English, Hindi, Spanish, Portuguese, Japanese, Thai, Vietnamese, Tamil, Arabic and Simplified Chinese.

| Scenario | Direct-link anchor |
| --- | --- |
| Google passkey, Android to iPhone; Chrome versus the Google search app | `#passkey-google-to-iphone` |
| Google passkey, iPhone or Android to Android | `#passkey-google-to-android` |
| Apple Passwords, iPhone to iPhone/iPad | `#passkey-apple-to-apple` |
| Apple Passwords to Android with a nearby iPhone and QR | `#passkey-apple-to-android-qr` |
| Secure transfer between password managers, where available | `#passkey-move-provider` |
| Missing passkey, cancellation, timeout and unsupported wallet cryptography | `#passkey-missing-passkey` |
| Lost, broken or erased original device | `#passkey-lost-device` |
| Verify the same wallet before erasing the old device | `#passkey-verify-wallet` |

Use `?lang=hi`, `es`, `pt`, `ja`, `th`, `vi`, `ta`, `ar` or `zh-CN` before the anchor. A direct link opens its scenario. The existing language selector updates the guide, wallet explainer and URL. The guide has its own language/direction attributes because other support sections do not yet have full translation coverage. Arabic uses RTL. English steps remain readable without JavaScript.

## Maintain one source

- Edit `scripts/support/passkey-copy.json` for all translated copy. Each language must have all eight scenarios and their numbered steps.
- Edit `scripts/support/passkey-guide-runtime.js` for language switching and direct-link behavior.
- Run `node scripts/support/generate-passkey-guide.mjs` to update both hosts, including the static English fallback.
- Run `node scripts/support/generate-passkey-guide.mjs --check` to detect stale generated files.
- The browser smoke test checks both hosts, locale completeness against `APP_LANGUAGES`, each language, persistence, blocked storage, unknown-language fallback, hash links, Arabic layout and the no-JavaScript fallback.

Translation coverage is implemented. Automated checks do not establish native-speaker review or physical-device recovery acceptance.

## Recovery boundaries

Use Restore, the original credential, the original website and the same wallet label when requested. A new passkey is not a replacement recovery key. Keep the original device and wallet data until recovery is independently verified. A synced credential, successful WebAuthn sign-in or QR authentication is not proof of the wallet's PRF-derived key continuity.

Provider transfer and Apple-to-Android QR access are documented as platform options with GetYourSats wallet recovery still unverified. Do not claim that exporting a passkey preserves its PRF output. Do not describe password CSV export as a passkey backup. If no compatible original credential or verified backup remains, email, a Lightning username and support cannot recreate wallet keys.

The reported Android-to-iPhone incident was resolved at **credential recognition** after installing Chrome. It did not establish same-wallet identity, balance, restart access or a disposable-wallet payment. Physical-device acceptance remains separate from this documentation change. Test a disposable wallet for each route before changing that status; do not use real funds to validate an unverified route.

## Platform references

Checked against current official guidance while preparing this guide:

- [Google: passkeys on iPhone/iPad](https://support.google.com/chrome/answer/13168025?co=GENIE.Platform%3DiOS)
- [Google: supported environments and cross-device QR](https://developers.google.com/identity/passkeys/supported-environments)
- [Google: import/export passkeys to Chrome on iPhone](https://support.google.com/chrome/answer/13068232?co=GENIE.Platform%3DiOS)
- [Apple: use passkeys on iPhone](https://support.apple.com/guide/iphone/use-passkeys-to-sign-in-to-apps-and-websites-iphf538ea8d0/ios)
- [Apple: passkeys and secure credential exchange](https://developer.apple.com/passkeys/)

Platform support varies by OS, browser, password-manager version and policy. Recheck the sources when updating menu names or availability. This guide does not change wallet signing, seed derivation, payment authorization, release gates or the production deployment.
