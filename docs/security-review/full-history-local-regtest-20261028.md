# Complete local-history verification and actual local Bitcoin recovery

## Release decision

**Gate 1 remains open for production. No live-funds Gate 2 approval is asserted.** This change advances the integrated candidate from `91333c0d0f1a33bc9dceb91d4add1f6866ac435d`; it does not change the passkey implementation accepted by the owner. It removes the first-page-only local history limitation and makes the formerly opt-in actual Bitcoin Core recovery case reproducible in CI.

## Complete SDK-visible local history

`readRecoveryHistory` paginates every locally returned payment until a short/empty terminal page. Exact 100-row boundaries require the next page. Duplicate IDs, repeating pages, malformed economic fields, read errors and session revocation abort without rewriting or deleting records. Above 100,000 rows the automatic check refuses explicitly rather than reporting a truncated history as complete.

Browser recovery reads this history twice and compares the count and digest of every returned record. It also checks the journal bytes between scans and retains the existing final identity/journal checks. A changed record outside the first display page cannot silently pass. Only the first 100 rows are returned to the initial mobile view; the verified local count and digest remain distinct from display pagination.

This establishes consistency of two complete **SDK-visible LOCAL** reads. It is not an atomic database snapshot, proof that the operator returned every historical record, an export of SDK-internal related rows, or authoritative settlement. Valid uncertain payments and claims remain unresolved even when a cached history label says completed.

### Evidence

The full application suite completed with 2,164 passes, zero failures and one opt-in skip; the service suite with 251 passes. The focused history/readiness/browser-hook selection completed 53 cases. The first focused run failed one retained journal-change case because a second scan reached a stale fixture update before the final snapshot check. An immediate journal check before the second scan corrected the implementation without weakening the assertion.

Three new browser cases use the actual installed IndexedDB adapter and the actual application history reader with synthetic local records: 215 records survive reload, a changed record beyond row 100 invalidates the scan, and failure of the second page does not become successful first-page recovery. Local Chromium passed all three. Exact-head CI supplies the final three-engine evidence; local execution does not claim Firefox/WebKit until their reports are inspected.

## Actual Bitcoin Core recovery acceptance

A new temporary Bitcoin Core 29.0 regtest node runs with no peers, discovery or listening. The local bridge creates its own valueless fixtures; it never reads a user wallet or existing datadir. The exact pre-existing integration test passed with no skip:

- Core accepts the transaction but the bridge deliberately loses the acknowledgement.
- The recovery journal remains uncertain.
- A reconstructed controller resumes the exact same transaction bytes, without producing another signature.
- Confirmation succeeds, altered transaction bytes are rejected, stale confirmation after a reorg is rejected, and reconfirmation succeeds.

The local state recorded two submissions of the same transaction ID, an empty final mempool and no peers. The test uses Core's actual signed transaction and chain, but a synthetic Spark SDK signing adapter. Controller/session recreation is not a process-restart or physical-device result. No external Spark/SSP/Lightning provider operation occurred.

`run-local-bitcoin-recovery.mjs` requires explicit executable and evidence paths, refuses occupied test ports and nonempty evidence directories, generates a new private temporary datadir, checks regtest/no peers, executes exactly one non-skipped integration case, retains a versioned receipt and cleans up only its own processes/data. The first runner invocation correctly refused the port occupied by this turn's earlier disposable bridge; the bridge was explicitly stopped and the fresh run passed. Earlier failure evidence remains retained.

Runtime archive: `bitcoin-29.0-x86_64-linux-gnu.tar.gz` from the official Bitcoin Core HTTPS distribution. SHA-256 `a681e4f6ce524c338a105f214613605bac6c33d58c31dc5135bbc02bc458bb6c` matched the official checksum. PGP authentication was not performed and is not claimed. CI pins that exact digest. The runner hashes the installed binaries separately and records its exact source revision and dirty-state flag. No archive or node secrets are committed.

```sh
node scripts/security/run-local-bitcoin-recovery.mjs \
  --bitcoind /path/to/verified/bitcoin-29.0/bin/bitcoind \
  --bitcoin-cli /path/to/verified/bitcoin-29.0/bin/bitcoin-cli \
  --evidence-dir /path/to/new-empty-evidence-directory
```

The general application run still omits the opt-in case by design. The dedicated exact-head CI job actually executes it. Report these separately; do not count repeated local/CI runs as additional distinct cases.

## What this does not close

1. **Legacy database ownership and migration.** The historical eight-hex-character identity namespace and metadata-only ambiguous-store preflight remain unchanged. No legacy store is assigned a guessed owner, copied, deleted or version-upgraded. Coordinating older code that does not participate in the candidate locks remains separate work.
2. **Final-provider payment and recovery contracts.** Incoming Lightning, uncertain deposits and fresh/rebuilt exits retain their restrictions. Exact deployed transfer/preimage binding and authoritative reconciliation are not established by the local Core test. The paused external-operator probe remains paused.
3. **Operational state on a replacement device.** The encrypted key-protection file is not the SDK database or operation journals. Two local history scans do not reconstruct missing provider state or prove cross-device exactly-once execution.
4. **Original-origin rollout and independent review.** Owner passkey reports remain scoped to their original accepted test build. They do not replace final-app update/rollback or qualified independent app/SDK review.

The repository's separate Spark-cluster runner builds images from a private `ghcr.io/breez/spark-operator` base (`local-regtest/cluster.mjs`). It is not interchangeable with this public, local Bitcoin-only test. An approved operator runtime/test environment and the missing SDK execution contracts are required for the remaining integrated route acceptance. Neither a green workflow nor an internal note grants that approval.

No main branch, production alias/deployment, user storage, recovery words, passkeys, SDK archive, dependency lock, branch protection or production release interlock changed. This work is not permission to use real funds in the restricted candidate.
