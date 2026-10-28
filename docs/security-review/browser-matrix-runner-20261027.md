# Browser matrix runner correction

The release matrix for candidate `c6518cc695c82ae110d16a43c96f2c5c6548ebbd` did not complete. [Run 40483780128](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40483780128) was cancelled after [WebKit job 122120362240](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40483780128/job/122120362240) exceeded its 20-minute limit while installing Ubuntu dependencies. Both its browser security and rollback test steps were skipped. This attempt contributes no executed WebKit cases or passing WebKit report.

## Observed cause

The runner used the Ubuntu 24.04 image. Apt requested 117 MB of signed packages. Its index download was fast, but the subsequent package transfers from `http://azure.archive.ubuntu.com/ubuntu` consumed the remaining job budget. The final package entry was still downloading at 10:10:09 UTC; cancellation followed at 10:10:17 UTC. The separate check annotation explicitly states that the 20-minute maximum was exceeded. There was no browser assertion failure or explicit TLS error.

The same check warned that `ubuntu-latest` was beginning a move to Ubuntu 26. The correction pins the matrix browser runner to `ubuntu-24.04`, matching this observed run and the successful isolated SDK build. It then reuses the SDK builder's exact reviewed Python step to select the official HTTPS Ubuntu archive before Playwright installs dependencies.

The replacement targets only the explicit Azure Ubuntu archive URL. It preserves suites, components, signing keys, `Signed-By` configuration and package-signature validation. If no expected mirror entry is found, the step fails for inspection. It does not silently accept an unknown runner configuration.

## Scope and validation

The workflow diff has 24 insertions and one deletion in `.github/workflows/release-security-matrix.yml`. The three-browser matrix, test commands, 20-minute timeout, permissions, branch guard, concurrency policy and artifact handling are unchanged. The separate dependency-evidence job is unchanged. Application code, the dependency lock and the compiled SDK are unchanged.

YAML parsing, embedded Python parsing, whitespace validation and an internal source review passed. The reviewed workflow SHA256 is `6de57b7803a4379ade5bfbd40386de3690b1caf76c0598761a6154df229bd4ec`. These are source checks, not evidence that a new workflow has passed. Fresh CI must be read against the corrected commit.

The prior candidate's 338 smoke executions, Chromium and Firefox matrix results, application checks and CodeQL result retain their exact-source scope. The cancelled matrix remains a cancelled result. No result is transferred automatically to a new commit, and no release gate is relaxed.

## Retained evidence

- [Machine-readable cause, correction and validation record](evidence/browser-matrix-runner-20261027/receipt.json).
- [Original timeout annotations](evidence/browser-matrix-runner-20261027/timeout-annotations.json), including the maximum-time and runner-image notices.
- [Complete decoded job log, losslessly compressed](evidence/browser-matrix-runner-20261027/webkit-job-122120362240.original.log.gz), including package-download progress, cancellation and the missing-artifact warning. Original and compressed hashes are in the receipt.

PR43 remains draft and blocked for expanded real-funds adoption. This infrastructure correction does not close legacy-storage ownership, provider execution/recovery, physical-device acceptance or qualified independent review.
