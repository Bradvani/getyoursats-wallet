# Prior c651 verification record

This packet records source `c6518cc695c82ae110d16a43c96f2c5c6548ebbd`, tree `61f993c61a583a0f467039396bfde726e5cbdf20`. Its PR checkout `a922ee9110d5b3b9e3ee0822654673813a34a52b` had the same tree. It is historical evidence, superseded by candidate `c47ffeda0550f08e3cda994bba06c9745adbdc3a`.

**Combined outcome: incomplete.** Five workflows succeeded, including standard verification, Tests, CodeQL, browser smoke and the browser security checkpoint. The release matrix was cancelled when its WebKit installation exceeded the 20-minute limit while downloading Ubuntu packages. Its security and rollback stages were skipped. The full log and exact timeout annotations are retained; no WebKit matrix pass is inferred.

The recorded application result was 1,943 tests passed with one opt-in Bitcoin Core test skipped, 236 Node tests and 11 Redis tests. Lint had zero errors and eight warnings. The optional funded E2E job was skipped. Smoke recorded 338 passing executions. Chromium and Firefox matrix jobs each passed seven security cases and nine rollback cases. Checkpoint Chromium passed seven repeated security cases. These overlapping executions must not be added into a unique-case total.

CodeQL analysis and its separate findings check passed with no new alerts reported in PR-changed code and zero annotations. Its large-PR diff warning remains. The earlier f912 high-severity result and the correction are preserved in the adjacent historical packet. Dependency logs reported zero advisories in all and omit-dev scopes. These are scoped automated results, not a repository-wide vulnerability-free verdict or independent review.

`final-ci-receipt.json` provides the readable workflow/check index. `index.json` identifies each lossless archive and inventory. Each `.inventory.json` lists the original file lengths and hashes plus archive hashes. Original decoded logs are preserved, including warnings and failed setup; no normalization, redaction or truncation was applied by this packaging step. Initial and final snapshots retain their capture-time meanings.

The governance bundle is the public read-only snapshot at 10:00:12 UTC: production and main remained `07ddf160`, PR43 remained open and draft, and the rulesets endpoint returned an empty list. That endpoint does not establish classic branch protection. It is not the final c47 deployment snapshot.

The large smoke ZIP remains outside these small bundles. Its hash, member inventory and extracted CAS JSON are retained; screenshot visual review is not claimed. Publication reviews are scoped to their recorded files and are not independent release approval. No result transfers automatically to a later source, and real-funds approval remains false.
