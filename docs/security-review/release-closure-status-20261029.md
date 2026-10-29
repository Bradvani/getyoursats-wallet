# Release closure status, 29 October 2026

This is a continuation of PR #71 at `b43983db234c120bd104b29fdfac8e8f39e51f91`.
The requested full wallet release is not complete. The completion automation
only observes releases; it does not implement unfinished work or supply review.

## Corrections in this increment

Browser SDK adoption now reads the built wallet identity without requesting
synchronization and compares it with the actual full signer identity that
selected the owned storage namespace. A missing, malformed or different
identity rejects connection. Read failure or locking during the read closes
the SDK lifetime. No connected wallet escapes through an internal-signer fallback.

Five negative cases failed on the predecessor and passed with this correction.
The existing 23 connection/storage cases still pass. The combined connection,
browser-recovery and readiness suite has 62 passing cases. This strengthens
same-wallet recovery; it is not ownership proof for previously untagged records.

The broader browser smoke run `40775517089` ended with four merchant QR failures
and 172 passes in its Chromium journey step. Its old synthetic invoice omitted
the payment hash and hard-coded an amount independently of the merchant charge.
The fixture now returns the requested amount and a synthetic hash and records
that exact amount in its completed receipt. The application invoice validation,
receipt reconciliation and receiving restrictions are unchanged. Earlier failure
logs remain in that run; a fresh browser pass is required for this correction.

## Release requirements that remain open

| Area | Implemented and verified scope | Missing for full release |
| --- | --- | --- |
| Storage migration | Full-identity namespace; resumable migration of already owner-bound data; empty shared-store fencing; no original database deletion | Admission/reconstruction of populated untagged old profiles with proof for their financial rows and preservation of ambiguous/pending records. The current code deliberately rejects these profiles. |
| Operational recovery | Encrypted key recovery; complete local-history reads; validated local journals; same signer/storage/SDK identity; signed-byte continuation | Fresh authoritative reconstruction of provider balance, complete history, pending sends/receipts/deposits and exits on another device. A key backup or consistent cache is insufficient. |
| Incoming payments and exits | Direct Spark UI; standard regtest invoice issuance; bounded original deposit continuation; local Bitcoin Core signed-recovery checks | Funded provider settlement and interruptions; bounded ordinary receiving/claims; pre-signing intent and economics checks for fresh/rebuilt exits; special HODL operator contract where applicable. |
| Devices and rollout | Automated Chromium/Firefox/Linux WebKit fixtures; local rollback tests; earlier owner protection results retained on their actual builds | Final-package iPhone Safari/installed PWA and Android Chrome/installed PWA, QR between devices, loss of connection/lock/restart, original-origin update with an old tab/worker and compatible rollback. Linux WebKit is not a physical iPhone. |
| Independent security acceptance | Implementer tests and CI evidence | A qualified independent review of the completed application plus modified Rust/WASM SDK and an explicit decision tied to the final source/package. PR #71 has no submitted reviews at this inspection. |

## Concrete dependencies

1. An authorized disposable old-release profile containing actual SDK-generated
   records, including pending operations. Rehearse two different wallets that
   used the shared namespace. Synthetic owner labels must not stand in for old
   ownership evidence. Preserve originals and never request a live-user seed.
2. Provider-approved valueless regtest funding/access. The previous automated
   faucet attempt was challenged by bot protection and funded neither wallet.
   Do not bypass the challenge or reuse a historical receipt as current proof.
3. A provider technical answer for the restricted execution semantics and the
   corresponding implementation, followed by source-bound settlement testing.
4. A physical-device operator and an independent reviewer. The already completed
   owner passkey/password tests need not be repeated unless affected; final
   operational/device acceptance is a separate requirement.

The test operator must record the candidate commit and release manifest, device
and OS/browser versions, initial/final wallet identities and test balances,
operation IDs, pending/reconciled state, interruption point and retained result.
Recovery must preserve the same identity and unresolved attempts without sending
again. PWA rollback must preserve vaults, journals and SDK records. No test may
use production funds, production secrets or a user's active recovery words.

## Release action

Keep the production interlock and the unsupported-route restrictions. Do not
merge or promote this candidate as a fully functional wallet while the above
implementation and acceptance work remains open. Do not substitute a completion
alert, a green test count or another preview for production verification.

Production was rechecked on 29 October and still serves main `37abc88` through
deployment `dpl_4RKC9Hq7uX55VBvbiQAGKK1ihrm2`. This increment performs no funding,
transfer, provider claim, main-branch update or production promotion.
