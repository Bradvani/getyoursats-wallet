# GetYourSats Wallet Security Assessment

Independent technical decision and implementation handoff for PR 35

Prepared for Bharat and the GetYourSats development team on 25 October 2026 by Codex in ChatGPT Work.

## 1 Executive decision

**NO-GO for PR 35 at ada1069.** The candidate is not suitable for production in its present form. The browser vault is a reasonable starting point for protecting a stored mnemonic, but the implementation does not establish complete transaction authorization or sufficiently safe migration and recovery. Six High, three Medium and one Low finding are recorded below. No Critical vulnerability or remote theft exploit was demonstrated. The six High findings are release blockers for the proposed protection claims; some concern availability and wallet preservation rather than unauthorized spending.

**The SDK payment observer must not be the primary or sole spending-security mechanism.** At the inspected SDK revision it governs selected outgoing transfer paths, omits important recovery/refund and delegated-spending operations, and receives insufficient information to approve the exact economic intent. Token transfers can already be signed when the callback runs. A rejected callback can stop the covered broadcast path, but that is not cryptographically enforced signing authorization.

The defensible near-term design is an encrypted browser vault plus a central, fail-closed application operation policy, complete intent review, session invalidation and explicitly limited capabilities. Keep the observer as an additional consistency check. This remains protection against stored-secret disclosure and unauthorized use of the legitimate interface. It cannot protect an unlocked wallet from compromised same-origin code. If protection from a compromised frontend is required, a separately trusted signer with independent transaction validation is a prerequisite, not a later UI enhancement.

The original 812 tests passed. The expanded suite passed 829 tests, including 17 independent tests. Several new tests intentionally assert defective behavior to document reproductions. Their success is not security acceptance. Actual installed WASM signer derivation confirmed preservation of one disposable wallet identity through vault enrollment, unlock and password reset. No funded transaction, production change or actual-user secret was used.

## 2 Scope and evidence

Application baseline: `ada10691540d0e1492cd26a4466e00adab33e360`. Local isolated review branch: `audit/pr35-independent-20261025` (not published). PR 35 remains unmerged by this review. Changes are review documentation and tests only; application implementation is unchanged.

The application vendors SDK package version `0.1.0`; the version number alone is insufficient provenance. `vendor/SOURCE_COMMIT` identifies upstream Breez Spark revision `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4`. That exact source was inspected. Its correspondence to the bundled WASM was not established by a reproducible build, so source-traced behavior must still be verified against the shipped binary.

Package archive SHA256: `4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026`.

Installed web WASM SHA256: `4fc7fb24e6244c7b94a6f869425537eaf47fe9ee721d31f273b58495d1554b25`.

Evidence labels in this report: **Test** means independently executed local test; **Source** means inspected application or exact declared SDK source; **Outstanding** means not independently verified. Local tests used public disposable BIP39 fixtures, WebCrypto, mocked UI/session events and offline calls to the installed WASM signer factory. They did not connect a real wallet to Spark or demonstrate settlement. No native plugin implementation, physical-device authentication, fresh browser IndexedDB capture, regtest settlement or cross-device funds restoration was verified.

## 3 Security findings

### H1 High Incomplete spending coverage

**Source.** `connectSdk` attaches the observer only for browser mnemonic seeds when a vault record exists [A1]. Native, passkey-only and entropy connections do not receive it. The native/passkey branches inside the approval dialog do not prove those connections are protected. Passkey migration creates a separate SDK connection and sends assets directly [A8].

The existing refund screen calls `refundDeposit` directly [A7]; SDK static-deposit refund signing and broadcasting do not call this observer [S4]. Existing unilateral exit flows call `recoverFunds`, create CPFP signatures and later broadcast through the chain client [A9, S5]. The SDK also exposes allowance grants and pulls outside the observer [S6]. These latter operations are not currently exposed as regular wallet UI features, but a raw SDK object remains available through WalletContext [A10].

Impact: an application path can move funds or establish spending authority without the new approval ceremony. This is a coverage defect, not evidence that an unauthenticated remote attacker can invoke an app method. Required correction: restrict every value-moving capability behind an operation gateway, including refund, exit signing, broadcast, allowance creation and wallet-to-wallet migration. Deny unsupported methods by default. Acceptance: instrument actual signing and broadcast boundaries; denial, failure, lock and timeout must prevent every applicable irreversible operation.

### H2 High Approval does not bind the complete transaction

