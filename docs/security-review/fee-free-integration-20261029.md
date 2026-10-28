# Fee-free transfer integration, 29 October 2026

## Candidate and behavior

This continuation integrates production `37abc88bd113d6c519911fd6773dc74ce603282a`
into security candidate `cc9f970f7719f3ebcfee9ec3990d32834fd2f9f2`. The security
candidate already contained the reviewed PR #46 direct Spark receive changes;
they were not reapplied. PR #43 remains draft and production-blocked.

The integrated receive flow retains an explicit direct Spark BTC address, a
generation-failure message and retry, and the static-address privacy notice.
The entry, fee scope, privacy explanation, error fallback and navigation now
use the existing ten-language payment catalog. Provider diagnostics remain
available verbatim under a translated explanation. These translations still
need the native-speaker review listed in the release gates.

Normal sends keep the recipient's requested amount and display the actual
prepared fee above it. Direct Spark destinations use the direct SDK send;
Lightning addresses are not reinterpreted as Spark identities. A zero-fee
quote is not fabricated, and a nonzero provider quote is not hidden.

The released USDB Settings flow and support content are retained. Its security
candidate containment is checked before mounting the conversion review, so
the integration does not re-enable an unapproved conversion. Two regressions
cover both conversion directions. Existing Lightning/Bitcoin receive
restrictions, unavailable Send All behavior, pending-invoice containment,
native export authorization and the production build interlock are retained.

No SDK, dependency lock, signer, storage schema, migration, payment
authorization, fee formula or live wallet state was changed by this integration.
The canonical recovery.3 archive remains:

`32715449ed2e670740befe31f0a466b2adc0ab83651f410295a7cb34af55440c`

## Verification and retained failures

Local build and TypeScript checks passed. The 35-case focused payment,
conversion, containment and language suite passed. All 251 Node tests,
20 SDK source guard tests, 36 canonical-package regression controls and the
installed SDK signer/storage/observation/PBKDF2 checks passed. Lint reported
zero errors and the eight previously recorded warnings. The production build
failed with the exact expected security-interlock message.

The first full application run reported 2,032 passes, 14 failures and one
opt-in skip. The failures were in the native export test harness: the new
Settings conversion section needed its context provider. That isolated
authorization harness now stubs the unrelated conversion section, whose real
integration is covered separately. Its unchanged 14 export-policy cases then
passed. The corrected full rerun passed 2,046 application cases across 171
files, with one opt-in test skipped. Read remote workflows for the published
candidate head separately; do not present the original run as successful or
combine overlapping totals.

The new `e2e/tests/direct-spark.spec.ts` is registered in the existing
Chromium/Firefox/WebKit localization workflow. Its 13 cases per engine cover
all ten language views at 320 px, failed generation and retry, and direct
send confirmation with zero and seven-sat quotes. The fixtures have no real
SDK connection or wallet keys; external browser requests are aborted. These
tests are UI regressions, not settlement evidence.

Local Playwright browser download returned an unavailable-site HTML page in
place of its archive. The matching official Chrome for Testing 147.0.7727.15
archive was obtained and verified as a readable ZIP, but this workspace
rejected Chrome's process-singleton socket with `Operation not permitted`.
The browser run was stopped; no local browser pass is claimed. CI must run the
unchanged supported browser engines. No sandbox restriction was relaxed.

## Evidence still needed before release

The prior zero-fee regtest receipt is bound to `cc9f970` and its private
profiles. It must not be relabeled as an execution of this new source or
rerun by editing its saved provenance. No funded operation was performed
in this continuation. The [existing release matrix](reconciled-release-gates-20261027.md)
and [audit crosswalk](audit-boundary-status-20261027.md) remain applicable.

| Requirement | Next evidence needed |
| --- | --- |
| Candidate validation | Passing workflows on this exact source/package and a freshly bound disposable regtest acceptance run. |
| Existing wallet migration | Full-identity ownership proof for legacy records and old/new tab coordination; no deletion, silent reset or inferred ownership. |
| Provider settlement and exits | Final-package operator/SSP/HTLC compatibility, interrupted-payment/deposit outcomes, supported mature deposit and cooperative/unilateral exit acceptance. |
| Physical recovery | Actual iPhone/Android and installed-PWA checks, applicable native shells and separate-device recovery preserving identity, history and pending records. |
| Original-origin rollout | Service-worker cutover and old/new tab tests using a compatible containment/forward-recovery artifact, with pending operations preserved. |
| Release review | A qualified reviewer independent of implementation must issue a verdict for the final source, compiled SDK, adapters and applicable native pair. |

The prior quote-only live preflight remains paused. PR #43 records that
automatic approval review rejected its connection to `2.spark.flashnet.xyz`
as outside the earlier approved Lightspark destination, with possible
wallet-derived data disclosure. This continuation did not retry that action.
Any resumed live preflight needs that destination authorization and valid
candidate-bound disposable profiles. It is not permission to submit an exit,
claim a deposit, reuse a quarantined operation or move real funds.
