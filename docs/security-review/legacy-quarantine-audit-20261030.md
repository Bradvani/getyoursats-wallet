# Legacy shared-wallet inventory (no adoption)

Read-only inventory detects old SDK and tree databases from the original fixed namespace, verifies their pinned schemas and makes two complete typed snapshots. It reports only names, versions, row counts and SHA-256 content digests. It never includes payment details or wallet secrets in the report.

This inventory does not establish which wallet owns any row. The old namespace could have records from different signers, so the returned `canAdmit` remains false even if every counted row is zero. It never deletes, migrates, relabels or fences the source. A later historical update can occur after the two scans, so even matching digests are diagnostic evidence, not migration permission.

All nonempty untagged databases remain blocked in the actual wallet connection. The populated historical-wallet admission bridge still requires original-release disposable wallets, independently proved provenance and preservation of ambiguous transfer, deposit and exit operations.

This module is evidence for review and regression testing, not a release gate override. Do not expose it as a production wallet recovery button until it is paired with a verified owner-binding and restoration procedure. Keep old profile originals intact. No production promotion or user wallet data has been changed.