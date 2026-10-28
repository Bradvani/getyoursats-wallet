# Browser recovery, rollout and rollback plan

## Decision and evidence boundary

This is an implementation handoff for continuation work based on
`9d6db8bb7171c7d76ec2a1fad4e539ef3b457356`, reviewed on 25 October 2026 UTC.
The removal and coordination sections have been updated against implementation
commit `ca661c4e154cdd5310d391c4d913b721f2f49169`. It is **not a production
approval**. The approved release commit, SDK artifact digest, deployment
identifier and compatible rollback artifact must be recorded before promotion;
none is claimed here. Earlier scoped test results below retain their original
checkpoint limitations.

The vault changes improve recovery under damaged records, storage quota failures
and concurrent enrollment. They do not prove restored balances, history,
settlement, complete signer isolation, or compatibility with every installed
browser/PWA. The tests below use disposable published fixtures and mocked SDK
responses. No existing user's wallet was migrated, no funded transaction was
performed, and no production deployment or rollback was exercised.

Production remains blocked until the integration and operational gates below
pass. Rollback to a plaintext-only or observer-only client is not acceptable.

## Storage contract that every release and rollback must preserve

| Data | Current format and handling |
| --- | --- |
| `walletMnemonic` | Legacy plaintext mnemonic. Remove only after decrypting and matching the persisted encrypted vault and successfully connecting the same wallet. Never recreate as a rollback mechanism. |
| `gys:wallet-vault:v1` | Version 1 AES-256-GCM record; PBKDF2-SHA256, 650,000 iterations, 16-byte salt, 12-byte IV, existing authenticated-data string. Enrollment verifies decrypted ciphertext before and after saving. |
| `gys:wallet-vault:recovery-fingerprint:v1` | Independent SHA-256 equality fingerprint of the normalized recovery phrase, encoded as canonical base64. This is an accidental-replacement check, not a secret, signature, or protection against a compromised origin. |
| `gys:wallet-vault:preserved-previous:v1:<digest>` | Exact previous vault bytes retained before password reset, including malformed bytes. The digest identifies the old vault/hint pair, so retries reuse the same preservation slot. |
| `gys:wallet-recovery:preserved-manifest:v1:<digest>` | JSON containing the exact old hint string or `null`, retained alongside the previous vault. |
| `gys:payment-journal:v1:<walletKey>:<operationId>` | Version 1 durable payment status record. `walletKey` binds network and SDK identity public key. Includes approved intent hash, amount/fee bounds, exact payment ID and state. Pending/unknown/submitting records must survive password changes, reconnects and deployment rollback. |
| `gys:wallet-operation-generation:v1` | Origin storage generation captured by the gateway. A missing or changed marker synchronously invalidates an existing connection before delayed storage events arrive. Preserve it on upgrades; it is not a cross-version tombstone protocol. |
| `recovery-plan:` and `unilateral-exit-pending:` prefixes | Any persisted entry prevents destructive removal, including damaged, empty or unarchived completed-plan records. Preserve until a separately verified recovery/archive procedure is available. |
| SDK IndexedDB, passkey metadata and other wallet state | Preserve through encryption enrollment, password reset, app locking and ordinary upgrades. A wallet-data wipe is a different, destructive operation. |

Vault recovery must not generate a mnemonic, replace a passkey-derived wallet,
alter seed derivation or discard SDK storage. Existing phrase handling is
preserved. The vault service is not a new BIP39 compatibility validator; the
recovery UI currently accepts 12 or 24 words. Additional supported historical
phrase forms must be demonstrated with identity tests before changing that
policy. Never normalize or "repair" a legacy phrase in a way that derives a
different wallet.

The retained previous vault may still decrypt with the **old password**.
Changing the current vault password does not revoke an old password's access to
preserved ciphertext or an external copy. Automatic preservation cleanup is not
implemented. Define a user-visible retention/cleanup policy only after recovery
and new-password verification; do not silently delete the sole recovery copy.
Do not claim password reset alone resolves a previously stolen mnemonic.

## Non-destructive migration procedure

The current implementation is in `src/security/webWalletVault.ts`, with entry
points in `src/App.tsx`.