**Source and Test.** The SDK payload contains payment ID, amount and a rail-specific destination [S1]. It does not carry a complete final recipient, network, fee budget, quote expiry and cross-chain output. The dialog hides token identifiers, uses raw token base units and truncates long destinations without an expansion control [A3]. Its instruction to review a preceding screen is not a binding between that screen and execution.

The pending request retains the caller's mutable payment array [A2]. An independent test changes its amount and destination after requesting approval and observes the changed request. This establishes missing immutability, not a demonstrated external attacker exploiting an SDK callback. Cross-chain callbacks describe the provider funding leg rather than the final external-chain outcome [S7]. Token signing precedes the observer inside `broadcast_token_transfer` [S3].

Required correction: canonical immutable intent with connected wallet identity, operation, final recipient, input/output assets and networks, exact amounts or explicit bounds, all fees, provider, slippage, refund destination, quote ID and expiry. Authorize a digest of that intent with a single-use operation nonce and session epoch. Revalidate immediately before execution; any material change requires renewed review. Reject callbacks that cannot be matched to the approved intent. Do not label an observer veto as prevention of all signing.

### H3 High Privacy lock leaves spending capability active and retains approval passwords

**Test and Source.** Backgrounding cancels a pending approval and sets React `locked`, but retains the active plaintext mnemonic, SDK signer and expected fingerprint [A4]. Once foregrounded, a new observer request is accepted while the privacy screen remains locked. This can be relevant to background SDK conversions as well as application calls. The lock comment accurately describes a privacy screen; it must not be treated as a locked signer.

The always-mounted approval dialog returns null when no request is pending without clearing its password state [A3]. Reproduction: open approval, type the password, trigger external cancellation, open another request, click Authorize. The old password remains and authorizes the next request without re-entry. The test reproduces this component behavior; it does not demonstrate a separate user reaching every UI path behind the lock.

Required correction: clear credentials and errors on every request change, cancellation, timeout, lock and unmount. Maintain one session state shared by UI and operation policy; reject requests while locked. Invalidate all capabilities when hidden and recheck after asynchronous authentication. Dispose of the signer and clear application mnemonic references if promising a key lock. JavaScript string erasure cannot guarantee memory zeroization. If incoming synchronization requires a signer, separate its narrowly permitted operations or disclose a privacy-only lock. Acceptance: a stale password and a stale async response cannot authorize a new request after backgrounding.

### H4 High Password authentication can validate a vault different from the connected signer

**Test and Source.** `checkWebWalletPassword` compares the decrypted record with global `activeMnemonic`, not the connected signer's identity [A5]. `unlockWebWallet` assigns that variable before the session hook checks identity [A4]. Independent tests establish that a mismatched unlock throws but leaves the mismatched mnemonic active; its password subsequently passes the payment password check while the remembered signer still differs.

Prerequisite: inconsistent vault/session state, for example a conflicting tab, recovery flow or storage replacement. This is not a claim that a wrong password decrypts another user's vault. Required correction: decrypt into temporary data, validate against a stable connected public identity and session generation, then commit unlocked state. Failure must clear temporary and active authorization state. Recheck identity during payment authentication. Acceptance: mismatched vault, passphrase, account, network context or stale session never authorizes the connected signer; no failed unlock mutates active identity.

### H5 High Concurrent enrollment can replace a different wallet vault

**Test and Source.** `enrollWebWallet` checks for an existing record before asynchronous key derivation and encryption [A5]. Two concurrent calls with different valid disposable phrases can both pass the absence check, write and resolve. The durable value is whichever write wins. The no-overwrite invariant does not hold.

The reproduction uses concurrent module calls, proving a storage-layer race; two-tab browser execution remains an acceptance test. Impact: a user's only locally stored wallet can be displaced, with recovery dependent on an external phrase backup. Required correction: serialized transactional storage and an atomic identity/version precondition. Coordinate tabs and recheck before commit; a simple second localStorage read is insufficient atomicity. Retain a recovery journal until commitment is verified. Acceptance: racing enrollment/reset/migration in two tabs yields one deterministic winner, preserves the losing record or aborts before mutation, and never silently changes identity.

### H6 High Damaged vault metadata blocks the normal recovery path

**Test and Source.** Forgotten-password restoration first parses and validates the existing record and requires its fingerprint [A5]. A structurally damaged record prevents restoration even with the correct original words. Startup treats any vault presence as a locked wallet [A6], so normal onboarding restore is not an independent escape route. The test corrupts the JSON, supplies the original phrase and verifies rejection without deletion. Ciphertext-only corruption with valid metadata is a different case and can be replaced using matching recovery words.

