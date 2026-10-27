# Transfer contours v2: review candidate

This revision responds to the too-fast, logo-covering v1 animation. It is a review candidate, not a promise of synchronized two-device settlement or tested physical-device haptics.

## Visual composition

Six independently phased, glowing orange contours travel between the actual logo border and the viewport perimeter. Their geometry starts from the rounded rectangle in the approved monogram; the S and Bitcoin paths are also traced directly from that artwork. A live mask excludes the logo interior. There is no duplicate logo, opaque screen cover or radial flash.

The settled composition lasts 4.6 seconds, with 3-second wave travel and 260 ms spacing. Pending sends retain a quieter, continuous flow. A receive starts its pending indicator only after a genuine incoming SDK `paymentPending` event. The indication is dismissible and never changes or cancels the payment. Some payment paths may not provide an early pending event. The screens still follow their own SDK events; no timer or animation asserts that the other device has acknowledged receipt.

Rendering is capped at 30 animation updates per second. Reduced motion removes travel and uses a static accent. Hidden documents pause pending decoration; completed effects do not replay on resume. Historical receipts remain static.

## Progress honesty

The SDK provides pending, completed and failed states, not a real-time numeric completion fraction. Pending uses an indeterminate progress indicator and explains that a live percentage is unavailable. Only a completed SDK payment receipt renders 100%. There is no invented 0–99% counter and no delay to the actual payment to match visual timing. Unknown and failed outcomes never reach 100%.

## Result-triggered vibration

Feedback is decoupled from animation time: a completed event requests a 70 ms vibration in supported foreground browsers, a definitive failure requests [80,60,100] ms and Test vibration requests 120 ms. The native Capacitor implementation requests success/error notification feedback. Shared receipt keys suppress duplicate event/result feedback. Opt-out, missing APIs, activation restrictions and hidden documents are respected.

A browser accepting the request is not proof a physical motor operated. The test control explicitly says this. Android browser and OS support vary; missing `userActivation` metadata no longer silently disables an otherwise supported API. iOS Safari does not expose the standard vibration API. Home-screen Web Push is a separate permission-based notification system and is not implemented or bypassed by this change. No physical phone or funded cross-device transfer has been verified here.

## No-wallet preview

`node scripts/build-motion-preview.mjs` builds an isolated interactive studio to `motion-preview-dist`. It imports the same UI and feedback code, with manual synthetic states and no SDK connection, signing, seed entry or payment creation. Its environment prefix prevents VITE wallet configuration from being injected. Pending stays pending until a user chooses a confirmed preview state.

## Scope and tests

No custody, signing, recovery, fee or payment-execution logic is modified. SDK hooks only request presentation feedback and keep their existing outcome decisions. New tests cover exact border geometry, pending/settled separation, actual incoming events, receipt deduplication, browser capability reporting, reduced motion and manual vibration/error requests. The standard cross-browser CI includes `transfer-pulse.spec.ts`; local checks must be distinguished from physical-device verification.
