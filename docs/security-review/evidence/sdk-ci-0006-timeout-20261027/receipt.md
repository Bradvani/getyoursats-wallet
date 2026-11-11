# Cancelled SDK 0006 run: independent artifact reconstruction

**Overall workflow: cancelled. Preservation job: skipped.** This is a diagnostic reconstruction of recorded artifacts, not a passing CI run, a successful preservation run, or release approval.

Run [40466031487, job 122061530504](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40466031487/job/122061530504) used application source `c4236476b9d7bb52ae0da278ea2171a7018fa979`, tree `2c007e3c1b202db0ca013dc28496d669ebaa5999`. The overall cancellation and skipped preservation status were supplied by the root agent from GitHub. This check made no network request.

## Reconstruction

The 12-file evidence ZIP independently hashes to `4cf54d1a95cc8e79c990bf88144eb4587a7c50529be8661fa694a3c0af407c0e`. Every extracted evidence file matches its ZIP member.

The uploaded binary patch applies cleanly to a disposable filesystem checkout made with `git archive` from the exact source commit. Full before/after file inventories confirm that it changes exactly:

- `package-lock.json`
- `vendor/breeztech-breez-sdk-spark.tgz`
- `vendor/getyoursats-sdk-build.json`

All old and new Git blob IDs match the patch. The reconstructed `recovery.2` archive hashes to **`a140f22e7314bfd8cccc679da18111225bb4b91df23453857be11e3ee5b1bfec`**. Its sidecar manifest byte-matches the uploaded manifest; the embedded manifest equals the sidecar without the archive-hash field. All 17 generated-artifact hashes and both browser-storage adapter hashes match. The lockfile version, package path and SHA512 integrity match the reconstructed archive.

## Recorded test results

| Recorded gate | Passing cases | Detail |
| --- | ---: | --- |
| Native Rust | 221 | 16 gate groups; each structured count matches its raw test summary |
| WASM storage bridge | 6 | One actual WASM gate group |
| Chromium browser CAS | 9 | One passing attempt per test |
| Firefox browser CAS | 9 | One passing attempt per test |
| WebKit browser CAS | 9 | One passing attempt per test |

The browser report records 27 expected passes, zero skipped, unexpected or flaky results, no report errors, and a duration of 14,594 milliseconds. All three attached adapter attestations identify the installed SDK adapter and match its manifest hash. The downloaded browser-install log records `119 MB in 27min 11s (72.9 kB/s)` from the Ubuntu HTTP archive.

No SDK code was imported or executed during this reconstruction. No tests, browser, provider, profile or network operation was rerun. No Git branch or remote ref was changed, and nothing was published. This is the older 0006 package, which retains the known external-signer namespace defect; the successor 0007 identity controls are not covered by this run.

The detailed machine-readable result is [receipt.json](receipt.json).
