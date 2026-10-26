# GetYourSats engineering guidance

Audience: maintainers and coding tools. This file describes repository conventions, not public product claims or release approval. Start with [CONTRIBUTING.md](CONTRIBUTING.md), [product boundaries](GETYOURSATS.md) and [release readiness](docs/maintainers/release-readiness.md).

## Project Overview

GetYourSats is a Bitcoin/Lightning wallet built with React, TypeScript and Vite, using the Breez Spark SDK (WASM). It builds on the MIT-licensed Glow web implementation; retain upstream attribution.

## Comment Style

Same standard as spark-sdk's CLAUDE.md "Comment Style" section, condensed for this repo. Applies to any new or modified comment, JSDoc, commit message, or PR description.

0. **No em-dashes or en-dashes** anywhere (code, comments, commits, PRs). Use a colon for an aside, a period between independent clauses, comma + conjunction for contrast, parentheses for a parenthetical, "to" for ranges (`3 to 5 lines`).
1. **Cut what the code already says.** Default to no comment. Add one only for a non-obvious WHY: a hidden constraint, a workaround, a subtle invariant, surprising behavior. When a signature changes, audit nearby JSDoc for params/fields that no longer exist.
2. **Compact what stays.** Target 3 to 5 lines. Longer means it wants to be a linked doc, not an inline essay. No multi-paragraph docstrings.
3. **Calibrate to the reader.** Internal `//` comments: why the code is shaped this way, for whoever maintains the file. Commit messages and PR bodies: what changed and why, not what the code looks like.
4. **Don't leak internal-looking specifics.** No production identifiers, stack-trace excerpts, or one-off debugging breadcrumbs in committed comments. This covers commit trailers: no agent-session links or AI-attribution (`Claude-Session:`, `Co-authored-by: Claude`) on commits or PRs. Strip them even when a tool adds them by default, because an orphaned commit stays addressable by SHA and a later rewrite cannot take it back.
5. **Strip narrative; keep implementation facts.** No development history ("we used to..."), no PR-credit ("added for #1234"). State workarounds as present-tense facts: "Uses `bar()`: `foo()` deadlocks on the main thread." Pointers to active context are fine (an open upstream bug, a spec section, the issue a defense exists for, e.g. `(#213)`). Decision history belongs in the commit message.
6. **Frame what something IS,** not what happens downstream and not what lives elsewhere. Don't restate the type; document what `undefined`/absence means at the domain level.

## SDK integration and local development

- `src/hooks/useBreezSdk.ts` owns connection, reconnection, events and wallet data refresh.
- `src/contexts/WalletContext.tsx` provides the current SDK client through `useWallet()`.
- `src/main.tsx` and `src/services/sdkReady.ts` coordinate startup and WASM readiness.
- `vendor/SOURCE_COMMIT` identifies the SDK source reference; `package.json` uses the vendored tarball, not an assumed npm release.

The current client exposure is an implementation fact, not permission to add unrestricted value-moving calls. New sends, conversions, refunds, claims, migrations and exit operations require an explicit authorization and reconciliation policy. Coordinate with the security implementation under review. An SDK payment observer is not a universal spending-security boundary.

Read-only calls may use the current client:

```tsx
const wallet = useWallet();
const info = await wallet.getInfo({});
const parsed = await wallet.parse(input);
```

Use a separate disposable SDK checkout for experiments. Follow the pinned upstream build instructions, record the exact SDK revision and patch, and inspect the installed type declarations. Do not assume a developer-specific filesystem path or silently replace the vendored package with an npm pre-release. Restore locked dependencies with `npm ci` after local experiments.

Use a topic branch from the agreed base. Record source/artifact hashes and focused tests in SDK-related PRs. Deployment targets and environment configuration belong in the [deployment guide](docs/maintainers/deployment.md). `VITE_STAGING_PASSWORD` is public client code, not private-preview access control.

## Common tasks

### Adding Side Menu Items
1. Add prop to `SideMenuProps` interface in `src/components/SideMenu.tsx`
2. Add to `menuItems` array in SideMenu component
3. Add prop to `WalletPageProps` in `src/pages/WalletPage.tsx`
4. Pass prop through WalletPage to SideMenu
5. Add screen type and case in `src/App.tsx`

### Adding Passkey & Labels items

The Settings → Passkey entry opens the **Passkey & Labels** hub at `src/pages/PasskeySettingsPage.tsx`. The hub has three sub-pages:

- Passkey: `src/pages/PasskeyManagementPage.tsx`
- Labels: `src/pages/LabelsPage.tsx`
- Local State: `src/pages/PasskeyLocalStatePage.tsx`