1. Identify whether the browser holds a legacy mnemonic, an existing v1 vault,
   or a passkey wallet. Do not choose a new wallet when an existing record is
   unreadable. Do not export recovery words into logs, screenshots, diagnostics
   or support tickets.
2. Before enabling enrollment for a production cohort, require compatible
   Web Crypto, persistent storage and Web Locks in a secure context. The vault
   refuses unsafe lockless mutation. Validate the actual supported-browser
   matrix; storage denial, private mode, eviction and quota exhaustion are
   distinct failure cases, not permission to fall back to plaintext.
3. Obtain the password and preserve the exact legacy seed identity. Enrollment
   acquires `getyoursats-vault-mutation-v1`, checks the session epoch and any
   connected signer identity, and refuses an existing different wallet.
4. Derive the encryption key, encrypt with fresh salt/IV, and decrypt the
   candidate in memory to verify equality. Recheck the session and storage.
5. Save the independent fingerprint, then the vault record. A successful
   `localStorage.setItem` is atomic for that individual key; this is **not a
   multi-key database transaction**. Synchronous commit failure attempts to
   restore only the hint written by this operation. A process interruption can
   leave a hint without a vault; it must not delete the legacy mnemonic.
6. Read back and decrypt the stored vault and verify identity again. Connect the
   same mnemonic through the restricted browser SDK path. The app's enrollment
   sequence leaves the legacy phrase intact if connection fails.
7. `removeMatchingLegacyMnemonic` decrypts the saved vault, compares it with the
   current legacy phrase, rechecks session/storage, and only then removes that
   matching plaintext key. This deletion is not inside the vault Web Lock;
   conflicting old clients or noncooperating code are outside the current
   serialization guarantee and require the rollout controls below.
8. Cold-start the disposable migrated wallet and verify the same SDK identity,
   network and expected persisted history. A successful phrase equality test
   alone does not prove restored balance or remote historical data.

On any failure, preserve existing vault, legacy seed, journal and SDK database.
Show a recoverable error and permit a deliberate retry after the storage issue
is addressed. Do not advise clearing site data. If encryption committed but
subsequent connection/readback failed, retry the existing vault unlock path;
do not enroll a replacement wallet or restore old plaintext automatically.

## Forgotten-password and damaged-vault recovery

`resetWebWalletPasswordWithWords` acquires the same vault mutation lock and uses
the following evidence hierarchy:

| State | Safe behavior implemented |
| --- | --- |
| Valid hint and valid matching record fingerprint | Compare the original recovery words to that identity, then replace encryption only. |
| Damaged ciphertext/metadata or empty vault string, valid independent hint | Verify the recovery words against the surviving hint; preserve damaged bytes before replacement. |
| Malformed hint, valid fingerprint retained in record | Use the record fingerprint, preserve both original records, then repair encryption and hint. |
| Two valid but conflicting fingerprints | Refuse recovery in place; preserve both records unchanged. |
| No usable fingerprint in either record | Refuse identity replacement in this profile. Offer the separate-device/profile procedure below. |
| Incorrect recovery words, changed session or storage race | Abort; do not overwrite the current wallet. |

For a verified identity, the service encrypts and decrypts the replacement in
memory, rechecks both source records, saves exact previous vault and hint bytes,
then commits the new hint/vault pair. Failure to save preservation data aborts
before either live record is replaced. A failure during live commit preserves
the old vault when the new per-key write has not completed and attempts hint
rollback. Readback verifies the new password before making the phrase active.
Repeated failed attempts for unchanged source data reuse preservation slots.

The recovery UI blocks duplicate submissions and clears entered words/passwords
when backgrounded, on page hide, on Back and after success. Session epoch
invalidation prevents a pending recovery from completing as an active session
after locking. JavaScript strings are not reliably zeroizable; clearing UI and
references is not a hardware memory-erasure guarantee.

After successful local recovery, reconnect using the original phrase, retain
the payment journal and SDK database, and check the same identity and payment
status. SDK connection failure after a valid new vault commit must leave that
vault available for the next unlock. Password reset must not unblock uncertain
payments or restart an unconfirmed payment.

### When local identity evidence is lost

