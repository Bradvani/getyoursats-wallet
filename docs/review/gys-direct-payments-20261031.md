# Automatic GYS address payments

Ordinary `username@getyoursats.com` inputs and native reusable LNURL QR codes select a verified direct BTC destination automatically. Confirmation shows the same username, the amount received and the SDK's actual zero network fee. This replaces the earlier unshipped separate direct-address option.

## Ownership and routing

- The website proxy captures a binding only after Breez returns a successful authenticated native registration or recovery response. The pinned SDK signs these operations with its Spark identity key. Public LNURL metadata never establishes ownership.
- The directory stores the compressed identity and an opaque provider owner fingerprint. The fingerprint is the LNURL Nostr key, not the Spark destination key. An atomic Redis operation prevents conflicting owners from silently replacing a destination.
- Every resolution checks the current provider lookup. Revoked names, changed fingerprints, malformed data and unavailable dependencies fail closed. Bindings expire 30 days after the last authenticated refresh. Conflicting-owner records remain blocked for operator review.
- The wallet requires the native domain, callback, path and metadata identifier to agree. The pinned SDK independently parses the derived mainnet Spark address and confirms its identity. The same binding is checked before preparation and again before sending.
- A prepared direct transfer must be BTC with a zero SDK transfer fee and no conversion. Any destination, fee or asset mismatch returns to review. A failed final check never executes a paid fallback.

## Authorization and settlement

A UUID is bound to each prepared direct payment. Before execution, the app reserves a wallet-scoped pending intent under an exclusive Web Lock and persists the identifier, recipient, amount and timestamp locally. Two concurrent confirmations cannot reserve two intents. The pinned SDK uses that UUID as the Spark transfer ID and its receipt lookup ID.

An exception, missing receipt, pending receipt or wrong receipt ID remains uncertain. A new native-address attempt, including a Lightning fallback, checks the previous intent after reload. Only a terminal SDK receipt with the matching identifier clears it. Reconciliation pauses for review before another payment can be attempted. Missing payment history is never treated as proof of failure. Wallet removal checks the local intent before and after its history lookup, including when the SDK has no receipt. A cancelled view before SDK execution clears only its own unsent reservation.

No seeds, wallet storage paths, SDK package, account authentication or migration behavior change. This does not approve the separate wallet security/migration draft.

## Scope and limitations

- Existing recipients become eligible when they next open their wallet and its normal signed native-address recovery runs. No address needs to be reclaimed and no seed is submitted to the directory.
- Senders must load this wallet release. Old wallet builds retain ordinary Lightning routing.
- Merchant BOLT11 invoices, external Lightning destinations and stablecoin conversions retain their invoice workflow and disclosed fees. Global `preferSparkOverLightning` is unchanged. A direct transfer does not produce a Lightning preimage or settle an unrelated merchant invoice.
- Browsers without Web Locks retain the existing invoice route. This release does not add an unsafe cross-tab fallback.
- Direct Spark receipts appear through SDK synchronization. They do not trigger Breez's LNURL webhook, which applies to invoices created through the domain. Offline push acceptance for direct transfers is separate from Lightning webhook acceptance.
- A feature fixture or source-level fee check is not a mainnet settlement receipt. No user-funded test is run without a concrete authorized amount and recipient.

## Rollout

The website project uses `GETYOURSATS_DIRECT_PAYMENTS_ENABLED=true`, the existing Breez reverse-proxy secret and a writable Redis credential. The registration email gate retains its existing read-only credential preference. The new public endpoint is `/.well-known/gys/<username>` with no-store headers.

Stage the website and wallet from the same reviewed commit with production configuration but no domain assignment. Verify the native LNURL passthrough, disabled/unavailable resolution, release manifests and artifact hashes. Promote the website first, then the wallet. A server rollback disables future direct resolution; a wallet rollback must retain the pending-intent data until its receipts are reconciled. Do not clear wallet storage to roll back.

Validation covers malformed/substituted destinations, owner conflict, revocation, fee changes, cancellation, duplicate confirmation, interrupted execution and reload reconciliation. The pinned SDK integration confirms that the authenticated native owner key decodes as the same mainnet Spark destination. Disposable Redis validates concurrent capture. Browser fixtures exercise address/QR input, honest fallback fees and confirmation at 360, 390, 768 and 1366 pixels without any real SDK mutation or funds.
