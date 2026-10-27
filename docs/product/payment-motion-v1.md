# GetYourSats premium transfer pulse

## Shipped composition

`src/components/PaymentMotion.tsx` retains compact pending/failure and receipt artwork. A successful, non-compact, non-historical receipt with a stable SDK payment ID mounts `TransferPulse.tsx` into a body portal. The portal is decorative and pointer-transparent, so transformed bottom sheets do not clip the bezel light and controls remain accessible.

- Sender: approved `/brand/monogram.svg` starts monochrome at the viewport centre. One soft orange wave expands outward, energizes the screen edge and dissolves into the exact completed-payment receipt.
- Receiver: flowing orange perimeter light advances inward around a closing dark aperture. The logo resolves at the centre and the completed receipt remains visible.
- Duration: 1,250 ms, one continuous pulse, no strobe. The effects are paired visual directions, **not a synchronized cross-device communication protocol**. Each device follows its own SDK confirmation.
- Pending/converting stays pending until the SDK changes it. Unknown results never celebrate. Auth success and refund broadcast acknowledgments do not masquerade as completed transfers.
- The sender amount is read from the completed SDK payment, with asset-aware formatting. No invented balances, counting-up value or settlement timer.

## Ownership and repeat suppression

The send result uses `paymentOutcome` unchanged and passes the completed receipt only for presentation. Incoming confirmations remain owned by the existing SDK event/newly-completed-receive handler; initial history remains silent. POS history continues to use static artwork and does not launch the full pulse. A bounded, memory-only set of direction/payment IDs suppresses competing receipt surfaces and React remount replays. This is UI deduplication, not financial idempotency.

Backgrounding, pagehide, owner unmount and a reduced-motion preference change stop the effect and future haptic accents. Returning from the background does not replay an already-presented pulse. A receipt first delivered while hidden can still appear through the existing foreground-aware global receipt owner.

## Haptics and accessibility

`transferHaptics.ts` schedules a Light impact at ignition and a second restrained accent at outward/inward arrival (650/760 ms). It uses the existing Capacitor plugin in native builds and a 12 ms best-effort vibration on browsers exposing `navigator.vibrate` after user activation. Unsupported hardware/APIs, denied calls, browser restrictions and device settings are silent no-ops. No web workaround promises iPhone Safari vibration. No hardware haptic test was performed by automated browser fixtures.

Settings > Display includes Payment haptics in all ten existing app languages. The setting is local and independent from wallet/security state. Reduced motion uses a short static border-only accent with at most one haptic, no fill/scale/travel. Forced-colours hides decorative light. Full receipt content and close controls remain accessible independently of the visual timer.

## Verification

`TransferPulse.test.tsx`, `PaymentCelebration.test.tsx` and `transferHaptics.test.ts` cover receipt eligibility, direction, owner deduplication, StrictMode, hidden documents, cancellation, reduced motion, hardware errors, user opt-out and unknown/auth/refund exclusion. `e2e/tests/transfer-pulse.spec.ts` exercises the real CSS at mobile/desktop widths plus reduced motion and pointer-transparent controls. CI runs these in Chromium, Firefox and WebKit.

Browser fixtures use synthetic public display data and no wallet connection. They do not claim a real payment, haptic-motor test or coordinated two-device settlement test. No signer, vault, operation gateway, recovery credential or fee computation is changed by this release.
