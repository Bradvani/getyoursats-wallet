# A13 candidate: remove the welcome page's timed cover

## Change ready for integration

Commit **`942d20a85cebb2d92b1bf174f9265cd4fb5b00dd`**, tree **`b18c72ef8622d06de4e38fcc3c9662b3e915f664`**, is based on **`6304e545149d53efa73f4580b869bba475b4fd68`**. The isolated branch is `codex/a13-welcome-visibility-20261027` and its working tree is clean. This commit changes only `src/pages/HomePage.tsx`, removing the `BrandIntro` import and its full-screen mount: **one file, two deletions**. The complete [source patch](welcome-cover-removal.patch) is included.

The measured problem was an opaque timed brand layer hiding otherwise available welcome content. The candidate removes that cover. The existing 3D hero, Start morph, welcome content fade-ins, inline branding on actual loading and unlocking screens, `passkeyCheckSettled`, SDK readiness and session logic, and production interlock are unchanged. The source hashes in [candidate-summary.json](candidate-summary.json) bind those preserved files to the base commit. No source or dependency change outside the two deletions was made, and no production deployment occurred.

## Verification

- **37 existing tests passed across five files:** onboarding policy, recovery/onboarding UI, Start routing, payment/brand motion, and welcome-card behavior.
- **TypeScript and Vite build passed** using local preview-mode configuration without an API key or staging password. No production interlock was changed.
- **Changed-file ESLint and Git whitespace check passed.**
- **Two refined local browser samples passed**, one before and one after. They used fresh disposable contexts, Chromium 147.0.7727.0, and a 390 by 844 viewport. No Start/Restore or other wallet action was taken.

The browser observed only same-origin GET requests, zero page errors, zero request failures and zero safety stops. Local/session storage key lists were empty; only the diagnostic `glow-logs` database appeared. The hero URL, natural dimensions and layout box matched before and after. The temporary dependency symlink was removed before commit, and the reused installed SDK hash remained unchanged.

## What the browser established

The baseline still had the full-screen brand element at **opacity 1** after the existing splash had cleared and Start/Restore were present. With the candidate, that cover was never observed. The welcome still uses its original staggered fade-ins, so initial unoccluded content and settled legibility are separate milestones.

| Local milestone | Before | After |
| --- | ---: | ---: |
| Existing splash removed | 0.374 s | 0.359 s |
| Welcome controls present under their normal styling | 0.491 s | 0.493 s |
| Welcome first unoccluded | 2.308 s | 0.493 s |
| Heading, subtitle, controls and hero at at least 95% combined opacity | **2.308 s** | **0.909 s** |
| Full-screen brand cover observed | Yes | No |

The final readability predicate requires all named elements to be visible with combined ancestor opacity at least 0.95 and neither splash nor full-screen brand cover visible. The saved [baseline covered state](before-covered.png) and [candidate readable state](after-readable.png) were visually inspected. The candidate image shows the existing hero and controls clearly within the 390px viewport.

These single local timings are diagnostic values, **not a stable production speedup claim**. SDK Cargo compilation was concurrently running on the host. This local comparison uses loopback static delivery and the candidate SDK, whereas the separately preserved public baseline measured release 32be and its original SDK. The primary verified result is removal of the fixed opaque hold while retaining existing readiness behavior.

The first exploratory pair used the earlier >0.01 visibility threshold and caught the candidate's normal fade-in partway through. It remains as `initial-visibility.json`; it is not used as final legibility proof. The refined pair is [local-visibility.json](local-visibility.json), collected at 00:42:48 to 00:42:52 UTC. No test suite or build was repeated for this predicate correction. One sandboxed browser launch failed before navigation due OS restrictions; the authorized browser pass then completed in the supported execution environment.

## Provenance and limits

The local builds use SDK package `cbb19e1e16760d63e8cba74a33e21ec75dac6684bc8d389da6c9921b8ba58505`, actual WASM `886b8d0be34acf32569ba9b79171f7fb7b86865b93e8b0b331f55e25ead176d8`, and lock hash `93dcb8e7d76f5de9a2e73f3f162df30aadeb71d2169dfb2490611b4b5fb8b4bb`. These differ from the current public artifact and are recorded separately.

Both local build manifests report base 6304 and `sourceDirty:true`: the baseline had the temporary dependency symlink, and the after build also had the then-uncommitted two-line edit. The commit above contains the same verified source after cleanup. These temporary artifacts are not clean release attestations and must not be promoted. Integration should rebuild from the final combined source through its normal release gates.

No physical device, field-performance distribution, connected-wallet startup, credential ceremony or funds movement was measured. The visual delay is addressed in this candidate; A13's broader performance acceptance and real-funds release gates remain open. The [structured summary](candidate-summary.json) includes exact source and evidence hashes, and the [local harness](local-visibility.cjs) uses explicit environment variables for dependency, browser, trust, artifact and output locations.


## Settled visual follow-up

A subsequent review raised a possible omission of the header, language picker and hero in an inline image preview. Reopening the actual earlier PNG confirmed those pixel regions were present. One bounded follow-up loaded the unchanged local after-build, awaited `HTMLImageElement.decode()`, loaded fonts, completion of all six finite entrance animations, and two `requestAnimationFrame` callbacks. A `Page.captureScreenshot` capture used `fromSurface:true`. No animations were forced or shortened, and no source was changed.

All eight required elements, including the header, scarcity text, English language picker and hero, had effective ancestor opacity **1**, nonempty geometry and complete viewport containment. The hero's current source returned HTTP 200, decoded to 1448 by 1086 pixels, and had the unchanged 1,123,109-byte SHA-256 `7b174cca6593622dd8112a7cfe6cb199bd087d5c33617b0402ab80e7901e5bf1`. No overlay, safety stop, unexpected request or browser error was observed.

The final [settled screenshot](after-settled-verified.png) is **byte-for-byte identical to the saved public baseline `onboarding-readable.png`**, with SHA-256 `544a33208f36e291b2b09e03f0956c80b940272a170c63864ca908a71f8184b2`. Pixel comparison also establishes that the header, language-picker and hero regions in the earlier `after-readable.png` are identical to those in this settled image. This resolves the source/artifact concern. The differing inline preview was not attributed to a product defect.

The earlier >=95% mark is retained as a CSS visibility diagnostic, not proof that a compositor frame completed at that exact instant. Use the settled image as final visual evidence. The [detailed visual receipt](settled-visual-proof.json) preserves ancestor styles and rectangles, image response/decode checks, animation completion, frame callbacks, original and settled hashes, and post-capture pixel comparisons. This follow-up adds no production-performance, physical-device or wallet-ready claim.
