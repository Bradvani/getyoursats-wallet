# Direct Spark receive localization and browser acceptance

This increment belongs on the integrated recovery candidate in PR #71, based on
`871d8aa7ebe85b6d319ddb6ee63959ed0cebfe7b`. It does not activate production.

## Behavior

- Translate the explicit direct Spark receive entry, QR explanation, fee scope,
  reusable-address privacy notice and return controls in all ten supported locales.
- Present address errors through the existing localized error component; retry
  remains explicit and an unavailable address never creates an empty QR.
- Localize the restricted-browser conversion notice and keep the conversion review
  unmounted for restricted wallets. Both directions have containment regressions.
- Add a UI-only browser fixture and 13 scenarios per Chromium, Firefox and WebKit:
  all ten receive locales at 320px, request failure/retry and zero/seven-sat quotes.
  The tests check the recipient still receives the entered amount, quoted fees are
  additional, and direct sending never silently falls back to LNURL.

The fixture uses synthetic SDK responses, no keys and no connected wallet. Its
browser route blocks non-localhost requests. It is UI evidence, not settlement,
physical-device QR scanning, provider acceptance or an independent review.

## Integration and validation provenance

An initial continuation prepared PR #43 at `a177461a30f909b06d1fefae986e5e3c85658e17`
before the newer integrated PR #71 was recovered from the handoff. That initial
tree `1bfb095008dd97de46299e03041c6f46d1ba05f9` passed the three-engine localization
workflow `40774600021`: 61 scenarios per engine, including the 13 direct Spark
scenarios, with no retries or failures reported. The checkout was PR merge commit
`ada8b06d7faa90d099037a90725353ea88b683aa`, whose tree equals that initial tree.

Only the remaining UI/localization increment was transferred onto PR #71.
The later storage handover, deposit continuation, live-observation fencing,
passkey protection, merchant receipt verification, verified-fee confirmation and
existing translations are retained. In particular, the guarded merchant test
continues to reject cached-only receipts without an explicit provider observer.
The SDK archive, dependency lock and production release interlock are unchanged.

On the integrated working tree, 72 focused application tests and the full suite
of 2,259 application tests passed; one opt-in integration case was skipped by the
general invocation. The TypeScript/build and changed-source lint checks passed.
These local builds retain the base revision and
dirty-tree label; the CI results for the published commit must be read separately.
The original PR #43 browser pass is not relabeled as exact-head PR #71 evidence.

## Production decision

Still blocked by the integrated candidate's documented release requirements:
populated legacy-wallet admission, full settlement and replacement-device
operational recovery, bounded fresh/rebuilt exits, provider compatibility,
production-origin installed-PWA rollout/rollback and independent expert review.
Existing completed owner protection tests keep their original build attribution.

No provider connection, funding, payment, signing, live invoice, main branch or
production promotion was performed by this increment. The separate historical
regtest transfer receipts remain historical. Native-speaker review and real-device
QR acceptance have not been claimed. Ordinary Lightning Address payments may
still incur routing fees; the fee-free path is explicit direct Spark addressing.
