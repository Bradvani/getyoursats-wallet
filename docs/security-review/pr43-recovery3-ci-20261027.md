# PR43: final application and recovery.3 verification

## Decision and scope

**Automated CI verdict: PASS on c47ffeda, six successful workflows on attempt 1. Expanded real-funds adoption remains NO-GO.**

This record binds the integrated application to its compiled SDK and preserves the actual workflow results. It closes only the automated checks that are explicitly recorded as passed. PR43 remains draft, the production interlock remains exercised and enabled, and the candidate is distinct from the served production wallet. Internal implementation and evidence reviews are not qualified independent security approval.

The evidence-only branch carrying this document does not change the validated candidate head. Its files describe the source below; they do not transfer results to an application change made afterward.

## Exact identities

| Item | Identity |
| --- | --- |
| Application candidate | [`c47ffeda0550f08e3cda994bba06c9745adbdc3a`](https://github.com/Bradvani/getyoursats-wallet/commit/c47ffeda0550f08e3cda994bba06c9745adbdc3a) |
| Complete application tree | `8f18bfbcec61c14b8a48b78359fd8686f26ec60b` |
| Actual pull-request checkout | `fc52e5025b061334d4c5127275ba20ca27954ff6`, with exactly the candidate tree; parents are production/main `07ddf16068cc5bd7ed09397e221800ad7b12d767` and the candidate |
| SDK version | `0.1.0-getyoursats.recovery.3` |
| Canonical SDK archive SHA256 | `32715449ed2e670740befe31f0a466b2adc0ab83651f410295a7cb34af55440c` |
| Browser WASM SHA256 | `d77b97e2041c62575702a3c1227c7efa1299b7c2ce2f6e05612b8c14992e206a` |
| Cumulative `0007` patch SHA256 | `e56dde90e545646dbce6e6f3218bb67c54084f13110fcbbafdb1eccc211b3eb7` |
| Pinned upstream / reconstructed SDK tree | `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4` / `0fad9ee69476211ee47bafb413ba75639a22014f` |
| Isolated SDK build / preserved artifact commit | [40473745510](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40473745510) / `de5100c3728bc11d019744f09624648b4aff8803` |

The isolated build used application source `1298724dfe1d95b7a0a24f19be80e6e977cec011`. That is not the final integrated candidate. The [compiled SDK receipt](sdk-ci-0007-20261027.md) preserves full source/artifact reconstruction, recorded execution and the limits of each proof. The final standard and checkpoint jobs independently bind their installed files to that same canonical archive before SDK import.

## Exact-head workflow results

| Workflow | Run | Observed result |
| --- | --- | --- |
| GetYourSats checks | [40486813619](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40486813619) | Success, attempt 1 |
| Tests | [40486813725](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40486813725) | Success, attempt 1; optional funded E2E job skipped |
| CodeQL | [40486813535](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40486813535) | Analyzer success, attempt 1; separate findings check also successful |
| Release security engine matrix | [40486808144](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40486808144) | Success, attempt 1, all three browser engines |
| Browser security checkpoint | [40486808391](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40486808391) | Success, attempt 1, code/installed SDK and Chromium fixtures |
| GetYourSats browser smoke | [40486813574](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40486813574) | Success, attempt 1 |

The [machine-readable final receipt](evidence/pr43-recovery3-ci-20261027/final-ci-receipt.json) records the exact job/check IDs, conclusions, source identities and intentional skips. Full decoded logs, original status responses, reports and byte inventories are retained in the [evidence index](evidence/pr43-recovery3-ci-20261027/README.md).

### Application, service and package verification

The standard `verify` job reports **1,943 application unit tests passed and one skipped**, across 161 passing files and one skipped file. The skipped file is the opt-in `src/security/bitcoinRegtest.integration.test.ts`. It also reports **236 Node tests**, **11 Redis acceptance tests**, **20 Python source-proof controls** and **36 canonical-package controls** passing. Build and TypeScript checks passed. Lint passed with **zero errors and eight warnings**.

The separate Tests workflow reports the same 1,943-pass/one-skip application result on its own run. Its actual Node version was 20.20.2 and npm was 10.8.2; the engine warning is retained. Standard verification uses its separate Node 22 configuration. Repeated suites are not added into a larger unique-case total. The optional funded E2E job is explicitly skipped and provides no funded-settlement evidence.

Both standard and checkpoint code jobs verify the installed SDK before importing it. They match 125 package files, the selected source patch, matching manifests and complete directory/file inventories. Only nine exact-byte npm metadata renames are accepted. They also pass the installed signer identity, seed factory, signer-guard, binding/export and PBKDF2 checks. All four production WASM targets pass their test-export/hash guards; Node/web API exercise does not claim positive runtime execution on every binding target.

Both jobs observe the exact required production-build rejection before the ordinary build. The successful step confirms that an unapproved production build is blocked; it is not evidence of a successful production deployment.

### Browser verification

The security/containment matrix records **48 first-attempt passes**: seven security cases and nine rollback/containment cases in each of Chromium, Firefox and WebKit. Uploaded report ZIPs and their JSON cases were independently hash-checked. No case in those reports was skipped, retried, flaky or failed.

The full smoke log records **338 passing executions**: nine built-artifact cases (three per engine), 27 installed-SDK CAS cases (nine per engine), 138 Chromium wallet/site journeys and 164 Firefox/WebKit navigation cases combined. The final stage reports only the combined 164-case total; no per-engine split is inferred. The complete log has no failed, retried, flaky or skipped summary. The final browser receipt identifies the uploaded report/artifact checks and preserves their actual scope.

The checkpoint separately records seven Chromium security passes in 15.4 seconds. Those repeat the security suite and are not additional unique cases. CI browser engines do not establish physical iPhone/Android, native OS authentication, a second trusted device or funded wallet recovery.

### Security scanning and dependencies

The separate [CodeQL findings check 122130969914](https://github.com/Bradvani/getyoursats-wallet/runs/122130969914) reports **“No new alerts in code changed by this pull request”**, with zero annotations. The analyzer also passed. Its full log retains the 300-changed-file diff warning, fallback from overlay mode and skipped diff-informed stage. The result is scoped to the reported PR verdict; it is not a claim of zero historical or repository-wide alerts, complete Rust/WASM protocol analysis or qualified independent approval.

The dependency job reports zero advisories in both its full and omit-dev audit outputs, including all severity totals. The completed log and registry/error/integer-zero guard support those results. The artifact's reported ZIP digest is retained but its archive was not separately downloaded. Omit-dev classification does not establish browser-bundle reachability or the absence of undisclosed vulnerabilities.

## Corrections and retained unsuccessful outcomes

The earlier `f912253d7a618f7fdc361e8221d37b6962b7eb8e` candidate passed its workflow analyzer but failed the separate CodeQL findings check with one high-severity annotation at the developer-mode preference writer. Inspection showed a boolean preference flow, without demonstrated wallet seed/key exposure. The [literal-storage correction](dev-mode-literal-storage-20261027.md) stores only fixed true/false values and avoids arbitrary runtime coercion. Seven regressions were added; the original annotation and before/after results remain preserved. No suppression or dismissal was used.

The corrected `c6518cc695c82ae110d16a43c96f2c5c6548ebbd` candidate passed its CodeQL verdict and five workflows, including 338 smoke executions. Its release matrix was nevertheless **cancelled** when WebKit dependency installation exceeded the 20-minute job limit. The security and rollback stages never ran, so no WebKit matrix result is inferred for that source.

The [runner correction](browser-matrix-runner-20261027.md) in the final candidate pins the matrix browser runner to the observed Ubuntu 24.04 environment and reuses the already-reviewed official HTTPS Ubuntu archive step. It preserves package signatures, test commands, permissions and the 20-minute limit. The fresh WebKit log records 117 MB fetched in 24 seconds and the complete installation step finishing in 57 seconds, followed by its actual passing tests. This is observed improvement in these runs, not a promised future download rate. The correction changes no application code or compiled SDK bytes.

Earlier cancelled `0006` and initial `0007` setup-failure records also remain. Their completed subchecks do not turn those attempts into successful workflows. Historical direct Spark acceptance belongs to the recorded `0005` artifact and is not evidence of provider compatibility for `0007`.

## Remaining release decision

The [full release gates](reconciled-release-gates-20261027.md) and [A01-A21 audit crosswalk](audit-boundary-status-20261027.md) preserve the boundaries after automated verification:

- Full-key ownership and safe migration of legacy SDK/tree stores, including coordination with older tabs.
- Bounded incoming Lightning execution and authoritative recovery after lost acknowledgements or crossed receiving boundaries.
- Complete authorization, signing checkpoints, result lookup and recovery for fresh/rebuilt unilateral exits.
- Actual provider compatibility, supported settlement and interruption/restart acceptance on this exact SDK.
- Physical native/PWA recovery, separate-device restoration and original-origin update/containment with unchanged wallet identity and pending records.
- Critical-language/native-speaker review, physical 200% zoom and keyboard acceptance, representative performance and explicitly authorized support delivery/reply verification.
- Qualified independent assessment of the final source, WASM, adapters and applicable native app/plugin pair, followed by a versioned release verdict.

The settled-receipt observer remains unconditionally blocked pending reviewed legacy-storage provenance and source-specific integration. Original wallet profiles, seed variants, recovery material and uncertain journals remain preserved. No inference of non-execution is drawn from absent history, expiry or an unspent output.

Production remains separately recorded on source `07ddf16068cc5bd7ed09397e221800ad7b12d767`, release `32be2cb598402c0344cc`, with its earlier SDK. The [prepared main-branch policy](main-branch-policy-20261027.md) is not activated. Repository protection, automated CI and this evidence packet do not grant real-funds release approval.