This is an in-app recovery/availability failure, not proof that the phrase can no longer recover the wallet on a fresh compatible installation. Candidate migration also lacks a version-aware rollback contract with older application bundles. Required correction: non-destructive repair mode that preserves the original encrypted record and exit data, independently derives and displays wallet identity from recovery words, and resolves identity conflicts explicitly. Never require clearing all site data to recover. Ship a compatible rollback reader before migration. Acceptance: damaged JSON, bad fingerprint, unsupported schema, quota failure and interrupted write can all reach a safe recovery route without silently replacing a funded identity.

### M1 Medium Timer deadlines and duplicate operation lifecycle are incomplete

**Test and Source.** A normal 90-second timeout rejects approval and late completion cannot revive that request. However, `finishSpendingApproval` checks only the request ID [A2]. Advancing wall-clock time beyond the deadline without running a delayed timer still permits completion. There is no finish-time quote or session validation. SDK cross-chain expiry checks occur before the downstream observer wait [S7]. A quote can therefore expire during approval; whether the provider rejects it later was not tested.

The same payment ID can be approved in another request after completion. This requires another approval and is not itself an authentication bypass. The send hook already has a repeated-click guard; some SDK paths also have their own idempotence. The missing guarantee is end-to-end operation consumption across components, retries and tabs. Add monotonic deadlines, quote revalidation, atomic consumption and persistent pending/unknown reconciliation. An uncertain response must lead to status lookup rather than automatic repayment.

### M2 Medium Automatic conversions conflict with interactive approval

**Source; runtime behavior outstanding.** Configured stable-balance conversions can execute outside a user send screen [A1, S8]. Their inner Spark/token transfer can invoke the observer without a preceding final-intent review. Hidden-tab rejection, a 90-second timeout or an existing pending request can interrupt them. Signer identity is registered after `build()` returns, creating an additional initialization-order risk if a worker runs earlier [A6].

Disable automatic value movement for the transitional release unless it has an explicit bounded mandate with asset, amount, fee, duration and revocation rules. Do not auto-approve an observer callback to repair background reliability. Verify startup, incoming payments, conversion deactivation and recovery after interruption. DCA UI readiness is not evidence of an implemented safe automation policy.

### M3 Medium Stored-data and runtime threat boundaries are incomplete

**Source; forensic verification outstanding.** AES-256-GCM uses fresh 16-byte salt, 12-byte IV and PBKDF2-SHA256 with 650,000 iterations [A5]. No primitive-level break was identified. Password entropy still determines resistance to offline guessing. A bare phrase fingerprint adds an offline phrase-verification oracle, but a properly generated BIP39 phrase remains high entropy. Authentication metadata and recovery manifests need explicit versioning and integrity treatment.

The active mnemonic remains in JavaScript, and the exit funding helper reads it and derives another signing key [A9]. Native secure storage returns seed data across the bridge to JavaScript [A11]. Neither is hardware-isolated transaction signing. Source inspection found no default browser persistence of the master mnemonic in SDK storage. The default browser session store is in-memory, not a plaintext IndexedDB session-token store [S9]. Tree records contain signed transactions and public signing-keyshare data, not an evidenced private root [S10]. Boltz swap secrets have their own encrypted representation [S11]. The exit-state AES key is stored in the same IndexedDB database as its encrypted recovery data; this is not a password-authentication boundary [A9]. Payment metadata, exit state, origin backups and extension access still require a data inventory and fresh runtime capture. Do not assert absence of all secondary secrets from source search alone.

### L1 Low Security prompts need accessibility and localization completion

**Source.** Approval text is hardcoded English, long destinations cannot be fully reviewed, and the modal lacks an evident focus-trap implementation [A3]. Financial and recovery wording should be localized and tested with keyboard and screen-reader users. Preserve cancellation and clear progress during expensive authentication. Complete destination and asset display is already a High requirement under H2; this finding covers the remaining usability controls.

## 4 Authorization coverage matrix

Status C means a conditional observer hook was traced for browser mnemonic vault connections only. It does not mean complete intent authorization or independent settlement verification. U means the observer does not govern the relevant path. V means security behavior remains unverified. R means receiving, preparation or administration rather than a direct outgoing transfer. No rail received a live settlement pass in this review.

