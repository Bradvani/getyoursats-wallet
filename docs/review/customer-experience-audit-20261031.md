# Customer experience acceptance, 31 October 2026

Baseline: `c749dc4d69ca58b83bf0d4c5ba0d0e3729d24152` on `main`.
Release scope: customer presentation and interaction polish, retaining the Bitcoin-orange identity. This review does not approve the separate wallet security/migration candidate in draft PR #71.

## Changes accepted for this release

| Journey | Finding | Result |
| --- | --- | --- |
| Settings | Notification previews and test vibrations looked like development controls. | Removed both customer actions. Alerts use the actual enrollment state; vibration has a persistent preference and is omitted when unsupported. Changing its preference produces no sample payment feedback. |
| Settings | All settings, conversion details and logs competed for attention; Save appeared before any edits. | Everyday preferences remain visible. Payment settings and support reports use disclosure controls. Save appears only for changed payment settings and rejects invalid fees. Support and Privacy have direct links. Account remains last. |
| Notifications | Failed settings lookups required reopening the page; initial loading could briefly look unavailable. | Explicit loading, unavailable, permission-blocked and retry states, with no permission request until the customer enables alerts. Actual invoice/address coverage remains visible. Wallet identity changes invalidate pending disable operations. |
| Navigation | Secondary-page wordmarks collided with localized titles and close controls. | Titles and 44px navigation controls occupy separate grid columns. Long titles wrap. Mobile overlays keep keyboard focus inside; desktop navigation remains accessible. |
| Conversion review | Nested dialogs lacked independent keyboard focus and dismissal. | Dialog titles receive focus; Tab stays inside; Escape cancels only the current dialog and returns to its initiating control. Escape cannot dismiss an executing conversion review. Conversion execution and fee safeguards are unchanged. |
| Layout | Theme choices broke into narrow letter stacks with enlarged text. Landscape left too little room for activity. | Theme choices reflow to one column as text grows. The landscape address row uses horizontal space. Touch controls for units, copy/share, navigation, quick amounts and activity are at least 44px. |
| Wallet | The sats character depended on a missing glyph. A disabled recurring-buy promotion remained visible. | A shared vector sats icon renders in the balance, menu and unit selector. Unavailable recurring buying is omitted. |
| Sending | The BTC amount screen exposed both a legacy fiat toggle and a unit selector. | BTC/fiat send and receive entry use the explicit unit selector; a fiat-only receive flow no longer misleadingly labels its toggle as Stable balance. The separate token selector remains available when an actual token identifier exists. Amount parsing, stale-rate guards and payment submission are retained and regression-tested. |
| Receiving | Existing custom-address owners still saw a personalization instruction. | The prompt only appears for addresses outside `getyoursats.com` while identity verification is available. The current receive address/QR is unchanged. |
| Copy | English bypassed canonical application copy; activity controls ignored the selected language; Settings discussed translation work. | Canonical English labels apply, including checking history before retrying an ambiguous payment. Activity/history controls and new settings copy cover all ten supported locales. Internal translation-review commentary is removed. |
| Passkey errors | Customers were asked to understand ceremonies, domain association and cache deployment. | A short explanation, retry and support-report action lead. Raw diagnostic details are collapsed. Passkey derivation, authentication and recovery logic are unchanged. |
| Motion | Payment feedback must reflect wallet events; ordinary navigation must honor reduced motion. | Signature payment scenes remain. Regression coverage exercises pending/failed/confirmed states, reduced motion, high density and vibration independence. No fake confirmation was introduced. |

## Verification and evidence

- Unit suite: 1,312 tests passed across 132 files after the presentation and copy changes.
- Production build/typecheck and repository lint are required before merge. Existing hook warnings are tracked separately; no new lint error is accepted.
- Browser suites cover onboarding, wallet, Settings, currency choice, send/receive, receipts, history, merchant mode, recovery setup and conversion review using disposable fixtures. They never use an existing wallet, real recovery words or funds.
- New `customer-experience.spec.ts` checks preference persistence, invalid-fee save prevention, removed diagnostics, support disclosure, mobile focus containment, independent nested-dialog dismissal, desktop keyboard access, language selection, 320px/200% text reflow and Arabic history filters/export.
- Existing suites cover ten-language headers and payment screens, Orange/Dark themes, 320-1920px layouts, landscape, reduced motion, payment-event timing, stale quotes, INR grouping and guarded recovery setup.
- The browser workflow includes the new acceptance tests in Chromium, Firefox and WebKit. Exact outcomes and run links belong to the associated PR; images are retained as commit-bound CI artifacts.
- Visual inspection used rendered screenshots of landing, wallet (mobile/desktop), Settings (English/Hindi/Arabic and enlarged text), history, send, receive, sent/received states and backup. Normal page overflow was absent. Offscreen market-unit buttons are inside their intentional horizontal scroller. Native backup checkboxes are inside 44px labels. Developer-only fixture controls are not shipped customer controls.

## Acceptance limits

These checks are evidence for the scoped web release, not a claim that every device or error path is flawless. Physical iPhone/Android/PWA behavior, motor vibration, screen-reader use on actual devices and independent native-speaker review still need human acceptance. Browser engine results must not be represented as physical-device acceptance.

The separate security candidate remains gated on populated-profile migration/recovery, provider recovery and exit evidence, push capability reconciliation, final physical-device/security acceptance and independent review. This UI release does not change the pinned SDK, storage namespace, recovery phrase, signing identity or migration policy, and does not ship native binaries.
