# Wallet security and migration acceptance, 31 October 2026

## Release decision

The complete security candidate is not accepted for production. Its existing-wallet admission, provider recovery and fresh exit paths are unfinished. The production interlock remains enabled on that candidate. This review does not certify the modified SDK or native applications.

A separate preservation correction based on production `cc0de8baf3bd838dd03c168d064b6a7685530412` can be reviewed independently. It removes automatic native-vault deletion from initialization and verifies the destination before clearing a legacy source. It does not activate the draft vault, change the SDK, rename wallet storage, alter passkey origin or migrate browser databases.

## Confirmed behavior and corrections

| Boundary | Finding and resulting behavior | Acceptance |
| --- | --- | --- |
| Native initialization | Missing, damaged or inaccessible bookkeeping cannot authorize deleting either vault slot. Existing records remain byte-identical through simulated restarts. Historical F3 markers are preserved without claiming a cryptographic migration. | Application correction and native-plugin doubles. Physical app acceptance remains open. |
| Legacy source cleanup | Destination readback must match the exact mnemonic without a distinct passphrase. A replaced source is retained. Failed writes, lost acknowledgements, failed reads and concurrent startup requests preserve recoverability. | Focused tests. This is not cross-process native compare-and-swap. |
| Browser encrypted storage and locking | PR #71 contains encrypted recovery, revocable software signing sessions and a constrained operation gateway. These are absent from the live production branch. | Existing automated results are tied to candidate `40778e5dec791da16b3192e11f966bd6c4c07311`; integration with current main is separately tested. |
| Populated legacy database admission | The security candidate requires an established full owner record. Original populated untagged records are preserved but refused. An upgrade would block affected users. | Blocking implementation gap. No owner marker is invented. |
| Replacement-device operation recovery | Key recovery does not reconstruct every pending provider operation or establish complete remote history. Uncertain attempts must remain quarantined until authoritatively reconciled. | Provider-backed recovery and interrupted settlement remain open. |
| Receiving and fresh exits | Ordinary invoice issuance exists upstream. The candidate still restricts receiving/claims and fresh or rebuilt exits where exact authorization has not been established. A special HODL contract is not a prerequisite for ordinary invoice creation. | Blocking implementation and acceptance gaps. |
| Physical device and PWA update | The earlier owner-reported iPhone key-protection checks retain their original scope. Linux browser engines do not establish final iPhone/Android, installed-PWA, old-tab, service-worker and operational recovery acceptance. | Final package evidence still required. |
| Independent security review | Implementer review and CI do not substitute for qualified independent review of the final application and modified Rust/WASM package. | Not completed. |

## Verification scope

The preservation correction has 57 focused passing tests at local implementation verification. Broader test and exact-source CI results are recorded in the pull request. Tests use disposable synthetic seeds and native-plugin doubles. No user recovery material, live wallet mutation, funded payment or provider claim is used.

The complete candidate was inspected at `40778e5dec791da16b3192e11f966bd6c4c07311`. Its six workflows completed successfully: checks `40973841672`, Tests `40973841697`, CodeQL `40973841734`, companion security `40973841673`, localization `40973841665` and browser smoke `40973841659`. These results do not close the implementation gaps above or transfer automatically to a new merged tree.

## Remaining work in execution order

1. Implement admission or authoritative reconstruction for actual old-release populated profiles from two disposable identities. Preserve immutable originals and all ambiguous/pending records. Prove interrupted and concurrent-tab behavior without assigning ownership from a short namespace suffix.
2. Complete bounded receiving and fresh/rebuilt exit authorization in the SDK, then verify provider balance/history and pending-operation recovery on replacement devices using approved valueless funding.
3. Verify the final artifact on iPhone Safari/PWA and Android Chrome/PWA, including old/new tabs, service-worker update, interrupted migration and compatible forward recovery. No physical device was available to this review.
4. Obtain an independent verdict against the final application commit, SDK archive and release manifest. Promote only that accepted artifact.

The preservation correction leaves other native selection/removal paths and the production browser's existing secret-storage model unchanged. It must not be described as completion of wallet custody security, a native binary release or the full migration rollout. Older native builds with automatic deletion are not safe rollback targets for surviving vaults.