| Method or operation | Current application exposure | Status and evidence |
| --- | --- | --- |
| sendPayment with Lightning invoice | Send dialog and hook | C. Lightning before-send adapter; amount/invoice, incomplete fees. S1, S2 |
| sendPayment with Spark address or invoice | Send | C. Transfer service callback. Full request binding absent. S2 |
| sendPayment with Bitcoin withdrawal | Send | C. Cooperative exit adapter; observer amount can be leaves sum, not final payout plus disclosed fees. S2 |
| sendPayment with Spark token | Send | C. Token callback before broadcast, after token digest signing. S3 |
| lnurlPay and Lightning-address payment | Send/contact resolution | C for downstream Lightning or Spark transfer. LNURL recipient intent and fees not fully bound. S12 |
| Cross-chain outgoing sendPayment | Cross-chain workflow | C for provider funding transfer only. Final external recipient, chain, quote and output not in observer. S7 |
| Conversion requested during payment | Send/conversion features | C for inner transfer; full swap economics absent. S8 |
| Stable-balance automatic conversion | Configured SDK workers | C for inner transfer; no complete interactive or bounded automatic authorization policy. S8 |
| sendBatch | SDK surface, not regular UI | C for supported token batch transfer. Each output needs full review; sats batch unsupported at this source revision. S3, S13 |
| refundDeposit | GetRefundPage | U. Static-deposit signing and broadcast bypass observer. A7, S4 |
| claimDeposit including fee-bearing claims | Unclaimed deposit screens | U/R. Receiving/reorganization can incur fees; needs distinct explicit fee policy. A7, S4 |
| recoverFunds and CPFP signing | Unilateral exit/recovery | U. Builds/signs recovery transactions without payment observer. A9, S5 |
| Chain broadcast and broadcastPackage | Exit driver and resume | U. Separate chain client publishes signed transactions. A9 |
| Passkey RP migration sendPayment | Migration service | U in this connection. Direct connect omits observer and transfers assets to another wallet. A8 |
| Native and passkey-only regular sends | Supported app connection modes | U for PR35 observer wiring; existing unlock is not per-transaction proof. A1, A11 |
| createTokenAllowance | SDK surface, no regular UI | U. Signs persistent spending authority. Requires explicit grant policy. S6 |
| pullPayment and publishSignedPullPackage | SDK surface, no regular UI | U. Allowance pull broadcast outside normal observer. Payer authorized via grant, not fresh approval per pull. S6, S14 |
| revokeTokenAllowance | SDK surface | U/R. Security-sensitive revocation; must remain safely available. S6 |
| buildUnsignedTransferPackage, buildUnsignedBatchPackage, buildUnsignedLnurlPayPackage, buildUnsignedPullPackage | SDK surface | R for building only. Final signing and publishing require their own policy. S14 |
| publishSignedTransferPackage and publishSignedLnurlPayPackage | SDK surface | V for complete coverage. Standard token publishing reaches the token broadcast callback, but signing has already happened externally. Validate every package variant separately. S3, S14 |
| TokenIssuer createIssuerToken, mintIssuerToken, freezeIssuerToken, unfreezeIssuerToken | SDK surface, no current UI | U. Issuer authority operations outside transfer observer. Deny unless explicitly implemented. S15 |
| TokenIssuer burnIssuerToken | SDK surface, no current UI | C. Burn routes through token transfer to burn key. Irreversibility needs explicit intent. S15 |
| refundPendingConversions and provider clawbacks | SDK recovery surface | V. Delegates conversion recovery to provider paths; no complete authorization guarantee established. Restrict to validated self-recovery. S8 |
| optimizeLeaves and internal maintenance | SDK surface | V. Tree restructuring/possible costs need a bounded maintenance policy; not a user recipient payment. S16 |
| receivePayment, lnurlWithdraw and claimHtlcPayment | Receiving features | R. Not ordinary outgoing sends; inspect fees and any automatic conversion separately. S12, S16 |
| bridgeToCashApp, bridgeFromCashApp, buyBitcoin | Partner request preparation | R/V. Bridge-to creates an externally funded deposit request at this revision, not an automatic wallet debit. Provider execution unverified. S16 |
| lnurlAuth, signMessage, Lightning-address transfer authorization, webhook/settings changes | SDK and selected UI | R. Non-payment signatures/authority changes require separate scoped policies. Never allow arbitrary signing because it is not named sendPayment. S16 |
| export/importUnilateralExitState and recovery backups | Exit tools | R. Sensitive recovery artifacts; authenticate export/import and preserve compatibility. A9 |

## 5 Wallet preservation and storage conclusions

**Established locally:** real installed WASM `defaultExternalSigners` derives the same Spark identity public key from a disposable phrase before encryption, after unlock and after password reset. Another phrase differs. An added BIP39 passphrase changes identity. Mainnet and regtest returned the same identity public key in this test, so public-key equality alone does not verify network correctness. The test used account zero and does not establish all derivation paths or account compatibility.

