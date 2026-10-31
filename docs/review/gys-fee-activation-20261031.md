# GYS fee activation correction

## Observed production behavior

The owner reported a 10-sat payment to `bradvani@getyoursats.com` with a 2-sat network fee after reopening the receiving wallet. Public directory inspection returned `available:false` for Bradvani while ChainReaction returned a verified active binding. The deployed sender intentionally fell back to ordinary Lightning when the initial directory lookup failed. The earlier release checks did not establish activation or funded settlement for Bradvani.

Existing server code could silently skip capture for native endpoint representations that differ from its single expected URI, discard compressed successful responses or lose activation on a transient dependency failure. Address recovery still succeeded. Without a stored signed response or a diagnostic outcome, the original failure cannot be attributed to one of these causes conclusively.

## Correction

- Native BTC address and QR input must resolve to a verified zero-fee route. Missing, failed or malformed discovery and missing cross-tab locking stop before an invoice or payment is prepared. A new explicit retry can proceed after activation. External Lightning, explicit BOLT11 invoices, regtest and stablecoin conversion retain their existing scope.
- Authenticated registration/recovery accepts the native HTTPS/LNURL endpoint forms and bech32-encoded equivalents. Name, domain and decoded destination must agree exactly; query strings, alternate authorities and different names are refused.
- Bounded response decompression supports capture and public owner verification while preserving original provider response bytes and headers. The secret-response check still applies before capture or forwarding.
- Activation retries one transient lookup/storage failure with the same authenticated owner. It does not replay the signed provider operation. Conflicting owners remain permanently blocked; no operator guess or public metadata invents a recipient identity.
- Unavailable directory responses distinguish missing activation, owner conflict and changed ownership. Activation warnings contain only fixed outcome codes, with no wallet keys, names, signatures or provider bodies.
- The retry message is localized in all ten supported languages. No SDK, dependency lock, wallet storage, passkey policy or payment intent behavior changes.

## Acceptance boundary

Tests cover both native inputs refusing paid fallback, retry after activation, malformed metadata, unsupported locking, canonical URL variants, hostile URLs, compressed responses, bounded capture retry, ownership conflict and existing direct-send authorization/idempotency. Production completion additionally requires the reported recipient to resolve successfully and the sender to show the real SDK zero-fee quote. No mainnet payment or user recovery material is used in this correction.
