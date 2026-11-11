# Identity-bound storage handover implementation

**Engineering candidate, not production authorization. Original untagged legacy-wallet ownership admission is still incomplete.** This change builds on `1ffe3e1ba443711b3253256de5688b8ee80bedd1`. It does not change the owner's accepted passkey/key-backup implementation or the canonical SDK archive.

## Implemented behavior

The browser connection now obtains the actual external signer's compressed public identity and selects a full SHA-256 identity-scoped directory before SDK construction. Every later signer identity read is pinned to that same identity. Native connection behavior is unchanged. The existing ambiguous shared-store guard remains enabled.

New storage handover code covers fresh stores and stores carrying an already established matching full ownership record. It preflights both the SDK and durable tree database, refuses unknown/conflicting owners, snapshots all stores with typed keys/values and verifies the copied contents. Target schemas are generated from and hash-bound to the installed adapters; real-browser tests compare their initialized structure. No existing database is deleted and localStorage operation journals are not rewritten.

An IndexedDB version-change transaction closes the old write namespace before copying. Older pinned adapters requesting the previous version cannot reopen it. A noncooperating old connection blocks the upgrade; the owner is asked to close that tab. Rejected or timed-out requests cannot commit a deferred upgrade after the caller has abandoned the attempt. This is not a guarantee against arbitrary same-origin code opening an unspecified version or already-issued remote provider operations.

Strict-durability target transactions and readback precede activation. A durable source-side retirement marker is committed before activating the new database. A restart between these commits can finish activation, but loss of an already-used target cannot trigger an automatic restore of stale source records. Quota failures, transaction aborts and missing pairs retain their evidence and reject. New payments written after activation are never replaced by a repeated handover.

The support-export locator now resolves the active owned database without initiating migration. Once handover has begun it refuses to fall back to retired records. Its existing redaction and authorization checks are retained.

## Explicit ownership boundary

A matching old eight-character path is NOT proof that all records belong to the currently unlocked identity. This revision does not invent an owner for original production databases. Untagged populated stores remain untouched and return `OWNERSHIP_REQUIRED`. The positive migration tests deliberately create known-owner fixtures; they are not disguised production-wallet evidence.

The owner marker is a namespace/lifecycle consistency record. It is not independently authenticated against malicious same-origin scripts, a hardware boundary or proof of operator settlement. Full legacy ownership needs a reviewed bridge backed by adequate original ownership evidence or authoritative reconstruction with preserved quarantine/pending operations. That admission path is not implemented here. Consequently this candidate must not replace the live wallet: an original untagged wallet would be blocked, not automatically migrated.

## Tests in this change

Browser cases use actual IndexedDB and the unchanged SDK/tree adapters with synthetic valueless records only. They cover all-store typed copying, old-version fencing, separate noncooperating tabs, deferred-upgrade cancellation, quota/abort recovery, interruption before activation, lost-target protection, schema matching, untagged original-adapter refusal, missing pairs, session revocation and support-export routing. No wallet SDK is connected and no provider, signature, faucet or funding operation is requested.

Unit tests cover typed checksum distinctions, identity/network/root names, SDK connection ordering, no fallback after ownership failure, signer identity drift and retained export authorization. Two service tests bind the schema descriptor to exact installed adapter bytes and refuse unsupported auto-increment schema changes. Existing application/security assertions are retained.

Local intermediate runs and final exact-head CI must remain labeled separately. A passing fixture does not establish full production migration or total Gate 1 completion.

## Remaining release requirements

Original untagged legacy-wallet admission; preservation/reconstruction of provider-backed pending operations and state on replacement devices; the outstanding bounded Lightning claim, interrupted deposit and durable fresh/rebuilt exit SDK contracts; original-origin PWA rollout/compatible rollback; and qualified independent application/SDK review remain open. Existing unsupported-route and production interlocks remain enabled. No previously paused operator probe was resumed.