**Good source properties:** the vault encrypts the same supplied phrase instead of deriving a replacement wallet from the password. Legacy deletion checks that decrypted and legacy phrases match. Setup waits for connection and identity checking before deleting matching plaintext. The SDK storage namespace depends on network and identity; keeping both consistent should reuse existing storage [A5, A6, S9].

**Not established:** recovered balances, full historical transactions, static deposit addresses, token ownership, pending swaps, exit artifacts or recovery on a second physical device. Their availability depends on more than the phrase: supported derivation, network/account context, SDK state, provider state and recovery backups can matter. No successful build or public-key comparison proves these outcomes.

Imported mnemonic vault enrollment currently stores only the phrase. Treat optional BIP39 passphrases and unsupported mnemonic formats as explicit compatibility cases; do not silently strip them. Preserve the exact historical seed semantics. Passkey PRF generation of a different mnemonic is a different wallet. RP migration in this app is a fund transfer and must remain a separately reviewed, explicitly authorized operation. Never describe it as wrapping the original wallet.

Before migration, inventory `walletMnemonic`, vault records, IndexedDB stores, session/local storage, service-worker caches, crash logging, exported exit files and native backups using disposable wallets. Verify before/after restart and after each payment rail. Inspect for actual private material, not only names such as SigningKeyshare. Redact secrets in results and screenshots. Existing browser backups may retain deleted plaintext; migration cannot retroactively erase them.

## 6 Recommended architecture

### Near term Transitional browser protection

Keep a versioned encrypted vault, with a random data-encryption key wrapped by a password-derived key if multiple unlock mechanisms are planned. The present direct password-derived AES key can also be retained if migration and reset remain simple and rigorously transactional. Use authenticated metadata, strict KDF parameter bounds, adequate password guidance and recoverable two-phase migration. Avoid adding cryptographic complexity merely to change algorithms.

Introduce a small audited operation service as the only application owner of the raw SDK. Components receive narrow capabilities, not the SDK itself. An operation proceeds through prepared, reviewed, authenticated, executing and reconciled states. Bind the full canonical intent to identity, session generation, deadline and single-use nonce. Revalidate immediately before the SDK call, including quote expiry and fees. Reject unsupported capabilities and new SDK methods until classified. Separate incoming synchronization, fee-bearing maintenance, recovery and automated spending policies.

Use the observer only to check that a downstream transfer belongs to an authorized operation and to veto mismatches. It is insufficient when it cannot reconstruct the final intent. Prefer preventing a bypass before any signing method is invoked; separately guard broadcasts of previously signed recovery packages. Preserve offline recovery availability with an explicitly authenticated local recovery mode rather than depending on a remote feature flag.

On lock, invalidate authorizations first. Clear passwords and active mnemonic references, stop automatic spending, and disconnect/dispose signers if claiming key lock. Use BroadcastChannel plus transactional storage coordination for cross-tab state, with safe fallback where unavailable. A Web Worker can improve responsiveness and reduce accidental exposure, but code controlled by the same origin is not an independent security boundary.

### Passkeys and native authentication

WebAuthn can provide a fresh user-verification assertion over a challenge containing the intent digest and nonce. Validate origin, RP ID, credential, challenge, user verification and replay state in the enforcing component. A passkey assertion is authentication, not a Bitcoin/Spark signature. Generic authenticator UI also does not prove the user saw the correct transaction details [E2].

Where supported, WebAuthn PRF can wrap an encryption key for the original imported mnemonic. Do not derive a new spending seed from that PRF output when preserving an imported wallet. Provide password/recovery fallback and test credential loss, sync, browser support and RP changes. Returning decrypted keys to the page still exposes them to compromised page code.

Native apps can require biometric or device-credential authorization for hardware-bound key unwrap or for a signer service. Verify the actual native plugin, authentication freshness, fallback behavior and device security level. Android hardware support is algorithm/device dependent [E3]. Apple's Secure Enclave P-256 facilities are not a drop-in imported secp256k1/BIP39 Spark signer [E4]. Do not label hardware-protected vault unlocking as hardware signing of every Bitcoin transaction. A local six-digit app PIN is a separate, rate-limited fallback, not a high-entropy portable vault password.

### Longer term Independently enforced signing

The installed SDK exposes `ExternalBreezSigner` and `ExternalSparkSigner`, including derivation, transfer, claim and FROST operations [S17, E1]. These are viable integration seams. The default external signer factory still keeps signing in the calling process and creates no isolation by itself. Signing-only/client-signing modes have feature restrictions; at the inspected source revision client package building rejects conversions and cross-chain payments [S14].

