# A13: public wallet startup measurement

## Finding and release boundary

The current public welcome screen has a measurable presentation delay after its content and SDK WASM are available. On the two warm loads, onboarding became readable at **2.515 s** and **2.634 s**, while WebAssembly instantiation completed at **0.746 s** and **1.141 s**. The full-screen decorative brand overlay determined both warm visibility times. A constrained cold load exposed a separate SDK payload cost: onboarding became readable at **3.942 s**, but WASM instantiation completed at **6.743 s**.

These observations identify a small application-only next step: reveal the welcome content without an opaque timed brand cover. They do not close A13, establish wallet readiness, or approve real-funds adoption. No source, dependencies, deployment or settings were changed.

Measurement window: **2026-10-27 00:29:56 to 00:30:16 UTC**. Target: <https://wallet.getyoursats.com/>. All four page HTML responses matched the recorded manifest. The first cold WASM response body also matched its manifest byte count and hash. Exact public manifest identity is retained in [observed-manifest-identity.json](observed-manifest-identity.json); complete sanitized observations are in [measurement.json](measurement.json).

| Identity | Observed value |
| --- | --- |
| Source | `07ddf16068cc5bd7ed09397e221800ad7b12d767` |
| Tree, from the corresponding local Git object | `54f64d701655ff5e3e0a1d6084f15cd80c0194ba` |
| Public release | `32be2cb598402c0344cc` |
| SDK upstream | `57c5b9e5f0749f97ffe5d93bce21c994f6957cf4` |
| SDK package SHA-256 | `4294f03c86c3b7bcea740e8ecdad6f46b1351de3707ff6d85d574ae8a6f98026` |
| Dependency lock SHA-256 | `642a25bebbea06222a1fb0dd38d5876467e7ba1959417cedf8d13983fd29bb47` |
| Public HTML SHA-256 | `933b9c4ee8bdd6a42cfd198974fe4531daeba190557f1b233459bb4954022eaf` |
| Public SDK WASM SHA-256 | `4fc7fb24e6244c7b94a6f869425537eaf47fe9ee721d31f273b58495d1554b25` |

The public manifest was fetched over normal TLS from <https://wallet.getyoursats.com/release-manifest.json> at **00:28:43.502079 UTC**, HTTP 200, response SHA-256 `c0b37434c82057302f4e5961421dd8009c71951183ea8d3665a13f19f22928f6`. It does not expose a tree field; the tree above comes from `git show` of the exact source object. The earlier task expected source 13f7. Root independently verified the concurrent PR59 welcome-card deployment and authorized measuring source 07dd. No rollback or production intervention followed that provenance change.

## Method

One cold and one immediate warm load were measured for each of two conditions, using disposable headless Chromium **147.0.7727.0**, a **390 by 844 CSS-pixel viewport**, DPR 1, and normal certificate verification with the existing isolated environment CA trust. Unthrottled is the lab host. The constrained condition configured page-target CDP to **4x CPU slowdown, 150 ms latency, 10 Mbps download and 2 Mbps upload**. This is not a physical phone. Service-worker internal traffic may not inherit every page-target network constraint; the effective link was not independently calibrated.

Cold means a fresh browser context with empty browser caches and site storage. CDN, OS and connection caches were not reset; the cold CDN responses reported HIT. Warm means the first reload in that context, after its new worker activated. Cold pages were uncontrolled and warm pages controlled. The initial worker does not claim its installing page, so this first warm load is not a fully populated service-worker cache benchmark.

The harness did not click Start or Restore. It observed only same-origin GET requests, with zero page errors, request failures or safety stops. Local and session storage key lists remained empty. Only the existing diagnostic `glow-logs` IndexedDB appeared; no wallet database, wallet connection or credential ceremony was observed. Guarded APIs stopped wallet-shaped writes, credential ceremonies, unsafe requests and external connections if attempted. No guard fired. No logs, storage values, credentials or secrets are in the receipt.

## Measured startup milestones

Times are relative to navigation start. Each row is one sample, not an average or percentile.

| Condition | Browser cache state | FCP | Onboarding DOM available | First readable onboarding | WASM instantiation complete |
| --- | --- | ---: | ---: | ---: | ---: |
| Unthrottled | cold | 0.673 s | 1.134 s | **2.951 s** | 1.206 s |
| Unthrottled | warm | 0.319 s | 0.699 s | **2.515 s** | 0.746 s |
| Constrained lab | cold | 0.775 s | 1.828 s | **3.942 s** | 6.743 s |
| Constrained lab | warm | 0.332 s | 0.918 s | **2.634 s** | 1.141 s |

FCP may describe a splash or content painted beneath an overlay. The independent readable predicate required the welcome heading and Start/Restore to be visible, with both splash and brand cover removed or faded to opacity at most 0.01. A saved [390px screenshot](onboarding-readable.png) confirms the final readable layout. The predicate can precede physical splash-node removal by a frame, which explains 3.942 s readability versus 3.958 s node removal in the constrained cold sample.

**WASM instantiation is not wallet readiness.** No connected wallet, balance synchronization, restore, signer operation or payment was measured. An instantiateStreaming interval overlaps response streaming and compilation; it is not a CPU-only compilation measurement.

## SDK traffic and payload