**Screen wiring (in `src/App.tsx`):**
The screen types `'passkeySettings'`, `'passkeyManagement'`, `'labels'`, and `'passkeyLocalState'` each layer on top of `renderSettingsPage()` + `renderPasskeySettingsPage()` so the back stack stays consistent.

**Adding a new sub-page to the hub:**
1. Create the page under `src/pages/`
2. Register a row inside `PasskeySettingsPage.tsx` that navigates to the new screen
3. Add a screen type string in `src/App.tsx` and a case that renders the new page on top of `renderPasskeySettingsPage()`

**Dev gating:**
The Settings entry is gated behind `isDevMode` (toggled via `useSecretTap`). Keep new hub items dev-only until they are ready for production.

**Switching active passkey label:**
Use `sdk.switchPasskeyLabel(label)` from `useBreezSdk` to switch the active label without bouncing through the home page. This triggers a fresh PRF prompt and reconnects the SDK with the new label.

```tsx
const { sdk } = useBreezSdk();
await sdk.switchPasskeyLabel(nextLabel);
```

### Passkey Metadata

Per-device passkey metadata lives in `src/services/passkeyService.ts` and `src/services/passkeyMetadata.ts`, persisted in `localStorage`:

Device-level keys (`passkeyService.ts`):

- `passkeyRegistered`: this device has ever successfully used a passkey
- `passkeyLabel`: active wallet label for the current passkey session
- `passkeyActiveCredentialId`: the cred we last signed in with; passed back as `allowCredentials` to pin the next derive
- `passkeyActiveCredentialRpId`: the RP ID that cred lives under; a ceremony targeting a different RP treats the pin as absent (a cross-RP pin never matches and dead-ends the OS sheet)
- `passkeyFirstSeenAt` / `passkeyLastSeenAt`: device-level timestamps for the first / most recent PRF ceremony
- `passkeyPendingSwitchFromCredentialId`: the cred we were signed in with before a switch attempt, used by the switch-recovery branch in `PasskeyPage`
- `passkeyAaguid:<credId>` / `passkeyBackupEligible:<credId>`: provider AAGUID + BE flag captured at create time, drives the provider icon + sync indicator in the management page
- `passkeyLabelLastUsed:<label>`: per-label last-used timestamp, surfaces on `LabelsPage` as a relative hint

Per-credential metadata keys (`passkeyMetadata.ts`):

- `passkeyCredFirstSeenAt:<credId>` / `passkeyCredLastSeenAt:<credId>`: per-credential timestamps
- `passkeyUserName:<credId>`: per-credential picker label captured at create
- `passkeyHiddenCredentials`: JSON array of credential IDs the user opted to hide from the management page

The credential-IDs list itself is owned by the app, not the SDK (the SDK no longer tracks credentials). On web it lives in `LocalStorageCredentialRegistry` (`src/services/localStorageCredentialRegistry.ts`), one `localStorage` key per RP; on native the Capacitor passkey plugin owns it (Keychain / Block Store). Reach it via `getKnownCredentialIdsBase64()` (`passkeyService.ts`), which wraps `getPasskey().credentials().get()`.

Call `markPasskeyUsed()` after any successful PRF ceremony to update `passkeyLastSeenAt` (and seed `passkeyFirstSeenAt` on first use); `markCredentialUsed(credentialId)` does the per-credential equivalent.

### Build Notes
- `npm run dev` works with npm-linked SDK packages
- `npm run build` may fail with linked packages (vite polyfill resolution)
- Production builds require npm-published SDK version
- Type check: `npx tsc --noEmit`

## UI Conventions

The other UI sections are structural: which component to reuse, where to
register a screen. These are the editorial ones, collected from design
review so a decision gets made once and then applies to every flow.

They rest on five kinds of authority, and the tier decides who wins when
two of them disagree. A measurement beats a heuristic, a heuristic beats a
preference, and a preference everyone follows still beats a coin flip.

**Testable.** Pass or fail, and a machine can tell which.

- **WCAG 2.2** (W3C, 2023). 1.4.1 nothing rides on color alone. 2.5.8
  targets are 24px and 2.5.5 wants 44. 3.3.8 never makes the user
  transcribe or memorise to authenticate, so paste always works. Text
  contrast (1.4.3) and reduced motion (2.3.3) are open: both need a token
  or stylesheet change first, so they get their own PR. Do not write
  rules for them here.
- **Core Web Vitals** (Google; INP replaced FID in 2024). A tap answers
  inside 200ms or shows that it heard. The modern, measurable form of the
  400ms response threshold (Doherty & Thadani, IBM, 1982).