Evaluate a native isolated service or a separately administered signer that retains the original imported BIP39 seed, optional passphrase, account and exact derivation semantics. Prove equality of identity and required deposit/leaf keys before adoption. It must independently reconstruct and validate transaction semantics, destinations, fees, replay and scope. A remote service that signs arbitrary frontend-provided hashes after a WebAuthn ceremony is still a blind signer. A trusted confirmation surface or independent policy is needed against a compromised frontend.

Remote enclave or hardware integrations require separate evidence for key import/export, derivation compatibility, supported cryptography, recovery, availability and operator trust. Do not move funds into newly generated keys to make an integration fit unless the user explicitly chooses a wallet migration. Keep a tested unilateral recovery route independent of the signer's online service.

## 7 Prioritized implementation handoff

### P0 Step 1 Define and enforce the operation boundary

Owner: wallet/security engineering. Modules: `src/contexts/WalletContext.tsx`, `src/services/sdkConnect.ts`, new `src/security/walletOperations.ts` and operation-intent types; all direct SDK callers in the coverage matrix. Dependents: every other spending change.

Acceptance: only the operation service can access value-moving methods; CI import/lint restrictions prevent ordinary components using the raw SDK. Enumerate the installed SDK API and fail review on newly added unclassified methods. Refunds, exit creation/broadcast, passkey migration, allowances and issuer methods are either gated or inaccessible. Native/passkey browser scope is explicit. Keep the observer as a second check, never a blanket authorization claim. Resolve H1 and establish H2's canonical intent before adding more UI.

### P0 Step 2 Bind authentication and session lifecycle

Owner: wallet/security engineering with frontend QA. Modules: `spendApproval.ts`, `SpendingApprovalDialog.tsx`, `useBrowserSessionLock.ts`, `webWalletVault.ts`, `useBreezSdk.ts` and every approval caller.

Acceptance: immutable complete intent; visible final address, asset, network, amount and fee; atomic single-use approval; post-auth session/visibility/deadline/quote checks; identity checked against connected signer; no stale password; failed unlock changes no active state. Lock or cancellation during authentication prevents execution even when the auth promise resolves later. Repeated/parallel/two-tab submissions reconcile one operation. Resolve H2, H3, H4 and M1. Characterization tests must be converted into assertions of corrected behavior, not left as security-passing checks.

### P0 Step 3 Make migration and recovery transactional

Owner: storage/recovery engineering. Modules: `webWalletVault.ts`, App vault setup/recovery handlers, `useBreezSdk.ts` startup, recovery UI, `public/sw.js` update compatibility and a versioned wallet manifest.

Acceptance: atomic cross-tab enrollment and reset; wallet identity/network/account manifest; crash-safe journal; verified durable readback and reconnect before plaintext deletion; explicit handling of conflicting legacy/vault records. Original records and exit artifacts survive corruption, interrupted writes, quota errors and failed recovery. Original phrase restores through a damaged record without clearing all site data. No silent regeneration. Rollback can read the new vault. Resolve H5 and H6 before any migration rollout.

### P0 Step 4 Verify the installed binary and each irreversible boundary

Owner: independent security QA with SDK maintainers. Establish reproducible SDK provenance or an independently verified artifact manifest. Add integration tests that execute the real SDK control flow with disposable wallets and instrumented provider/signing/broadcast boundaries. Existing mock callbacks do not establish that the SDK reaches or honors them on every rail.

For every matrix row, prove cancellation, wrong credentials, timeout, background, quote replacement/expiry, destination/amount mutation and duplicate behavior. Verify no disallowed signature is produced if the product promises signing authorization, and no broadcast occurs after denial. Token pre-signing must be addressed in the architecture or accurately disclosed. Retain payment uncertainty state and reconcile before retries. Verify exit recovery remains available when the normal provider or application backend is unavailable.

### P1 Step 5 Finish operational and device coverage

Owner: device QA, release engineering and product security. Resolve M2, M3 and L1. Disable unsupported automatic spending, complete secondary-secret inspection and localized accessible prompts, and measure password derivation on lower-end phones. Test desktop Chrome/Firefox/Safari, mobile Safari/PWA, Android browser/PWA and native platforms actually supported. Exercise process kill, tab suspension, clock changes, device lock, failed biometrics, PIN fallback, storage eviction, cached old tabs and offline return. These are release requirements where the feature is supported, not claims already verified.

## 8 Independent test evidence and reproduction

Commands executed from the isolated candidate worktree:

