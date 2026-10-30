# Currency and wallet journey review

Date: 2026-10-30. Base: `2504ede30f670b56e3b2d2c2f3f97ac7662565cb`.
The pull request and its CI checks identify the exact reviewed release commit.

## Scope and method

Reviewed the public entry, wallet setup, independent backup, balance, fiat preferences, market price, send and receive amount entry, destination and fee review, payment outcome, activity/history, merchant terminal, settings, help, and disabled ramping entry points. Used source inspection, isolated browser fixtures, application/server regression tests, and production artifact checks. Fixtures use synthetic identities and mocked SDK outcomes; no user recovery material or live funds were used.

The evaluation applies Nielsen Norman Group's usability heuristics and contextual onboarding guidance, plus the research and design-system approach described by Parallel. It is an implementation review, not work commissioned from, approved by, or certified by either company. Real-user research, native-language review, and physical-device acceptance remain distinct evidence.

## Findings and shipped changes

| Journey | Finding and priority | Resolution | Verification |
| --- | --- | --- | --- |
| Balance, market, confirmation and receipt | High: separate fiat formatters produced inconsistent INR grouping, especially with non-Indian interface languages. | One currency-region formatter; INR uses lakh/crore; USD uses groups of three; regional decimal/group symbols and ISO minor-unit precision are retained. | Formatting matrix across ten interface languages; INR market and receipt browser assertions. |
| Amount entry | High: stripping characters and merging separators changed `1.5` sats into `15`, and could turn grouped fiat pastes into different amounts. | Preserve invalid text and disable progression. Convert only unambiguous grouped decimal pastes and mobile decimal-comma input. Reject ambiguous `1,234` in a decimal field; require correction. Sats may accept valid integer grouping. | Parser/value-to-sats tests; real AmountStep tests assert no continuation for malformed or ambiguous input. |
| Currency settings | Medium: a separate SDK metadata request could leave the entire page unusable even when rates recovered. | Reuse the shared data context and an offline ISO currency catalog. No additional metadata fetch and no invented live rate. Search by localized name, code or symbol. | Metadata-failure browser scenario, selection/reload/market consistency. |
| Currency settings | Medium: unlabeled checkboxes, small reorder controls, no visible formatting preview, and removal of every currency. | Native labeled checkboxes, 44px control/label targets, keyboard ordering, immediate save feedback, format preview and at least one selected currency. Recover malformed display preferences to a valid selection. | Desktop/mobile, keyboard, 200% CSS zoom, preference unit tests. |
| New-wallet setup | Medium: balance education required a later settings detour to choose fiat. | Choose currency in the balance chapter; preview the number format and keep the USD default until explicitly changed. | Choice persists after reload; changing currency does not complete recovery verification. |
| Market status | Medium: refresh had no pending feedback and missing quotes could retain an available-looking status. | Pending refresh state, selected-currency availability, explicit last-known status, localized status/actions and 44px controls. | Existing market/denomination browser checks plus currency outage cases. |
| Indicative receipt value | Medium: future-dated timestamps could count as fresh. | Reject future or expired timestamps without substituting another currency. | Freshness regression tests. |
| Offline metadata | Medium: fallback metadata assumed two decimals for every currency. | Derive minor units and symbols locally from Intl (including JPY and KWD). | Offline precision tests. |

## Currency policy

Formatting follows the currency's region rather than applying the interface language's grouping to every currency. INR always uses Latin digits with `12,34,567.89`. USD uses `1,234,567.89`. JPY has no minor digits; KWD has three. CHF follows Swiss grouping. Shared currencies have more than one valid convention: EUR chooses a supported European language variant (English uses Ireland), CHF supports French/Italian Swiss variants, and CAD supports French/English Canadian variants. Other currency regions use the runtime's Unicode locale data. Cross-border XAF/XOF/XPF/XCD and Caribbean guilder exceptions are explicit. Latin digits remain consistent with the wallet's numeric input system. Group glyphs can differ between ICU versions, such as the Swiss straight/curly apostrophe.

Input state uses a canonical dot decimal without live grouping while typing. Display formatting never changes SDK atomic units, Bitcoin balances, token precision, destination binding or fees. Stablecoin units remain token amounts; this review does not invent a fiat conversion or assume a peg.

## Journey acceptance and boundaries

| Area | Evidence in this release | Remaining acceptance |
| --- | --- | --- |
| Entry and setup | Existing safe-origin/passkey availability gates, language choice, manual/skip guide and replay remain covered by regression. New fiat choice is contextual. | First-time usability sessions with representative users; actual platform passkey prompts. |
| Backup and recovery | Existing guarded backup entry, independent phrase verification, passkey-review distinction, wallet-scoped progress and locked/covered guide behaviour remain covered. | Physical iOS/Android migration, interrupted storage and independent restore acceptance in the release-readiness checklist. Do not treat fixture backup stand-ins as recovery proof. |
| Send, scan, receive | Destination review, input validation, fees, cancellation, error/uncertain outcome and fiat presentation are covered by existing application and safe browser suites. | Authorized funded settlement and device authentication acceptance remain separate. |
| Merchant terminal | Existing confirmation-only settlement, invoice expiry, new-charge/reset and layout checks remain in the browser suite. | Real merchant payment pilot and restart/network interruption evidence. |
| History and settings | Existing pagination/coverage, receipt details, support/recovery navigation and denomination suites remain included; currency preferences now work offline. | Native-speaker review of financial/security wording. Existing English-only secondary screens are not claimed fully translated. |
| Ramping | Existing production gates remain closed. | Production credentials, provider-approved Bitcoin mainnet pilot and signed-provider-webhook acceptance. This UX release does not declare RampNow live. |
| Security | Existing tests and CodeQL are required for the release. No changes to wallet storage keys, passkey origin, SDK version, authorization policy or secret provisioning. | The repository's security and device readiness records remain authoritative; this is not an independent penetration test or completed custody certification. |

## Verification and performance

Run `npm test`, `node --test tests/*.test.mjs`, `npm run build`, and `npm run lint`. Run the safe browser workflow, including `currency-journey.spec.ts`, across Chromium, Firefox and WebKit. It also checks the built production bundle excludes development fixtures. The local audit uses isolated Chromium with synthetic data, mobile/desktop layouts, keyboard, reduced motion and 200% CSS zoom; this is not a physical iPhone/Android test.

The change removes one independent settings metadata request, memoizes the local catalog, bounds formatter caches and adds no runtime package or external font dependency. The catalog is generated only when the relevant guide chapter is shown. Production asset sizes are recorded by the clean build. Full cold-start/LCP measurements require representative devices and networks; no million-dollar-app performance claim is inferred from a desktop build.

Release acceptance requires all mandatory CI checks, an exact-commit staged production build, artifact/source verification, live market endpoint checks and a scoped runtime error scan. Record final counts and deployed release in the pull request. Rollback affects the app artifact only; do not clear wallet data or change recovery origin.

## Primary references

- [Nielsen Norman Group: Ten usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Nielsen Norman Group: Onboarding tutorials](https://www.nngroup.com/articles/onboarding-tutorials/)
- [Parallel: product research and design systems](https://www.parallelhq.com/)
- [Unicode CLDR: number and currency patterns](https://cldr.unicode.org/translation/number-currency-formats/number-and-currency-patterns)
- [Project release-readiness checklist](../maintainers/release-readiness.md)
