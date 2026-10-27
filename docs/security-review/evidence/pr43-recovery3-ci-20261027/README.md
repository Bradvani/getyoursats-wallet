# PR43 recovery.3 CI evidence

Final application source: `c47ffeda0550f08e3cda994bba06c9745adbdc3a`, tree `8f18bfbcec61c14b8a48b78359fd8686f26ec60b`. The actual PR checkout `fc52e5025b061334d4c5127275ba20ca27954ff6` has exactly that tree. The compiled SDK is `0.1.0-getyoursats.recovery.3`, archive SHA256 `32715449ed2e670740befe31f0a466b2adc0ab83651f410295a7cb34af55440c`.

**All six final-source workflows passed on attempt 1.** Fourteen checks succeeded and the optional funded E2E job was intentionally skipped. The one opt-in Bitcoin Core unit/integration case also remains skipped. **Real-funds release approval remains false.**

## Readable starting points

- [Final application/SDK report and remaining boundaries](../../pr43-recovery3-ci-20261027.md).
- [Machine-readable final CI receipt](final-ci-receipt.json), SHA256 `2907e5428648d17dc8338c62ae93d572e8ffcfb847dd6760dac23284c108ef55`.
- [Complete bundle index](bundles.json) and [publication file inventory](SHA256SUMS.json).
- [A01-A21 audit crosswalk](../../audit-boundary-status-20261027.md) and [release gates](../../reconciled-release-gates-20261027.md).
- [Prepared, inactive main-branch policy](../../main-branch-policy-20261027.md).

## Source-specific packets

| Directory | Source and outcome |
| --- | --- |
| `final-c47/` | Final c47 audit, standard/checkpoint verification, Tests/global status, browser reports and read-only production/governance snapshot. Six workflows succeeded. |
| `prior-c651/` | Prior c651 application and scanning passes, but its WebKit matrix installation exceeded the 20-minute limit. The matrix remains cancelled; its two WebKit test stages were skipped. |
| `historical/` | Earlier f912 results, including the failed separate high-severity CodeQL findings check, plus the narrow developer-mode literal-storage correction and before/after controls. |

The source-specific initial/interim snapshots remain unchanged beside final observations. A successful later run does not rewrite an earlier failure, cancellation or pending snapshot. Repeated suites are not added into a larger unique-case total.

Each archive has an adjacent readable inventory with every original file's relative path, byte length and SHA256, plus archive and uncompressed-tar hashes. Packaging uses sorted regular files, fixed archive metadata and lossless gzip. Every member was round-tripped and compared with its original bytes. The bundle index states each archive's source and scope.

Logs described as original contain the complete decoded UTF-8 supplied by the GitHub connector or the explicitly identified public response. They do not claim preservation of the original compressed HTTP transport bytes. No additional redaction, line normalization or truncation was applied by this packaging. Upstream masking and any earlier explicitly labelled normalization retain their original scope. Publication scans help identify accidental credential payloads; they are not a universal secret-detection guarantee or independent audit.

## Large artifacts retained separately

The large smoke screenshot ZIPs and isolated SDK evidence ZIP are not duplicated in this small Git packet. Their original digests and inventories remain in the source-specific receipts. The final smoke CAS JSON and full member inventory are included in the browser packet. Screenshot bytes were hashed but visual review is not claimed. The canonical SDK archive, cumulative source patch and preserved manifests already exist in the candidate's versioned vendor tree; the separate [compiled SDK evidence](../../sdk-ci-0007-20261027.md) binds them to their build and offline reconstruction.

## Limits

These files establish recorded automated checks for the identified source and package. They do not establish physical-device recovery, final-package provider settlement, safe legacy-store migration, complete interrupted-operation contracts or a qualified independent release verdict. The observer remains blocked and the production interlock remains enabled. PR43 is draft; production and main are separately recorded on `07ddf160`. The prepared ruleset remains inactive pending explicit approval.