**Predictive.** Models that give a number before the screen exists.

- **Fitts's law** (Fitts, 1954). Time to hit a target falls with its size
  and nearness, so the primary action is large and at the bottom.
- **How phones are actually held** (Hoober, 2013; 1,333 observations:
  49% one-handed, 36% cradled). Design the bottom third for one thumb,
  and keep irreversible actions out of its sweep.

**Evidence, applied by analogy.** The findings are solid; the jump to a
screen is ours to defend.

- **Cognitive load** (Sweller, 1988 onward). Cut what the task does not
  need. This is one decision, one row.
- **Chunking** (Miller, 1956; Cowan, 2001). Grouped digits read in one
  pass, which is what the space separator buys.
- **Isolation effect** (von Restorff, 1933). The item that differs is the
  one remembered: one accent, one focus.
- **Proximity and common region** (Wertheimer, 1923; Palmer, 1992). Cause
  above effect, close enough to take in together.
- **Credibility is judged on appearance** (Fogg et al., 2003; 2,684
  people, 46% of credibility comments were about visual design). A screen
  that looks unlike the rest of the app reads as less safe, so in a wallet
  consistency is a security property, not a finish.
- **What goes wrong in crypto wallets** (Eskandari et al., 2015;
  Krombholz et al., 2016; Mai et al., SOUPS 2020; Voskobojnikov et al.,
  CHI 2021). People hold wrong mental models of where funds sit and what
  can be undone, and they lose money at backup and recovery. So: say what
  is irreversible before the action, name every state in words, and build
  recovery as a first-class flow.

**Inspection vocabulary.** Names for recurring notes. Two reviewers using
these agree on 5% to 65% of what they find (Hertzum & Jacobsen, 2003), so
they frame a concern, they do not settle it.

- **Nielsen's heuristics** (Nielsen, 1994): visibility of system status,
  speak the user's language, consistency and standards, error prevention,
  recognition over recall, aesthetic and minimalist design.
- **No deceptive patterns** (Brignull, 2023; Mathur et al., 2019; Gray et
  al., 2018; EU DSA Art. 25). No confirmshaming, no manufactured urgency,
  no pre-ticked consent. The one that bites self-custody is obstruction:
  leaving has to be as easy as arriving, which is what the account
  deletion guide and the unilateral exit are for.
- **Inclusive design** (Microsoft, 2016). The limit is usually
  situational, not permanent: one hand full, bright sun, a hurry, a panic.

**House style.** Ours. No research behind it, binding anyway, because
consistency is the whole of the argument. The groups below are this tier:
casing, copy length, no decorative icons, no red. They are preferences, so
argue them as preferences: a citation adds nothing here.

**Copy**

- Labels are Title Case, prose is sentence case. A label names a thing:
  the page title in the app bar, a CTA, a dialog that names the action.
  "Unilateral Exit", "Build Exit", "Delete Contact", "Export Database".
  All eleven page titles already read this way.
- Anything phrased as a sentence or a question keeps sentence case, even
  as a title: "Switch label?", "Erase and start over", "Sign-in failed",
  "Try a normal withdrawal first". So do section headings, body, field
  labels and helper text.
- A sentence earns its place by telling the user something the screen
  cannot. On the exit quote screen "To start the process you need to pay
  the exit fee. These are the mining fees required to move the Spark tree
  on-chain." stays: it says why the money leaves. Under an address field
  "Every exited sat is swept to this address" goes, and under a fee slider
  "A higher rate costs more" goes: the control already said it. Default to
  no sentence, and read the screen without it before keeping it.
- Write from where the user stands, not from the system. "From another
  wallet, to pay mining fees. Not part of what you receive" lists
  mechanics and leaves them to work out what it means for them. Say what
  they have to do, and what it costs them.
- An error names what the user was doing and what to do next, in one
  voice: "Could not create the invoice. Please try again." Not "Failed to
  create invoice", which is the system reporting its own state and leaves
  them nowhere to go.

**Chrome**

- No decorative icons: not above a feature page's title, which already
  says what the page is, and not in an `AlertCard`, where a generic glyph
  repeats the title and narrows the body. Icons that carry meaning stay:
  a row chevron, a copy button, a payment method.
- A secondary action can take its own row under the primary CTA instead
  of sitting beside it. Give the primary the width when the choice is not
  symmetric. In a sheet, Back is not a button at all: pass the handler to
  `useSheetBack` and it becomes the header arrow.
- Every amount goes through `SatAmount`, hero displays included. A
  missing ₿ or a hand-grouped number is the first thing anyone notices on
  a screen about money. The amount rules are below.
