# Container-file compromise review, 11 November 2026

## Release decision

**Current production cannot be described as unaffected by this class of attack.**
The browser/PWA mnemonic flow in production persists recovery words in plaintext.
This review establishes application-level exposure. It does not establish that
the `worse_query` PoC has reached a particular Safari/PWA installation or that
any user's wallet has been compromised.

| Evidence | Verified state |
| --- | --- |
| Production domain | `wallet.getyoursats.com` |
| Production source | `7090e7cd11d8062ba25d8b6ca5d0e5aaded6f3a7` |
| Production deployment | `dpl_HV41RvHWFZdcgiKgeHF6jE9LVLvq`, READY |
| Integrated security candidate inspected | `28f2afce09ee3785ec208b19aa57f9673bcc6360`, draft PR #72 incorporating draft PR #71 |
| This increment | Additional defensive changes and software regression evidence; not production approval |

The existing production interlock and unsupported-route restrictions remain
unchanged. Automated success does not close the documented populated-wallet,
provider recovery, physical-device, rollout/rollback or independent-review gates.

## Threat and evidence boundaries

The [researcher's README](https://github.com/forcequitOS/worse_query) claims
container access on iOS 26.0 through 26.7.2 and iOS 27.2. It lists other
applications' data and shared containers. These are the author's claims, not an
Apple-confirmed version matrix. The README does not establish a Keychain,
Secure Enclave or arbitrary process-memory compromise.

[WebKit's storage documentation](https://webkit.org/blog/14403/updates-to-storage-policy/)
describes localStorage, IndexedDB, Cache API, service-worker and filesystem data
on devices, including Home Screen web apps. A PWA is therefore not inherently
outside a container-file threat. Whether this PoC reaches a specific profile and
its current iOS protection class still requires platform evidence.

The [Web Crypto security considerations](https://www.w3.org/TR/webcrypto/#security-considerations)
do not guarantee filesystem confidentiality for stored `CryptoKey` material.
`extractable: false` constrains API export; it does not certify hardware storage
or resistance to copying browser files. An encrypted secret and a usable
decryption key stored together are not adequate evidence of file-copy resistance.

[Apple's release page](https://support.apple.com/en-us/100100) listed iOS 27.2.1
and 26.7.3 dated 9 November at inspection. The inspected
[27.2.1 advisory](https://support.apple.com/en-us/149715) did not identify a
`worse_query` fix. This review makes neither a fixed nor still-exploitable claim
for those releases. No exploit was installed or executed.

## Production findings

1. **Plaintext recovery words.** At the production commit,
   `src/services/legacyMnemonicMigration.ts` exports `saveMnemonic`, which writes
   the phrase directly under `walletMnemonic`. `src/hooks/useBreezSdk.ts` calls
   it for browser non-passkey mnemonic wallets. The native secure-storage
   adapter does not encrypt this browser fallback.
2. **Passkey-created wallets use a different path.** The browser passkey flow
   avoids caching its PRF-derived seed and authenticates again on launch. This
   is a narrower positive finding, not certification of every SDK record or
   resistance to a modified browser/runtime.
3. **Unauthenticated routing metadata authorized destructive cleanup.** Startup
   treated a mutable passkey-mode flag as authority to delete legacy recovery
   words. Direct/pending passkey connections also had unconditional cleanup.
4. **Diagnostic redaction had format gaps.** Uppercase, title-case, mixed-case
   and comma-separated English recovery words could escape the existing
   free-form log scrubber. This is not evidence that actual user seeds were
   logged.
5. **SDK and log stores need a complete inventory.** Log encryption persists its
   CryptoKey in IndexedDB. SDK adapters store ordinary settings/tree records;
   diagnostic code acknowledges cached tokens, invoices and preimages. This
   review does not establish that each item grants spending authority, nor that
   all secret material has been removed from all browser artifacts.

The production source is immutable at
[this commit](https://github.com/Bradvani/getyoursats-wallet/tree/7090e7cd11d8062ba25d8b6ca5d0e5aaded6f3a7).
The restricted central operation gateway does not exist in that production
source. In any case, a gateway inside GYS cannot veto spending elsewhere using
a stolen recovery phrase.

## Changes in this increment

- Remove the unused plaintext-write export from the security candidate.
  Compatibility reads and verified same-wallet migration remain available.
- Give an existing browser vault or legacy phrase precedence over passkey-mode
  flags. Startup and retry select the original protection flow without deleting
  data or deriving a different passkey wallet.
- Reject browser passkey-wallet connections over existing protected/legacy
  records before SDK connection, after awaited work and before publication.
  Preserve records and disconnect a rejected pending client.
- Remove unconditional browser passkey cleanup. Changing routing metadata is
  not proof that another wallet's recovery data may be deleted.
- Keep native-only passkey send-policy fallback native. A browser vault unlock
  must not inherit an unrelated passkey policy from mutable mode flags.
- Harden English recovery-phrase redaction before diagnostic buffering/export.
  Preserve surrounding support context and avoid joining separate short runs
  across unrelated punctuation. Checksum validity is not required for redaction.
- Add copied-record and direct-tampering fixtures using actual Web Crypto and
  the existing software authenticator simulator.

The diagnostic-only patch is separately based on production in
[PR #92](https://github.com/Bradvani/getyoursats-wallet/pull/92) so it can be
reviewed without merging the unfinished wallet migration. It does not repair
production plaintext storage.

## Software verification

Local validation of this increment: **204 tests passed across 10 files**,
including the 14 copied-vault/tampering cases and 11 additional connection and
startup preservation cases. TypeScript `tsc --noEmit` and `git diff --check`
passed. Targeted ESLint reported no errors and one pre-existing `sdkRef`
dependency warning. The diagnostic-only production patch separately passed
54 logger/export tests and TypeScript checking. Final hosted CI and release
acceptance must be attributed to the exact integrated commit, not this count.

The focused suite covers browser/native recovery, connection authorization,
legacy preservation, encrypted vaults, linked passkeys, copied records and log
redaction/export. The new vault tests cover these threats:

| Attempt | Required result |
| --- | --- |
| Copy stored vault/link records into cleared, locked state | Wrong password and unrelated authenticator fail; the original unlock secret recovers the same phrase |
| Modify well-formed ciphertext, IV, salt or fingerprint | Authentication fails; supplied records are preserved |
| Modify wrapped key, PRF salt, IV or owner metadata | Passkey unlock fails; the intact original password vault remains recoverable |
| Recompute a public digest after ciphertext modification | Authenticated decryption still rejects the modified binding |
| Change mode/unlocked marker fields without storage events | No unlocked phrase or authorized replacement follows from those flags |
| Copy an encrypted recovery export | Authentication is required before any recovered records are written |
| Inspect persisted vault/link and export bytes | No plaintext phrase/password or captured raw vault key/PRF output in the checked encodings |

These fixtures do not read an actual iOS filesystem or prove full-browser
secret absence. IndexedDB enumeration is simulated. They do not establish
secure erasure, hardware isolation, global credential revocation or resistance
to offline guessing of a weak password. No real wallet, seed or funds were used.

## Requirements before making a production protection claim

1. Complete a same-wallet migration for populated legacy profiles. Preserve
   the original phrase and financial records until encrypted readback,
   identity, pending-operation recovery and compatible rollback are verified.
2. Inventory disposable secrets across localStorage, IndexedDB/SDK settings
   and tree stores, caches/service workers, logs, exports and native stores.
   Classify signing material, credentials, preimages and public records, then
   remove or separately protect every spending-relevant secret.
3. Verify the final build on physical iPhone Safari and installed PWA plus
   Android, including replacement-device recovery and old/new-tab updates.
   A copied full disposable profile must not yield usable signing material
   without an independently held unlock secret. Include file changes without
   browser storage events.
4. Retain transaction-bound authorization, background revocation and recovery
   checks. They complement storage confidentiality and are not substitutes for
   it. The current external signers remain software-backed.
5. Obtain a qualified independent review of the final application and modified
   SDK. Bind acceptance to the exact artifact that is promoted, then verify the
   production alias and original-origin PWA update/rollback.

Passkey linking is an alternative unlock method for the password vault, not
two-factor encryption. The original password can still decrypt copied
ciphertext. Password strength therefore remains material even with a linked
passkey.

Deleting a live plaintext entry cannot retract copies already made, and browser
APIs do not provide a reliable guarantee of erasing historical filesystem,
journal or backup copies. Routine migration must preserve the same wallet.
If compromise is suspected, incident recovery may require moving funds to a
new wallet created on a clean device, under the owner's control. Do not clear
site data or replace wallet identities automatically.