| Condition | Browser cache state | WASM fetch begins | WASM response ends | WASM resource interval | Streaming instantiation interval |
| --- | --- | ---: | ---: | ---: | ---: |
| Unthrottled | cold | 0.914 s | 1.154 s | 0.240 s | 0.198 s |
| Unthrottled | warm | 0.544 s | 0.698 s | 0.154 s | 0.123 s |
| Constrained lab | cold | 1.753 s | 6.539 s | 4.786 s | 4.821 s |
| Constrained lab | warm | 0.659 s | 0.932 s | 0.272 s | 0.404 s |

The requested artifact was `/assets/breez_sdk_spark_wasm_bg-jQ-bgV27.wasm`: **12,311,382 decoded bytes**, **4,933,540 Brotli-encoded body bytes** in ResourceTiming on each cold load. CDP's cold encoded-data total was **4,937,536 bytes**, a different accounting measure that includes transport overhead. The constrained cold resource interval was **4.786 s**, which dominates its long streaming-instantiation interval.

The page loaded **12 JavaScript resources totaling 1,639,476 decoded bytes** before any wallet intent, including `index-CGBwiMM5.js` at 945,750 decoded bytes and `logger-q7Ib7-Yv.js` at 342,126. The cold JavaScript encoded-body sum was 526,715 bytes. The hero PNG added 1,123,109 bytes and decoded at 3.146 s under constrained cold conditions. These are individual resource measurements; they are not a sum of all browser and worker traffic. The QR-reader WASM listed in the manifest was not requested during onboarding.

Warm responses came through the worker and reported zero page transfer bytes, but worker requests still occurred. ResourceTiming also reported the reconstructed decoded WASM size as encodedBodySize for those responses. That does not mean a fresh 12.3 MB download. Some Playwright worker size fields were negative API artifacts. The raw receipt retains them; neither the report nor its recommendation treats them as payload totals. The largest observed long task was 212 ms in constrained cold startup, with 408 ms summed over three long tasks in that full sample window. The warm samples had no reported long tasks of at least 50 ms.

## Source explanation and scoped recommendation

1. **Remove the opaque decorative visibility hold first.** [BrandIntro.tsx](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/components/BrandIntro.tsx#L6-L16) keeps a full-screen component for 2200 ms. [premiumMotion.css](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/components/premiumMotion.css#L1-L15) gives it an opaque fixed background, a 1.85 s delay and a 0.32 s exit. [HomePage](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/pages/HomePage.tsx#L46-L64) mounts it above the welcome content. Both warm readable marks coincide with that cover becoming hidden. Preserve the PR59 welcome-card fix and render brand motion within the readable layout, or remove this initial cover. No wallet-state or cryptographic change is needed for this step. A before/after run is needed before claiming any numerical improvement.

2. **Separate safe capability preparation from whole-screen visibility.** [main.tsx](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/main.tsx#L217-L242) waits for passkey capability or 2500 ms before fading the splash. [WebPasskey.checkAvailability](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/services/passkeyService.ts#L429-L434) waits for SDK readiness. The constrained cold splash therefore remains after the brand cover has cleared, until the bounded reveal path permits onboarding. Keep explicit preparation or unavailable state for actions; do not silently choose another wallet creation method. Preserve the [documented transient WebAuthn activation constraint](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/services/passkeyService.ts#L909-L937) and existing SDK readiness gates.

3. **Treat bundle and image work as a separate follow-up.** [main.tsx](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/main.tsx#L350-L391) starts WASM before rendering, [sdkReady.ts](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/services/sdkReady.ts#L1-L43) statically imports the SDK, and [App.tsx](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/src/App.tsx#L1-L59) eagerly imports wallet services and many route pages. Although WalletPage and selected settings/recovery pages are lazy, the welcome shell still starts the full SDK download. Isolate that shell and evaluate safe deferred preparation; optimize the 1.123 MB hero. Loading preparation after a user click must not break credential activation or fail-closed routing. The [worker's initial install](https://github.com/Bradvani/getyoursats-wallet/blob/07ddf16068cc5bd7ed09397e221800ad7b12d767/public/sw.js#L52-L58) and first controlled fetch behavior explain part of the warm cache path; forcing worker activation is not needed to fix the measured presentation delay.

## Remaining limits and retained evidence

This bounded four-sample diagnosis does not establish medians, p95, reliable-device limits, fully warmed worker behavior, field performance, Safari/Firefox parity, connected-wallet startup, or real-funds safety. Instrumentation adds some overhead. Physical-device and wallet-ready acceptance remain open. No source change or deployment was made as part of this measurement.

The initial console-marker probe waited for a log signal disabled in production and is excluded. A separate valid cold sample caused the expected-source mismatch stop and remains separately identified; it is not pooled into the four authorized measurements. The [summary JSON](summary.json) records those exclusions, source citations, exact metrics and SHA-256 hashes of the underlying artifacts. The executed harness remains local and is identified by its SHA-256 in the summary. The separate [publication reproduction copy](reproduce-startup.cjs) supplies Playwright, Chromium, the existing trust directory and the output directory through explicit environment variables. It contains no fixed workspace paths, credentials or temporary sharing URL. Its separate SHA-256 and unexecuted status are recorded; measurement logic was unchanged and the run was not repeated for this path-only adaptation.