- Use the accent for one thing. A screen with no `spark-primary` reads
  unfinished, and a screen where several elements are amber has no
  emphasis left. Give it to the amount being confirmed or the action the
  user came for; everything else is `spark-text-primary` /
  `spark-text-secondary` / `spark-text-muted`, in that order.
- No state rides on color or motion alone. A state worth showing gets a
  word: the failed and processing chips in `TransactionList` are the
  pattern, the unlabelled pulsing dot beside a pending payment is not
  (WCAG 1.4.1).
- No floating text. A sentence that has to be on screen gets a container:
  an `AlertCard`, a row's detail line, a field's helper. Prose sitting loose
  between cards belongs to nothing, reads as an afterthought, and is the
  first thing to go stale when the screen around it changes. Ask first
  whether the screen already says it, which it usually does.
- No success toast for money arriving or a claim going through. The
  balance and the payments list carry it, and a payment arriving gets the
  celebration, so a toast on top is the same news again over a screen
  already showing it. Toasts carry what no screen does: a copy
  confirmation, or a failure.

**Layout**

- A new tab or sheet matches the ones beside it. Padding and height come
  from the container: `BottomSheetCard` already gives its content
  `px-6 pt-3` and the safe-area bottom pad, so content adds no outer
  padding of its own and sets no fixed height. The height rules are in
  Bottom Sheets below.
- Put a control above what it changes. Switching Priority to Standard
  rewrites the fee breakdown, so the switch goes above the breakdown: a
  user who has scrolled past a number should never be the one to notice
  it moved. The name for this is visibility of system status; in a layout
  it comes down to cause above effect, close enough to see both at once.
- One decision, one row. `FeeRateSelector` is the shape: the options sit
  side by side, each one a label and a single line of detail. Stacking
  name, ETA and fee spends triple the height on a choice that turns on
  two numbers. Every row a screen does not have is a row nobody reads.
- A full page uses one of the two shells rather than its own scaffolding:
  `PageLayout` or `SlideInPage` (`src/components/layout/`). Back belongs
  to the shell's app bar, and a primary action belongs in the shell's
  `footer`, which is pinned above the safe area. A CTA inside the scroll
  area moves with the content, and a CTA that moves is one the user has to
  hunt for. `GetRefundPage` is the exception: it opens in `SlideInPage`
  but renders its buttons inline. New flows follow the shells rather than
  copy it.
- Tap targets are at least 44px on their short side, and the primary CTA
  keeps the full width at the bottom of the screen, where the thumb is
  (Fitts, 1954; Apple HIG; WCAG 2.5.5).
- Some positions are fixed: on the settings page the Account section
  stays last, above the version line. New sections go above it.

**Reuse**

- A new screen should need no new component, color or text style. Read
  `src/components/ui/index.tsx` first: buttons, rows, tabs, dialogs,
  sheets and alerts are already there, and `spark-*` holds the colors. If
  nothing fits, that is worth raising, not worth a local one-off.
- One format, one helper: `SatAmount` and `formatWithSpaces` for amounts,
  `truncateAddress` for addresses (`start...end`, never a CSS `truncate`,
  which eats the tail the user checks). A formatter written inside a
  component is how the second shape starts, so export it instead.

## Colors: no red

