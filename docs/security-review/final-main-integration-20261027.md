# Final main integration and incoming discovery

Verification date: 26 October 2026 UTC. **Production decision: NO-GO.** This record supersedes the current source and test totals in [settlement-receive-containment-20261027.md](settlement-receive-containment-20261027.md). Earlier evidence remains pinned to its original source. No production deployment, real funds, hosted claim, payment, broadcast or funding retry was performed for this integration.

## Exact integration

| Input or result | Identity |
| --- | --- |
| Previously published security candidate | `2329157c3a8aed401c8602f246c76f6e22ecaf3d`, tree `483d322a2c2b0b2849ce3c97008ae223db797402` |
| Equivalent earlier local evidence commit | `1554f07df598f9fe874eb9ed8d7376bcc226b802` |
| Published site-provenance correction | `e2edc4da2333d6ec480ec1d14195bbef846562f7` |
| Concurrent main retained | `77cb496a453823099725977b6f7975a49b24c179` |
| Published corrective/main integration | `13f7ff73f89ccde9c633cde981ce306c285a0942` |
| Incoming discovery change | `60fe2ae06ceda3ae76f32f45224b2b324d002154`, integrated locally as `3d5923d` |
| Tested combined implementation | `d0d85e30e4ef48cafa33c5060d1a5ee5450e315c`, tree `ea394118c675700674b8bdc0471abdb8e3f270b6` |

The machine-readable receipt is [final-main-integration-20261027.json](../../evidence/security-review/final-main-integration-20261027.json). Local implementation hashes are not presented as public commits. Publication must record its own commit and verify the exact final tree. Subsequent documentation/evidence changes do not alter the tested application source.

## Changes and boundaries

**Incoming direct-transfer discovery now paginates.** The previous newest-100 read could hide older unattempted pending transfers. Discovery now uses bounded ascending pages through one fixed timestamp, verifies the live wallet/session before and after every page, and applies its direct-transfer and attempted-record filters only after a complete read. Failed, stalled or capped reads cannot return partial candidates. Overlapping records use the later observed version. Discovery performs no claim; it never treats absence as permission to reset an uncertain attempt.

Eight added cases cover 275 mixed payments, overlapping status changes, later-page failure, locks during different pages, unlocked wallet replacement, connection replacement and an uncertain receipt absent from empty history. Five failed against the inherited implementation while three controls passed. After the change, the isolated discovery/controller/history suite passed 33 cases. Those cases overlap the final full-suite count.

The SDK still provides no transactional history snapshot or stable secondary paging cursor. Late backfills, deletions and same-timestamp reordering can affect a scan. A selected transfer requires its own fresh exact observation before claim. This fixes the application truncation defect and does not complete interrupted incoming execution or Lightning receiving.

**Site provenance now recognizes one exact observed hosting transformation.** A site build may restore Vercel's projection of the committed site configuration onto the repository configuration only when both parsed configurations match the expected committed values. It records that restoration separately from formatting changes. Wallet builds, changed settings, malformed or missing configurations, staged changes and unrelated source changes still fail their respective cleanliness checks.

**Concurrent startup and theme work is retained.** The merge preserves early saved-appearance selection, light/dark startup assets and readable history/card styles. The bounded service worker retains those public assets offline and handles both legacy brand-cache names. The candidate's restricted fixture marker, receive containment, encrypted vault, signer lifetime, journals and production interlock remain present.

## Verification on the combined source

| Check | Result |
| --- | --- |
| Full unit suite | **1,482 passed, one opt-in Bitcoin Core regtest case skipped, zero unhandled errors.** 147 files passed and one skipped. |
| Build and TypeScript | Passed. Clean-source manifest records `d0d85e30` and release ID `0aaa172e05828901fb9d`. |
| Lint | Zero errors and eight existing warnings. |
| Release-manifest cases | 23 passed through direct execution of the Node test file. |
| Service-worker policy | Nine passed, including offline theme assets and preservation of unrelated caches. |
| Chromium security and startup | 16 passed: seven vault/receive checks and nine startup/theme checks. Disposable fixtures only; no live settlement. |
| Local built artifact | Three passed: excluded runtime fixture, readable startup with failed font requests, and manifest/service-worker provenance. |
| Production interlock | Expected exit 1 before bundling; release remains unapproved. |

The package manifest, dependency lock, complete vendor subtree and installed SDK remain unchanged. The outgoing gateway, receive policy, signed-recovery controller and deposit-claim controller also match the earlier tested implementation. SDK package SHA-256 is `cbb19e1e16760d63e8cba74a33e21ec75dac6684bc8d389da6c9921b8ba58505`; installed browser WASM SHA-256 is `886b8d0be34acf32569ba9b79171f7fb7b86865b93e8b0b331f55e25ead176d8`. The receipt records the exact unchanged Git objects and retained log hashes. Terminal control sequences and trailing whitespace are removed from retained logs; original local log hashes are included.

## Earlier remote CI and hosted-regtest evidence

Remote CI on published candidate `2329157c` independently passed the 1,474-case earlier unit suite, build/types, lint, service checks, installed-SDK checkpoint, dependency audit and CodeQL. Its release matrix passed seven security cases and nine rollback cases in each of Chromium, Firefox and WebKit. Its separate local Bitcoin Core workflow passed one actual mempool, lost-acknowledgement, identical-byte rebroadcast, confirmation and reorganisation case. That test stubs the SDK signer with a Core-signed transaction; it does not verify Spark signing or fresh exit construction.

Those runs precede this integration and must not be reassigned to `d0d85e30`. At the latest recorded monitoring point, the earlier broad browser-smoke job remained in browser installation; it was not counted as a pass. The final published source requires its own CI result. Relevant runs: [security matrix](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40414954207), [installed SDK checkpoint](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40414954505), [Bitcoin Core recovery](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40414954169), [application checks](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40414959613), [browser smoke](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40414959750).

The earlier hosted-regtest attempt identifies source `48e1659`, connected two actual disposable wallets and stopped after a public faucet bot/CAPTCHA rejection with both balances and all operation counts at zero. No funded protocol acceptance was established. Its profiles and manual operator handoff remain preserved locally; no automatic funding retry followed. The older stranded deposit and uncertain record remain unchanged.

## Remaining software and release work

[Remaining SDK contracts](remaining-sdk-contracts-20261027.md) identifies the concrete upstream extension points for bounded Lightning execution, authoritative recovery of uncertain deposit claims and durable fresh/rebuilt unilateral exits. It records the application-discovery defect as corrected while preserving the remaining SDK/API and concurrency limitations. Source links use the published equivalent review tree and the exact pinned upstream commit.

Implementing those contracts still requires rebuilding and reviewing the pinned SDK, then testing the actual final compiled artifact. Manual authorized valueless funding is still needed for the enabled hosted-regtest sequence. Physical devices, separate trusted-device recovery, original-origin funded-state rollout, sensitive-copy localization/RTL/accessibility and qualified independent review remain separate release gates. Preserve the production interlock and unsupported-route containment until those gates pass.
