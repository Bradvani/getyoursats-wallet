# Gate 1 integrated release candidate, 28 October 2026

**Disposition: candidate for verification, not a Gate 1 pass or production authorization.**

## Frozen integration inputs

- Security and verification companion: `5cff021037ad9aa1a984bc33ed97bcc407e3b27e` (PR #66, based on PR #43's `cc9f970`).
- Current main: `37abc88bd113d6c519911fd6773dc74ce603282a`.
- Payment integration: `98211bf90ec740c89091906230338097e81db237` (PR #68).

This combines the currently shipped localization and intentional stable-mode changes with the existing security candidate and direct-Spark fee/receive changes. Conflicts were resolved to retain both product behavior and the security containment, not by accepting a whole branch. No SDK/archive/lock-file change is part of this reconciliation. Existing historical acceptance profiles remain tied to their original commits and are not reused here.

## Corrections in this candidate

- Incomplete WebAuthn authentication now has neutral locked-state wording. `NotAllowedError` is not misrepresented as definitively proving user cancellation. Startup/retry and browser-vault unlock surfaces use the same classification. Unknown and network failures retain failure guidance. No authorization or signer policy is weakened.
- The owner reported that cancelling the live iPhone passkey prompt kept the wallet locked. This is one reported observation on the existing production build, not physical acceptance of this candidate.
- Settings describes an enrolled password-encrypted imported wallet accurately. It continues to disclose that attaching a passkey to an imported wallet is unavailable. Password protection is not labeled biometric or hardware key isolation.
- The integrated PIN/export test fixture supplies the newly added stable-mode child its provider dependency. Existing PIN policy, stale-callback and export authorization assertions are unchanged.
- The Spark receive-error message is present in all ten language dictionaries. Sensitive translations still require qualified native-language review.
- The companion CI now covers this specific integrated candidate when its PR targets main. It checks the immutable PR head, canonical installed SDK, application/service tests, exact build, production interlock and the three-browser security/rollback suites. Raw reports and source records are retained separately from release approval.

## Retained integration failure

The first combined source passed TypeScript but failed 15 application cases: 14 Settings tests lacked the newly required stable-mode provider and one translation-coverage case found the Spark error string absent from all dictionaries. The failures were retained and corrected without removing assertions or changing runtime authorization. They are not transferred to the corrected source as passing evidence. Fresh exact-head CI must establish the corrected result.

## Gate 1 closure checklist

| Requirement | State at candidate assembly | Evidence required to close |
| --- | --- | --- |
| Integrated source and build | Verification required | Exact commit/tree, installed SDK proof, all required CI and shipped-artifact identity |
| Imported-wallet passkey attachment | Not implemented | Same-wallet encrypted attachment, cancellation/failed enrollment preservation, revocation and explicit cross-device recovery semantics |
| Existing full-wallet migration | Incomplete acceptance | Original identity plus balance/history/pending operations, known SDK/IndexedDB ownership, interrupted/quota/corrupt-storage behavior, concurrent old/new tabs |
| Complete spending/recovery route scope | Restricted | Every enabled capability authorized; required unavailable product routes completed and accepted before full-wallet release |
| Interrupted live operations | Incomplete acceptance | Exact-candidate authoritative reconciliation without resubmission for every enabled route; claims and exits included |
| Physical acceptance | Not performed on this candidate | Disposable-wallet iPhone 17 Pro / iOS 27.1 and Android checks; genuine authentication, clean-device recovery and PWA lifecycle |
| Rollout/rollback | Partial software evidence only | Original-origin cached/PWA update and controlled rollback with preserved funded wallet state |
| Independent security review | Outstanding | Qualified review of this exact combined application and installed SDK |

The production interlock, receiving/unsupported-route restrictions and main branch protection remain enabled. A successful preview build or all-green CI does not override these gates. Do not publish this as a complete real-funds wallet. No release sign-off is inferred from comments in parallel payment workstreams.

## Owner action

Do not recreate the current funded wallet, delete its passkeys, clear browser storage or supply recovery words. An executable owner handoff requires a separately verified test deployment, identified build and supported test route. This document does not grant a production test GO.

No new funded transfer, deposit claim, exit or external-operator preflight is authorized by assembling this candidate. The previously paused operator connection remains paused.
