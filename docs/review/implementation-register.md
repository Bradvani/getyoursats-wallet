# Consolidated review implementation register

Source: owner-supplied Consolidated Implementation Review, 25 October 2026, original observations 01–44. Baseline `2c848e8666a415f216fb6a813b107a228345d156`. Evidence for new changes is tied to the containing commit and its CI run; no finding below is declared production-resolved solely because code changed.

**Nine highest-priority workstreams:** E1 units, E2 cross-chain funding, E3 lookup/uncertain payment errors, E4 removal, E5 restore compatibility, E6 Bitcoin deposits, E7 operational support, E8 critical localization, plus **security P0**. These are grouped workstreams, not nine proven vulnerabilities.

Sequence: security investigation and safe trust fixes -> receiving/recovery -> desktop/navigation -> merchant reliability -> conditional activation. Desktop changes are independently testable. Critical translations accompany sensitive fixes; native-language review is still required. Never infer the $0.09 fee/buffer allocation from the observed difference alone.

Status terminology: **implemented/test** means candidate code and specified automated checks; **partial** means explicit remaining requirements; **preserve** means do not redesign working behavior; **open** means not implemented in this release. A resolved field requires the actual release SHA, browser/device, reproduction steps and results, not a historical branch name.

| ID | Subject | Candidate action / evidence | Status and remaining gate |
|---|---|---|---|
| 01 | Two introductions | Restore label narrowed; deliberate credential action preserved | Partial; cross-domain intent handoff open |
| 02 | Early jargon | Payment and deposit explanations improved | Partial; marketing hero rewrite open |
| 03 | Scarcity consistency | Existing brand/scarcity artwork preserved | Open; cross-domain copy alignment |
| 04 | POS status consistency | Merchant screen explicitly beta/local records | Partial; website-wide availability alignment |
| 05 | Satoshi explorer | Existing educational simulator left intact | Preserve; previous baseline interaction tests |
| 06 | Merchant website preview | Preview remains non-payable | Preserve; clearer next-step CTA open |
| 07 | Mining promotion priority | No mining commercial behavior changed | Open |
| 08 | Unsupported passkey guidance | Browser import limitations visible, no fake biometric control | Partial; supported-device matrix/retry validation |
| 09 | One-method setup wording | No change to credential creation semantics | Open |
| 10 | Backup preparation | Existing hidden phrase/checks retained | Partial; prepare/write/verify UX and secure reveal audit |
| 11 | Restore scope | GetYourSats-only wording plus explicit compatibility warning | Implemented/test; same-wallet cross-device validation open |
| 12 | Install guidance | Existing optional install prompt preserved | Partial; reopen help and actual iOS/Android acceptance |
| 13 | Early language choice | Language selector before onboarding | Implemented/test; all destination translations not complete |
| 14 | History layers | Single controlled recent/history view, desktop and drawer entry | Implemented/test; browser matrix |
| 15 | Recent payment amounts | Signed exact sats/token amounts and accessible label | Implemented/test; historical fiat equivalent snapshot still open |
| 16 | Developer jargon | SDK activity/rate labels replaced | Partial; remaining-copy audit |
| 17 | Address copy feedback | Success/error feedback on home copy | Implemented/test; device permission paths |
| 18 | Home priorities | Recent payments before collapsed market, merchant in desktop navigation | Partial; mobile navigation refinement |
| 19 | About/Lightning education | Existing canonical help retained | Open; dedicated destinations |
| 20 | Sats fee symbol | Exact money formatter, sats suffix and token precision | Implemented/test; final all-surfaces visual review |
| 21 | Bitcoin deposit context | Network, Spark destination and unquoted-cost warning | Partial; actual fee/minimum/confirmation values not fabricated |
| 22 | Address request failure | Explicit error/retry, no perpetual empty QR placeholder | Implemented/test; network failure injection |
| 23 | USD/stablecoins | USDT/USDC receive label and exact token amount | Implemented/test; translated end-to-end comprehension |
| 24 | Disabled personal handle | Invitation conditioned on actual feature availability | Implemented/test; email/personalization remains gated |
| 25 | Send confirmation | Existing fee/recipient review retained, satoshi labels corrected | Partial; full fiat/rate context and authorization P0 |
| 26 | Uncertain payment | Actual SDK status determines outcome; exception/pending/missing remains unconfirmed | Implemented/test; adversarial funded outcome reconciliation open |
| 27 | Cross-chain routes | Provider/asset/network/fee precision/output/expiry review before address; no invented buffer | Partial; provider-specific under/overpayment recovery and funded settlement |
| 28 | Invoice expiry | SDK-parsed expiry hides stale/malformed payment QR | Implemented/test; real SDK and one-tap regeneration UX |
| 29 | Merchant ledger | Removed silent 50-order truncation; paginated reconciliation; match merchant invoices only | Partial; still local, not a durable merchant backend |
| 30 | Original merchant quote | Store original amount/currency/rate/time/expiry for new orders; legacy missing data honest | Implemented/test; durable storage remains open |
| 31 | Previous POS note | Baseline reset clears note/edit state | Existing source fix; regression check before closure |
| 32 | POS expiry | Expired/unparsed QR withheld; settled receipts remain SDK-confirmed | Partial; late settlement/refund and durable state tests |
| 33 | Buy handoff | Unverified provider feature remains disabled | Conditional; real partner readiness |
| 34 | DCA monthly | Monthly added to local planning only | Partial; no active purchase/mandate claim |
| 35 | Preferences Save | Auto-save explanation, separate Save payment settings label | Implemented/test; native preference persistence |
| 36 | Currency management | Existing 57-currency catalog not relabelled all-global | Open; primary/favorites simplification |
| 37 | Expert settings | No destructive expert feature removed | Open; plain-language entry redesign |
| 38 | Remove wallet | Accurate label, recovery acknowledgment, fresh paginated pending check, cancel-safe async removal | Partial; all deletion entry points/verified recovery in P0 |
| 39 | Support delivery | Sender verified; two prior support emails marked delivered by Resend (read-only metadata check) | Partial; human reply loop and customer acknowledgment unverified |
| 40 | Privacy requests | Uses existing operational support path | Partial; request handling/retention ownership verification |
| 41 | Contact anchors | Baseline commit specifically fixes contact anchors | Existing source fix; live scrolling/focus validation required |
| 42 | Help vs Learn | Canonical help remains accessible | Open; urgent troubleshooting-first information architecture |
| 43 | Custody architecture | On-chain deposit description distinguishes Spark wallet | Partial; public architecture view/security evidence |
| 44 | Accessibility/mobile | Six-width automated matrix, exact accessible amounts, language choice | Partial; actual hardware, screen reader, 200% browser zoom and human review |

## Evidence constraints

No observation is marked closed in this file. Attach test reports and screenshots to the release commit. Chromium fixture tests use public synthetic invoices and deterministic SDK doubles, not live settlement proof. The source security trace cannot establish native plugin or compiled SDK storage safety. No user seed, payment preimage or private key is included in the evidence.

## Revalidated operational evidence

Read-only Resend metadata showed existing support requests `GYS-MVMYX7I8` (2026-10-24 22:26 UTC) and `GYS-MVMZI9X2` (22:42 UTC) delivered. No new email was sent by this implementation task. This supersedes the old claim that delivery is wholly unavailable, but does not prove recipient attention, reply success or a customer email acknowledgment. Production mail settings were checked for presence without decrypting them.
