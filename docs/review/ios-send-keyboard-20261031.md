# Send keyboard and magnification review, 31 October 2026

An iPhone portrait report described automatic magnification on focus followed by a frozen-looking sheet with the field outside the visible area. The prior browser fixture did not initialize the production viewport manager and therefore could not expose its interaction with sheet keyboard handling.

## Findings and changes

- The recipient textarea used `text-sm`, rendering at 14px. Send fields now have a 16px floor with rem-based enlargement. Pinch zoom remains enabled.
- The page viewport manager translated `#root`, global CSS lifted every sheet by the keyboard height and the sheet added keyboard height plus 64px of padding. These overlapping adjustments used different coordinate systems. Web sheets now fit the actual visible height with one geometry owner; they no longer translate the page or add the keyboard height as padding.
- Focus reveal previously checked only the lower edge and used a smooth scroll while the keyboard and sheet were moving. It now checks both edges against the actual scrollport and applies the correction directly after focus/viewport/scrollport changes.
- Content drag handling could constrain scrolling. Web content now permits vertical scrolling in both directions and pinch zoom; the handle retains sheet dragging.
- Pinch zoom is distinguished from keyboard shrink using the viewport scale. A stale iOS dismissal offset no longer displaces the restored full-height sheet. The manager can sleep after editing ends even when Safari retains an offset.

## Verification

The first candidate passed 1,319 application tests, 149 server tests, type checking, lint and the production build locally. The isolated portrait preview exercised recipient, amount and optional-comment editing without a real wallet or payment. Browser CI executes keyboard geometry cases across Chromium, Firefox and WebKit at 320, 375, 390 and 430px widths, plus enlarged-text and pinch-zoom cases. The fixture now starts the production viewport manager. CI run and release status are recorded in PR #81 rather than assumed here.

## Acceptance boundary

Desktop browser automation injects VisualViewport events. It cannot exercise an iPhone system keyboard, native autofill accessory bar, physical gestures or every iOS browser/PWA version. The physical-device check is to open Send in portrait, type a recipient, continue to amount, switch between amount and comment, dismiss/reopen the keyboard, use larger text and pinch zoom, then close/reopen Send. Fields must remain reachable and amounts must remain unchanged. No payment is required for this layout acceptance.

The native Capacitor keyboard-resize path, transaction authorization, wallet keys, storage and migration are outside this change.