The UI provides a safe continuation, not an unverifiable in-place reset:

1. Keep the original browser profile, site data, damaged records and SDK
   database. Do not reset the app or remove the original wallet.
2. On a trusted second device or separate browser profile, open
   `https://wallet.getyoursats.com` and restore the original recovery words using
   its supported restore journey. A separate profile is needed; another tab
   shares the damaged origin storage.
3. Verify wallet identity and network against independent known information;
   inspect recovered balances and history. Do not treat an empty newly
   connected wallet or successful word import as proof that it is the original.
4. Review any outstanding transaction from the old profile before spending.
   Its local operation journal does not automatically synchronize to another
   profile or device. Missing local history is not proof of non-payment.
5. Change or remove the original browser's data only after recovery and pending
   transaction outcomes are verified. Never share recovery words with support.

This route is currently guidance, not an independently verified cross-device
recovery test or a programmatic reconciliation protocol. If both local identity
evidence and the original recovery words are unavailable, this implementation
cannot safely establish wallet identity or restore the secret.

## Locking, cross-tab coordination and wallet removal

Ordinary app/background lock clears active mnemonic references and invalidates
approval/session state. The browser SDK lifetime controller revokes callable
references and attempts SDK disconnect/free and signer disposal. Locking must
preserve durable wallet records. This does not establish that a payment already
submitted was reversed, nor prove that every internal SDK clone was zeroized.

Enrollment/recovery and spending use different locks:

| Operation | Coordination implemented |
| --- | --- |
| Vault enrollment/password reset | Exclusive `getyoursats-vault-mutation-v1`, with session and record rechecks. |
| Payment/reconciliation | Exclusive `gys:origin-wallet-operations:v1` followed by `gys:wallet-spend:<walletKey>`, both using Web Locks `ifAvailable`; cooperating clients on different wallets/networks also reject competing work. |
| Connected browser-wallet removal | `withWalletRemovalLock` checks the current session and every journal record on the origin, refuses unresolved or malformed records, and holds the same origin-then-wallet locks throughout the removal callback. |

At `ca661c4`, browser removal with a null SDK is rejected without deleting wallet
data. The removal callback also calls
`src/features/unilateral-exit/removalProtection.ts` before destructive work: any
persisted `recovery-plan:` or `unilateral-exit-pending:` key blocks removal,
including entries a tolerant parser might treat as absent. This check covers all
wallets/networks on the origin, not just the connected wallet. Recovery readiness
and the safe resolution/archive of these records still need acceptance evidence.

The callback clears wallet data including localStorage/IndexedDB; it is not a
logout, locking, encryption migration, or deployment rollback mechanism.
Candidate gateways synchronously compare their captured storage generation with
`gys:wallet-operation-generation:v1`, rejecting an existing stale connection
after a wipe even before its tab receives a storage event. This closes the
candidate-to-candidate delayed-event window; it does not retrofit older cached
clients or already-running legacy signers. There is still no durable
cross-version removal tombstone. The vault mutation lock and origin/spend locks
also do not serialize all removal/migration combinations. Cover these remaining
interleavings with actual browser tests and keep destructive removal restricted
until the protocol is complete. Never use a storage wipe to resolve a stuck
uncertain-payment record.

## Uncertain payments and rollback compatibility

The new v1 journal is durable before SDK execution. A matching payment identity,
route, amount and fee ceiling are required to accept a returned status.
`submitting`, `unknown` and `pending` block further spending. The SDK's `failed`
status remains `unknown` because its semantics do not alone prove safe repayment.
The journal parser also fails closed on malformed data.

At this source snapshot, reconciliation calls `getPayment` for the exact stored
payment ID and deliberately excludes `syncWallet`, which can resume
value-moving work. Therefore local absence or an unavailable result does not
clear the block. An independent settlement/return evidence route, including
recovery from damaged journal records, remains required. An indefinite block is
safer than duplicate spending but is not a finished production recovery journey.

A rollback build must read **and enforce** these journal semantics. Merely being
able to decrypt v1 vaults is insufficient. Preserve unresolved records and SDK
storage across all recovery and rollback paths. Never clear records, label
missing payments failed, reset a device, or resubmit automatically to make the
wallet appear usable. Cross-device journal portability and authoritative remote
reconciliation remain unverified.

