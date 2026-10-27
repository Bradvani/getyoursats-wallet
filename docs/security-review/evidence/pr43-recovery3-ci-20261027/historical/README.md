# Historical PR43 evidence and developer-mode correction

These bundles preserve historical evidence; they do not grant release, real-funds, provider, physical-device or independent-review approval.

## Exact sources

- Historical candidate: `f912253d7a618f7fdc361e8221d37b6962b7eb8e`, tree `0437b489e8626b948bdbd7a54fb3ecaade080024`. The recorded PR checkout `cf1797d0420cd3d1b4ad8135efd5cf4df2723181` has that same tree. The security, audit and browser bundles are specific to this source.
- The separate GitHub Advanced Security CodeQL result **failed** at check `122098998040` with one high alert, despite its analyzer job succeeding. The later retained annotation identifies `src/services/settings.ts:404`, “Clear text storage of sensitive information,” sourced from `useSecretTap`. The historical audit receipt's earlier connector limitation is preserved, not silently rewritten; `f912-codeql-annotations.json` supplies the later detail.
- The narrow correction is local tested commit `1cfdfd219be6e0e19c37581b71611ace8c46c6d6`, published as `c6518cc695c82ae110d16a43c96f2c5c6548ebbd` with identical tree `61f993c61a583a0f467039396bfde726e5cbdf20`. It replaces arbitrary `String(enabled)` coercion with the fixed literals `enabled === true ? 'true' : 'false'`. Normal persistent boolean behavior remains. Seven added cases include throwing `toString` and `Symbol.toPrimitive` controls: before fix 5 failed/18 passed; final focused suite 23 passed, with TypeScript and targeted lint passing. This did not demonstrate wallet-seed/key exposure.
- Fresh `c651` CI belongs to a separate evidence set. No later CodeQL verdict or release approval is inferred from the historical archives here.

## Bundles

| Archive | Contents | Original files | Original bytes |
| --- | --- | ---: | ---: |
| `f912-security.tar.gz` | `f912-security` | 15 | 907,528 |
| `f912-audit.tar.gz` | `f912-audit` | 14 | 85,220 |
| `f912-browsers.tar.gz` | `f912-browsers` | 30 | 791,329 |
| `dev-mode-correction.tar.gz` | `dev-mode-correction` | 11 | 16,144 |

Each adjacent `.inventory.json` records every member's path, byte length and SHA-256, plus archive and uncompressed-tar hashes. All 70 original files are included unchanged. Tar entry metadata is normalized to UID/GID/mtime 0, files 0644, directories 0755 and sorted paths; gzip has an empty filename and mtime 0. Repeated generation produced identical bytes, and every archived member was rechecked against its source. `bundles.json` is the compact package index.

`publication-review.json` records the contextual and credential-pattern review, including expanded gzip logs and the small JSON-only matrix ZIPs. No files were redacted. The external 20,221,546-byte screenshot ZIP, 56,092,063-byte SDK evidence ZIP, cumulative SDK source patch and generated preservation patch remain outside these bundles. Their existing source-specific digest attribution is retained in `external-artifact-attribution.json`; screenshot visual review is not claimed.

The correction's initial sandbox subprocess denial, test-only TypeScript inference failure, failing before-fix controls and final passing results are all retained. Original receipts retain their own execution and evidence limits. Staging performed no repository/ref edits, tests, wallet/profile/provider operations or deployment.
