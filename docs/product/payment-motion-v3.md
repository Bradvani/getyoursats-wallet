# Payment sequence v3: visual review candidate

Continue PR #61, not a new wallet/security branch. This is not a production release approval.

## One payment screen

`TransferExperience` owns the processing, success and interrupted states. `SendPaymentDialog` keeps a stable operation ID and component across its processing/result change. Its hook records preparation and the start of the SDK call; it does not change the call, fees, status classification or execution guard. Incoming pending events and completed receipts reuse an SDK-payment-ID-keyed presentation record, so the receive waveform resumes rather than restarting.

The user may return to the wallet while awaiting a result. That action dismisses presentation only. It does not cancel, resend or roll back the SDK operation. Refund/auth screens are not promoted to payment completion.

## Percentage: completed workflow steps, not percentage of funds

The display is labelled **Payment steps** with a visible explanation that these are completed steps, not elapsed time or an estimate of funds settled. It has four stage checkpoints:

| Display | Evidence |
| --- | --- |
| 25% | The app entered the already-reviewed transfer preparation stage. |
| 50% | The app started the SDK execution request. This is not acknowledgment of recipient credit. |
| 75% | A genuine incoming `paymentPending` event is available for that payment ID. |
| 100% | A completed SDK receipt with a stable ID exists. |

Not every rail exposes every intermediate event; a send may go from 50% directly to 100%. No timer increments these values. Unknown/failed outcomes preserve the last observed checkpoint below 100%, stop the trajectory and show distinct wording. A completed phase without a receipt ID is treated as unknown. These percentages do not estimate blockchain confirmations, probability of success or time remaining.

## Geometry and logo

The main composition is a single one-way burst. Five staggered wavy strokes use 5px cores plus 19px blurred glow. The final sixth contour sweeps into solid Bitcoin orange only after confirmation. Pending travel stops at its stage boundary; it never loops. A confirmed sequence can take approximately 5.6 seconds from its beginning; receipt and controls stay available independently of the drawing clock. Failure/unknown never receive an orange success wash.

The approved S, coin and Bitcoin paths are inline SVG, with fixed positions and no raster image, tracing, scaling, rotation animation or logo filters. Only the B glyph is clipped to an orange fill: filling inward for receive and draining outward for send with the same sequence position. Android/high-density quality was checked by browser emulation, not by a physical Android handset.

## Accessibility and lifecycle

Reduced motion keeps the stage number/status but skips travelling waves and the full-screen fill. Keyboard focus remains within the open payment screen; Escape/Return to wallet only dismisses it. Hidden documents pause the drawing clock. A bounded session-memory record stores only presentation state and public payment IDs, not wallets, addresses, secrets or authoritative payment state. It is not a financial journal or a substitute for the operation gateway.

Haptics retain v2's result-triggered, capability-dependent behavior. iOS web vibration is not implemented, no push-notification workaround is claimed, and no physical motor test was performed.

## Preview and verification boundary

The no-wallet studio includes automatic *synthetic event* scripts and manual Request started / Awaiting confirmation / Confirm / Fail mid-flow / Mark unknown controls. Automatic timers exist only in the isolated fixture, not the wallet SDK event flow. The staged demo is not a real two-device settlement or synchronization test.

Unit/component tests verify frozen percentages, interruption, no receipt/no success, the single-instance send/result integration, original receive ownership and incoming continuity. Browser cases check sender/receiver at phone/desktop dimensions, thick glow geometry, full-orange completion, logo fill/drain, high-DPI vector rendering, failure/unknown freeze, no looping, reduced motion and vibration request patterns. Live funds, hardware motors and physical device performance remain outside these automated tests.