## Deployment and rollback procedure

### Before any production cohort

1. Freeze and record the complete release SHA, lockfile, vendored SDK archive
   digest/source patch, built assets and configuration. Rerun final combined
   checks against that exact state. Review supported routes, external signer
   construction, lifecycle cleanup and any SDK background operations together.
2. Build a **vault-and-journal-aware rollback artifact** from reviewed source.
   Pin its SHA and immutable deployment identifier. It must unlock v1 records,
   preserve recovery backups, enforce journal blocks, fail closed on unsupported
   schemas and provide the same safe recovery guidance. Demonstrate this
   artifact against disposable pre-migration, post-migration and password-reset
   profiles. Such an artifact has not been supplied or validated by this work.
3. Implement and verify rollout controls that can stop new enrollment and
   value-moving operations while retaining unlock/recovery/status access.
   Confirm controls fail safely offline. A remote flag cannot revoke already
   running legacy code or a cached signer; do not claim otherwise.
4. Test stale tabs, installed PWAs and offline restart across release versions.
   `public/sw.js` currently uses `skipWaiting`/`clients.claim`, network-first
   navigation and cache-first hashed assets. An updated service worker does not
   replace JavaScript already executing in an open tab. Require a safe version
   transition before migration; never force a reload during uncertain payment
   execution and never clear wallet stores as part of cache refresh.
5. Verify recovery using disposable wallets on real supported iOS/Android and
   desktop browsers, including backgrounding, process termination, quota/denial,
   multiple tabs, failed reconnect, incompatible old clients and 12/24-word
   existing wallets. Verify passkey compatibility separately without deriving a
   replacement wallet. Physical biometric/passkey tests are still outstanding.
6. Obtain independent review of the final integrated commit. Any required
   small-value settlement tests need explicit approval and disposable funded
   wallets; none has been run here. Record recipient, network, expected cost,
   actual settlement and identity/history recovery without recording secrets.

### Controlled release after approval

Start with a narrowly scoped cohort and compatible browser versions. Validate
unlock, same-wallet migration, reconnect, payment-status preservation and
password recovery before expansion. Monitor non-sensitive failure categories
(enrollment/readback, storage, lock/lifecycle, journal parsing, unresolved state)
and preserve diagnostic provenance without phrases, passwords or full invoices.
Pause rollout on unexplained identity changes, storage replacement, premature
journal clearance, duplicate execution or recovery dead ends.

### Incident rollback

1. Stop new value-moving work and new vault migrations with verified controls;
   retain access to recovery and conservative status checking. Do not race a
   deployment switch with an in-flight payment or erase its journal.
2. Classify profiles as legacy-only, vault plus legacy, vault-only,
   password-reset/preserved-records, or unresolved-payment. All must be supported
   by the selected rollback artifact. Do not collect users' storage contents.
3. Promote only the prevalidated vault-and-journal-aware artifact, preserving
   origin, wallet/SDK storage, passkey assumptions and schema compatibility.
   Verify a cold restart and PWA update on disposable copies for every class.
4. Preserve the current vault and historical encrypted records. Do not copy
   previous bytes over the current vault automatically: they may use an old
   password, be malformed or conflict with newer state. Targeted restoration
   requires verified same-wallet identity, exclusive mutation and preservation
   of the current record before any change.
5. Reconcile unresolved payments using the same conservative evidence policy;
   rollback does not make an uncertain payment safe to repeat.
6. If no compatible rollback artifact exists, use a reviewed forward fix or
   preserve state in a restricted recovery mode. Do not redeploy an old
   plaintext/observer-only build or instruct users to clear storage.

## Verification actually performed

Commands ran in the integration worktree on the baseline above plus uncommitted
changes. These results are scoped to the recovery work at its test checkpoint;
they are not results for a final release commit.

