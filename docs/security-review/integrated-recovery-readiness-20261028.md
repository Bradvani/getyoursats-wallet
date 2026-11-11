# Integrated browser recovery-readiness correction

## Candidate scope

Successor to PR #70 / `9f3f04443e4b948d7b3a76519f3f2eeb48fa18f3`. This change addresses the transition from authenticated key recovery into the operational wallet. It does not alter passkey derivation, the encrypted-vault format, SDK archives, dependencies, deployed origins or production authorization. The owner-protection receipt is retained separately.

## Reproduced defects

Before the correction, five browser-hook regression cases failed: rejected identity/balance, history or deposit reads could still produce a connected wallet; identity drift and damaged local payment records were not rejected by the connection-readiness path. The control case for readable local data passed. A separate two-case App regression demonstrated that password unlock and recovery-word restoration called legacy cleanup even when `connectWallet` returned no client. The original thirteen App setup cases still passed. These seven negative scenarios are not claimed to be seven independently audited vulnerabilities.

## Correction

- Browser startup now requires readable identity/balance, the first history page, unclaimed deposits and validated local outgoing/incoming/deposit/signed-recovery journals before publishing a connected SDK to the application.
- Public identity is checked for consistency across the read. Existing local journals are compared before/after the read without mutating their values. Unknown, damaged or changed records fail closed and remain present.
- Valid unresolved operations stay unresolved. No generic completed payment label is interpreted as authoritative settlement; no request is resent and no recovery transaction is broadcast by readiness checking.
- Lock/session changes during asynchronous reads reject connection adoption. A synchronous in-flight guard prevents overlapping connects; the guard releases after failure so an explicit retry can work.
- The returning-session browser reconnect uses the same required readiness reads and reloads deposits.
- Password unlock and recovery-word restoration require a confirmed, current setup attempt and non-null connected client before legacy plaintext cleanup or wallet navigation. The encrypted backup remains preserved on failure.
- The native read-failure behavior is not broadened into a new native guarantee. Existing native-recovery regressions remain required.

## Evidence design

Application tests use the actual hook/authorization and journal code with synthetic SDK responses. Direct readiness cases exercise all four real journal schemas and verify byte preservation, incomplete data rejection, same-network binding, concurrent mutation rejection, no terminal-state promotion and session revocation. A 100-entry page is explicitly labeled potentially incomplete; this is not a full-history export.

Two additional Playwright cases execute the exact installed IndexedDB adapter with synthetic, valueless records: reopening after page reload retains cached balance, pending history, a deposit and an uncertain attempt; an aborted payment update rejects acknowledgement and retains the original pending record. No SDK wallet, private keys, provider, passkey ceremony or production origin is used by these adapter tests. They do not demonstrate legacy database ownership or provider-wide exactly-once behavior.

The existing security matrix now also executes the adapter suite for every supported browser engine. Exact commit/tree, canonical SDK, test reports and final build remain source-bound in CI. Do not transfer earlier funded acceptance receipts to this candidate.

## Still open for the real-funds product

1. Full ownership validation and migration of legacy SDK/IndexedDB stores, collision-safe identity binding and old/new-client coordination. The conservative existing block on ambiguous shared stores remains in place; this change does not guess their owner or delete/copy their contents.
2. Authoritative balance, full-history and pending-operation reconstruction on the final package with permitted provider connections. A key-only recovery file does not contain the full SDK database or payment journals.
3. Required receiving/claim/exit implementation and controlled interruption acceptance. Unsupported routes and the production build interlock remain enabled. The previously paused external-operator preflight remains paused.
4. Original-origin PWA update/compatible rollback with operational wallet state and qualified independent review of the final application/SDK pair.

No production deploy, branch-protection change, funding, transfer, claim, exit or user-wallet alteration is performed by this correction. Passing local-read checks is not a Gate 1 release verdict.