```sh
npm ci --ignore-scripts
npm test -- --reporter=json --outputFile=evidence/security-review/baseline-tests.json
npx vitest run src/security/independentReview.test.tsx --reporter=json --outputFile=evidence/security-review/independent-tests.json
npx tsc --noEmit
npm test -- --reporter=json --outputFile=evidence/security-review/expanded-tests.json
```

Results: baseline 812/812 passed; independent 17/17 passed; expanded 829/829 passed; TypeScript check exit 0. Existing suite output included refused network-request logs despite a passing test result. No API credentials or funded wallet were supplied for these runs. This was not an air-gapped certification. Installation skipped lifecycle scripts. The assessment does not claim a dependency-vulnerability scan or penetration test of production infrastructure.

Independent test-file SHA256: `58da61c34076780c9eba6e20528d24000beaa468ddf266413990479e92fec979`.

The independent file contains seven control tests and ten characterization tests. The authoritative count is 17 cases, listed in the machine-readable results. Reproduction examples:

1. H3: request approval, populate password input, externally cancel, request again. The next input retains the password; Authorize resolves it. Background/foreground hook test separately shows a new request accepted while `locked` remains true.
2. H4: remember signer A; enroll vault B; attempt session unlock B. Identity rejection leaves B active; the password check for B returns true while A remains the connected fingerprint.
3. H5: call `Promise.all` with two enrollments of different disposable phrases against an empty store. Both resolve and one record wins.
4. H6: enroll A; replace its stored record with damaged JSON; reset using A. The reset rejects and the original damaged record is retained.
5. H2/M1: mutate the original approval array after request creation; observe changed details. Separately move fake wall time beyond 90 seconds without dispatching the timer and complete the request; it resolves.

One exploratory assertion expected mainnet and regtest identity keys to differ. The installed WASM disproved that assumption; the final test records equality and the report requires network context separately. The final suite also uses the SDK's actual entropy-array shape. Neither exploratory assumption is reported as a product vulnerability.

Outstanding acceptance evidence: real SDK denied-send behavior for all rails; small-value Lightning, Bitcoin, Spark, token and cross-chain settlement and fee reconciliation; same funded disposable wallet on another device; historical-state and exit recovery; actual IndexedDB/backup inspection; native biometric/PIN behavior; and compromised-frontend testing against any proposed external signer. Funded tests require separate explicit approval and a disposable, limited-value test wallet.

## 9 Release and rollback plan

Keep PR 35 draft and stop this candidate's production rollout. Implement and review corrections in isolated branches. Before enabling migration, release a compatibility reader and a recovery-only mode that understand the vault schema and preserve existing identity. A feature flag alone cannot undo a local storage migration.

Migration sequence: inventory without logging secrets; check recovery readiness; snapshot non-secret identity and required recovery state; stage encryption; verify decrypt and derived identity; atomically commit versioned vault; reconnect and reconcile the same wallet; only then delete matching legacy plaintext. Retain encrypted prior-version recovery material through the rollback window, never a new plaintext backup. Do not delete SDK or exit databases as a migration cleanup shortcut.

Roll out first to disposable internal wallets after all P0 gates pass, then an opt-in limited cohort. Monitor only privacy-preserving aggregate failure categories, migration phase, authorization denials and reconciliation failures. Do not log mnemonics, passwords, private keys, raw signed recovery packages or full payment credentials. Stop expansion on any identity mismatch, unrecoverable vault, denied operation execution or unexplained duplicate settlement.

Rollback must keep the new vault readable and enter recovery-only or safe locked mode. Never downgrade by recreating plaintext `walletMnemonic`, generating a new seed, clearing site data or forcing a fund transfer. Older tabs must detect an incompatible schema/session version and stop value movement. Preserve pending operation IDs and signed exit plans and reconcile their status before resuming. Test the rollback package on migrated disposable wallets before rollout.

Final release decision remains **NO-GO**. A later **Conditional Go** may be justified only for a clearly described transitional browser vault after all six High findings and applicable release tests pass. Protection against a compromised application requires separately enforced signing and its own independent review. CI success, this report or a limited settlement test cannot replace those gates.

## 10 Source register

Application links are pinned to the reviewed candidate. SDK links are pinned to its declared source revision. Current external documentation is background guidance and does not override the installed source.