| Command | Observed result |
| --- | --- |
| `npx vitest run src/security/webWalletVault.test.ts src/security/WebVaultRecoveryPage.test.tsx` | 23/23 tests passed in 2 files; 20 vault and 3 recovery-UI tests; 15.88 seconds. |
| `npx eslint src/security/webWalletVault.ts src/security/webWalletVault.test.ts src/security/WebVaultRecoveryPage.tsx src/security/WebVaultRecoveryPage.test.tsx` | Exit 0. |
| `npx tsc --noEmit` | Exit 0 at the integration checkpoint; final combined rerun still required after other agents' edits. |
| `npx playwright test e2e/tests/browser-vault-security.spec.ts e2e/tests/browser-vault-concurrency.spec.ts --config=.vault-playwright.config.ts --reporter=line` | 4/4 tests passed in Chromium, 16.3 seconds. |

The temporary `.vault-playwright.config.ts` inherited `playwright.config.ts` and
used executable `/tmp/gys-chromium/chromium` with `--no-sandbox`,
`--disable-dev-shm-usage`, `--disable-gpu`, `--no-zygote`,
`LD_LIBRARY_PATH=/tmp/gys-chromium` and
`FONTCONFIG_PATH=/tmp/gys-chromium/fonts`. It has been removed. Reproduce on a
standard Playwright installation using the repository config and the same two
spec paths. The specs disable trace, video and screenshots, and use disposable
test phrases only.

Actual Chromium tests demonstrate real Web Locks holding a second tab and
exactly one winner in simultaneous first-time enrollment, plus legacy
encryption/cold-start/password-reset and denied approval fixture behavior.
The browser run preceded the final deterministic preservation-slot and
empty-record recovery refinements; the final 23-test unit run includes those
refinements. Rerun the browser tests on the final integrated SHA.

Unit fault injection covers quota failure while preserving old records, hint
rollback, retry slot reuse, malformed/conflicting fingerprints, empty damaged
records, loss of both identity sources, duplicate recovery submissions and
background field clearing. Mocked storage/SDK tests do not prove multi-key crash
atomicity, OS memory cleanup or settlement.

## Remaining release blockers and ownership handoff

| Priority | Required outcome | Acceptance evidence |
| --- | --- | --- |
| P0 | Complete audited signer/gateway lifecycle and operation inventory, including SDK internal/background work and deliberately unavailable routes. | No value-moving callback bypasses exact-intent authorization; revoked sessions cannot sign; quote changes and duplicates fail closed. Any unavailable refund/exit route has an honest, usable recovery procedure rather than an indefinite unsupported screen. |
| P0 | Close the remaining vault-mutation/removal and older-client races; independently verify the implemented removal guards. | Browser tests confirm SDK-null removal preserves data, all-origin journal/exit records block removal, origin-then-wallet locks serialize candidate spending/removal, and generation checks reject stale candidate connections before storage events. Also demonstrate removal cannot overlap vault mutation and older clients cannot resurrect removed state or execute after removal. |
| P0 | Provide durable, safe resolution of unknown/pending/malformed payment journal states. | Matching authoritative settlement/return evidence; no blind retry, no automatic clearing and no outcome inferred from local absence. Cross-device recovery procedure tested. |
| P0 | Produce and test the vault-and-journal-aware rollback artifact and rollout controls. | Immutable rollback SHA/artifact, schema compatibility matrix and actual disposable-profile rollback rehearsal, including post-password-reset and unresolved-payment states. |
| P0 | Verify original wallet preservation and supported-device recovery. | Same derived identity/network, expected balance and history after cold start and restore; real browser/PWA process/background tests and separately approved small-value settlement checks where necessary. |
| P0 | Independently review and test the exact final integrated commit/SDK artifact. | Recorded commit/digests, final unit/build/browser results and independent disposition of unresolved findings. Passing counts alone are not certification. |
| P1 | Specify preserved-ciphertext retention and supported phrase/browser policies. | Explain old-password access, user-approved cleanup after verified recovery, supported recovery forms and fail-closed unsupported-browser behavior. |
| P1 | Finish operational and localized recovery support. | Sensitive instructions reviewed in supported languages; support can diagnose non-secret failure references without requesting recovery phrases or telling users to wipe data. |

Recommendation: continue implementation and isolated validation. Do not broaden
real-funds availability or promote this continuation until the P0 outcomes are
demonstrated and the release decision is updated against the final commit.