The UI deliberately does not use red, even for destructive, warning, or
error states. Use the primary color (`spark-primary`, an amber/tan
`#d4a574`) instead. This was a deliberate rebrand (PR #287, "replace red
UI with primary color").

- `spark-warning` and `spark-error` both resolve to the amber palette,
  not red: `--color-spark-warning: var(--spark-primary)`, and the
  `spark-warn-*` tokens (`warn-surface`, `warn-border`, `warn-title`,
  `warn-text`) are amber-toned. Use these for warning/danger surfaces.
- `ConfirmDialog`'s `variant="danger"` renders as `bg-spark-primary`, not
  red. `AlertCard`'s `warning` / `error` variants use the amber
  `spark-warn-*` tokens.
- The raw `#ef4444` red is still defined as `--spark-error` but is unused
  in components; do not reach for it, `text-red-*` / `bg-red-*`, or any
  hard-coded red hex.
- Applies to standalone HTML in `public/` too (e.g. the account-deletion
  guide): warning boxes use the amber accent, never red.

## Monetary units

Use `SatAmount` (`src/components/SatAmount.tsx`) for satoshi values in JSX. It supplies space-grouped digits, the mono font and the explicit `sats` unit. Use the Bitcoin symbol only with BTC values, never as a prefix for a number of sats.

```tsx
<SatAmount sats={amount} />
setError(`Amount must be at least ${formatWithSpaces(minSats)} sats`);
```

Keep token tickers, networks and fee units explicit. Preserve integer/bigint precision through SDK boundaries. Use the shared formatters rather than reconstructing amounts in components; monetary formatting changes require unit and fee-display checks.

## Icons

All SVG icons live in `src/components/Icons.tsx` as named React components. **Never add inline `<svg>` elements** — always add a new component to `Icons.tsx` and import it.

```tsx
// Adding a new icon:
export const MyIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="..." />
  </svg>
);

// Using an icon:
import { MyIcon } from '../components/Icons';
<MyIcon size="sm" className="text-spark-primary" />
```

**Sizes:** `xs`=w-3, `sm`=w-4, `md`=w-5, `lg`=w-6, `xl`=w-8. For non-standard sizes, override via `className`.

**Note:** Animated SVGs internal to a single component (e.g., `LoadingSpinner`, `ProcessingStep`) can stay in that component. The rule applies to reusable icons — always define them in `Icons.tsx`.

## Bottom Sheets

`BottomSheetContainer` / `BottomSheetCard` (`src/components/ui/sheets/BottomSheet.tsx`) wrap react-modal-sheet, which **snaps by translating a full-height sheet, not resizing it**. So at a partial (compact) snap the sheet's bottom sits below the viewport: `position: sticky bottom-0` and `position: fixed` are off-screen there (a `sticky top-0` header still works, and `fixed` is trapped by the sheet's transform anyway).

**Scrollable content with a title/actions that must stay visible** (e.g. the cross-chain network picker in `CrossChainWorkflow.tsx`): don't let content overflow into a partial snap. Bound it so the sheet is content-sized and fully on screen, no sticky needed:

- Cap the scroll area (`flex-1 min-h-0 overflow-y-auto`); keep the title/actions as `shrink-0` siblings above/below it.
- Size the cap in **`dvh`, not `vh`**. `vh` is the largest (URL-bar-hidden) viewport, so a `vh` cap overflows the visible sheet on real mobile (fine on desktop + device simulator, which is the trap).
- Call **`useSheetOwnsScroll()`** in the step. The library arbitrates drag against its OWN scroller, which a capped inner list leaves unscrollable, so without this the sheet stays draggable over the list and every swipe is a race between scrolling and closing the card. The hook takes the drag off the content area (the handle, backdrop and close button still dismiss) and replaces the `pan-down` touch-action the library pairs with the drag, which otherwise intersects the list's `pan-y` down to "downward only": flaky on iOS, immovable on Android. A workflow that owns scrolling only on some steps passes a flag, `useSheetOwnsScroll(step === 'provider')`; registrations are counted, so a step component inside such a workflow can register too.
- Add **`overscroll-y-none`** and **`touch-pan-y`** to the inner scroller, or on iOS it chains its scroll into the sheet's drag (the sheet's own scroller sets these; a nested one doesn't inherit them).
- To grow the area when the sheet is dragged to full, read **`useSheetFullSnap()`** and raise the cap; a freeze guard in the container stops the growing content from flipping the snap ladder.

The funded send/cross-chain flow isn't reachable locally; debug sheet layout with a throwaway `?sheettest` harness in `main.tsx` + browser measurement.

## Logging Practices

The app uses a structured logging service (`src/services/logger.ts`) following OWASP guidelines.

### Log Levels
- `DEBUG`: Detailed diagnostic info (dev only)
- `INFO`: Normal operations (initialization, successful payments)
- `WARN`: Recoverable issues (validation failures, retries)
- `ERROR`: Failures requiring attention (SDK errors, payment failures)

### Categories
- `auth`: Authentication events
- `payment`: Payment operations
- `sdk`: SDK lifecycle and operations
- `ui`: User interactions
- `session`: Session start/end
- `validation`: Input validation

### Usage
```typescript
import { logger, LogCategory } from '../services/logger';

// Basic logging
logger.info(LogCategory.PAYMENT, 'Payment initiated', { type: 'lightning' });
logger.error(LogCategory.SDK, 'Operation failed', { operation: 'sendPayment', error: errorMsg });

// Security event helpers
logger.authSuccess('mnemonic');
logger.authFailure('mnemonic', 'Invalid format');
logger.paymentInitiated('lightning');
logger.paymentCompleted('lightning');
logger.paymentFailed('lightning', errorMsg);
```

### Security Rules (NEVER log)
- Mnemonics, seeds, private keys
- Passwords, passphrases
- API keys, tokens
- Payment hashes, preimages
- Full bolt11 invoices

The logger automatically redacts these if accidentally passed in context.