A1: [SDK connection condition](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/services/sdkConnect.ts#L117).

A2: [Approval state and completion](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/security/spendApproval.ts#L42).

A3: [Approval dialog](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/security/SpendingApprovalDialog.tsx#L8).

A4: [Browser session privacy lock](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/security/useBrowserSessionLock.ts#L16).

A5: [Vault cryptography and identity checks](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/security/webWalletVault.ts#L60); [Enrollment and password recovery](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/security/webWalletVault.ts#L114).

A6: [App migration and recovery handlers](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/App.tsx#L283); [Connection and fingerprint setup](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/hooks/useBreezSdk.ts#L439); [Cold start vault detection](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/hooks/useBreezSdk.ts#L1289).

A7: [Deposit refund caller](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/pages/GetRefundPage.tsx#L213); [Fee-bearing claim caller](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/pages/UnclaimedDepositDetailsPage.tsx#L375).

A8: [Separate passkey migration connection and sends](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/services/passkeyMigrationService.ts#L90).

A9: [Exit recovery and broadcast driver](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/features/unilateral-exit/driver.ts#L489); [CPFP key derivation and mnemonic lookup](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/features/unilateral-exit/funding.ts#L44); [Exit-state key storage](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/features/unilateral-exit/exitState.ts#L79); [Exit UI recovery call](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/features/unilateral-exit/hooks/useUnilateralExitFlow.ts#L357).

A10: [SDK exposure through context](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/contexts/WalletContext.tsx#L1); [Standard send call](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/features/send/hooks/useSendPayment.ts#L322).

A11: [Native seed bridge serialization](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/services/secureStorage.ts#L176); [Native app lock](https://github.com/Bradvani/getyoursats-wallet/blob/ada10691540d0e1492cd26a4466e00adab33e360/src/services/appLock.ts#L1).

S1: [Observer model and callback contract](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/models/payment_observer.rs#L8); [JS callback rejection adapter](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/wasm/src/models/payment_observer.rs#L18).

S2: [Cooperative exit callback](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/services/coop_exit.rs#L228); [Lightning callback](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/services/lightning.rs#L612); [Spark transfer callback](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/services/transfer.rs#L233).

S3: [Token signing before broadcasting](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/token/token_service.rs#L904); [Token observer before broadcast](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/token/token_service.rs#L1045).

S4: [Core refund orchestration](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/deposits.rs#L216); [Static deposit refund signing](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/services/deposit.rs#L500); [Deposit claim](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/deposits.rs#L56).

S5: [Recovery transaction construction](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/recover_funds.rs#L134).

S6: [Allowance API](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/token_allowances.rs#L21); [Allowance grant signing](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/token/allowance/service.rs#L127); [Pull signing and broadcast](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/token/allowance/service.rs#L337).

S7: [Orchestra provider funding](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/flashnet/src/orchestra/client.rs#L176); [Boltz quote and funding flow](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/cross_chain/boltz/mod.rs#L667).

S8: [Conversion execution](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/token_conversion/flashnet.rs#L1691); [Conversion refund](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/token_conversion/flashnet.rs#L481); [Swap input funding](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/flashnet/src/amm/api.rs#L301).

S9: [Default browser stores](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/wasm/src/sdk_builder.rs#L499); [In-memory session fallback](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk_builder.rs#L989); [Identity-scoped storage selection](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk_builder.rs#L838).

S10: [Tree node and public keyshare types](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/tree/mod.rs#L371); [Browser IndexedDB adapter](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/wasm/js/web-storage/index.js#L1).

S11: [Boltz secret persistence adapter](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/cross_chain/boltz/storage_adapter.rs#L74).

S12: [LNURL payment execution](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/lnurl/pay.rs#L233).

S13: [Batch sending](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/payments/send/batch.rs#L1).

S14: [Client-signing restrictions and packages](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/payments/client_signing.rs#L70); [Pull package broadcast](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/payments/client_signing.rs#L475).

S15: [Issuer operations](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/issuer/sdk.rs#L62); [Burn via transfer](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/spark/src/token/token_service.rs#L720).

S16: [Public SDK methods including bridge](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/api.rs#L349); [Receive and recovery API](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/core/src/sdk/payments/mod.rs#L42).

S17: [External signer builder](https://github.com/breez/spark-sdk/blob/57c5b9e5f0749f97ffe5d93bce21c994f6957cf4/crates/breez-sdk/wasm/src/sdk_builder.rs#L250).

E1: [Breez external signer guidance](https://sdk-doc-spark.breez.technology/guide/external_signer.html) and [payment observer guidance](https://sdk-doc-spark.breez.technology/guide/customizing.html).

E2: [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/).

E3: [Android Keystore security and hardware support](https://developer.android.com/privacy-and-security/keystore).

E4: [Apple Secure Enclave key protection](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave).

E5: [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). The configured PBKDF2 iteration count is not itself a demonstrated cryptographic weakness.
