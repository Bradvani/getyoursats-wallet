# Same-wallet browser passkey protection

## Release disposition

Implementation and software acceptance candidate, based on integrated PR #69 / `1de19e0`. **Not a Gate 1 pass, independent security approval or authorization for real funds.** Production interlocks, unsupported payment-route restrictions and historical source-bound acceptance profiles remain unchanged.

## What this implements

An imported browser wallet retains its original v1 password-encrypted vault byte-for-byte. A new WebAuthn credential, scoped to the exact current hostname, supplies a PRF value. HKDF-SHA-256 derives an AES-GCM wrapping key with an explicit application domain and authenticated metadata. This wraps the existing vault encryption key, not a new mnemonic or seed. No wallet SDK connection, balance conversion, transfer, claim, migration transaction or relay access occurs in enrollment or vault authentication.

Enrollment requires the original password, the unlocked connected identity and offline-word acknowledgement. Registration alone saves no wallet linkage. A separate verification gesture validates the credential assertion, origin/challenge, relying-party hash, user-presence and user-verification flags, credential ID, public-key signature and PRF availability. Only then is the link saved under origin/vault coordination. Pending material is erased best-effort on cancellation, expiry, session change, backgrounding or unmount. JavaScript strings and memory are not claimed securely erasable.

Settings, cold startup, privacy-lock reopening and spending approval expose linked-passkey controls while retaining password fallback. Spending approval still goes through the exact existing request/session/deadline checks; the passkey does not create a separate bypass around the operation gateway. Local removal revokes the current session and deletes only the link, not the original vault or wallet.

Protection credentials contain a purpose marker in the WebAuthn user handle. The pinned browser SDK provider is wrapped at its assertion boundary so selecting a protection credential in ordinary wallet sign-in cannot derive a different wallet. This adapter depends on the exact installed SDK method and needs review with SDK upgrades. Native provider behavior is unchanged.

## Recovery file and limits

The JSON recovery file contains the original encrypted vault, authenticated link metadata and wrapped encryption key. It contains neither plaintext recovery words nor the wallet password. On a clean browser at the exact same origin, either the matching passkey or the original password decrypts the same vault. Original recovery words remain valid independently.

A synchronized passkey alone is NOT enough: the replacement device also needs the encrypted vault file. This design adds no cloud backup, email recovery or server escrow. The file is a **key-protection backup**, not a snapshot of SDK balances, history, payment journals or live settlement. Those require authoritative SDK/provider recovery and are not implied by the file restore test.

Import refuses an existing vault, legacy words, recovery marker, passkey mode, linked credential, connected signer or any existing IndexedDB databases. It checks again before committing. It never deletes or assigns an ambiguous legacy SDK database. The password vault is the commit point: a crash/quota failure before the final link write leaves a recoverable original encrypted vault, not a different wallet. A storage metadata check is not a fence against an older application tab that ignores current coordination.

Changing the password or recovering with words changes the original vault bytes and makes an older local link stale. Removing a link affects this browser only. It does not delete the credential from a password manager or revoke exported copies of an older file. No global credential revocation or compromised-origin protection is claimed.

## Migration and preservation acceptance covered in software

- Original encrypted vault is unchanged through enrollment, verification and passkey unlock; password fallback remains valid.
- No passkey-derived-wallet mode or wallet label is written by linking.
- Unrelated stored history/uncertain-operation fixture bytes are preserved, not rewritten.
- Wrong password, wrong credential/owner/origin/challenge, cross-origin data, missing user verification, bad signatures, changed PRF, missing PRF and unsupported PRF are rejected.
- Cancelled/stale/backgrounded authorization cannot activate a link or unlock the wallet.
- Concurrent enrollment cannot replace an existing completed link.
- Quota failure preserves the existing password vault; interrupted fresh restore remains password-recoverable.
- Wrong recovery words and a different mnemonic-passphrase identity cannot replace or attach to the wallet.
- Damaged or stale linkage does not delete the vault or disable password recovery.
- Encrypted-file recovery is refused over existing wallet/database records and on the wrong origin.
- Separate UI verification is required; cancellation/failure never displays an active link.

The software authenticator fixture uses actual Web Crypto signatures and PRF-shaped keys to test application validation. It is **not** a physical authenticator, Face ID, iCloud synchronization, browser-native WebAuthn or hardware-isolation certification. An attempted new automated browser-authenticator run was blocked by the execution safety control. It was not rerouted to CI and is not counted as a pass. Existing security/rollback browser suites are regression evidence, not new linked-passkey device acceptance.

## Isolated physical-device page

`acceptance/protection` builds separately using `vite.protection-acceptance.config.ts`. It exposes the actual candidate protection and restore components with newly generated disposable keys, no payment UI, no wallet SDK connection and a self-only connection policy. Its fingerprint is an explicit test identifier, not a Bitcoin address. It must be deployed as a preview on a separate hostname, never promoted to the wallet production alias.

Owner acceptance on iPhone 17 Pro / iOS 27.1: create a disposable password vault; privately save its test words; add/verify a protection passkey; compare fingerprint; cancel unlock and confirm it stays locked; background/relaunch; use password fallback; save the encrypted recovery file; recover on a clean second browser/device at the exact same test URL using the passkey or original password. Leave production PWA/passkeys/browser data untouched. Do not send test words, credentials or files into chat. Failure/cancellation must not change the original vault.

## Still required for full Gate 1

Physical iPhone/Android browser and installed-PWA acceptance; actual synced-provider recovery; full legacy SDK/IndexedDB ownership and old/new-tab migration; authoritative balance/history/pending-operation recovery across devices; required claim/Lightning/exit contract acceptance on the final package; original-origin rollout and compatible rollback; and independent review of this exact implementation and SDK. Existing external-operator preflight remains paused. No gate is closed merely by a green unit run.
