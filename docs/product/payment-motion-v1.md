# GetYourSats · Payment Motion v1

**Status:** Implementation specification · 25 October 2026  
**Product surfaces:** Wallet Send, Wallet Receive, merchant Point of Sale (POS), delayed settlement recovery  
**Design language:** GetYourSats approved monogram, Bitcoin orange `#F7931A`, near black `#0B0B0B`, warm white `#FAF9F6`  
**Scope boundary:** Visual feedback only. Never modify keys, signing, payment methods, amounts, routes, quote fees or settlement authority.

## 1. Objective

Every money-moving action should communicate its real state clearly and feel recognizably GetYourSats. Replace generic loaders and silent POS confirmations with a coherent **Orange Lightning Flash** language. The lightning stroke points **outward** for sends and **inward** for receives, illuminates the existing brand monogram and resolves into the final state.

The experience must be polished but calm: no confetti, no casino-style rewards, no full-screen strobe, no fake sound and no animation that obscures transaction truth.

## 2. Product requirements

### 2.1 Sending

| Source of truth | UI treatment | Exit |
|---|---|---|
| User approved quote and the SDK call is in flight | Subtle looping orange line + directional outward trace, “Sending…” (or “Converting…” when SDK actually is converting) | SDK terminal state |
| SDK send operation confirms success | A single outward lightning sweep, localized orange glow and monogram reveal; “Payment sent”; exact amount and verified receipt details if known | User Done |
| SDK returns failure | Red-neutral restrained failure mark, explanation and Close; no success flash, no confetti | User Close |
| Sheet dismissed during payment | SDK event may report completed send via the existing global outcome overlay; never assume that dismissal means failure | Event or activity history |

No spinner timeouts may declare a successful transaction. The Send sheet remains authoritative for operations that it owns.

### 2.2 Receiving and wallet-home

- Trigger the global payment moment **only** on a new `paymentSucceeded` SDK event for a completed **incoming** payment, or a new completed incoming payment discovered during a subsequent wallet sync while the same wallet session is active.
- Initial wallet connection/history hydration is a **silent baseline**, not a flood of notifications.
- De-duplicate by payment ID across SDK event and sync paths. Do not reanimate the same payment after unrelated refreshes or app state updates.
- Do not celebrate intermediate conversion payment legs (including ongoing AMM/conversion receipts).
- The incoming direction runs toward the center, and the final amount appears with the appropriate denomination (sats / supported token).
- Only display “Payment received” once settlement has been confirmed by the SDK. A pending deposit or a QR merely being generated must never trigger success.

### 2.3 Merchant POS

- **Charge created:** show the actual SDK BOLT11 QR with brand mark, amount and “Waiting for payment”; no success flash yet.
- **Paid:** transition the invoice region to the received-state lightning flash, monogram, confirmed amount and “Payment confirmed by the wallet.” Keep New charge and history actions available.
- **Reopened charge:** show the success state if and only if the connected wallet's completed payment history has verified that exact order; do not animate an old paid order on every revisit.
- **Network delay or failure:** retain QR/Copy invoice and explain the unconfirmed status; never synthesize a payment.
- POS must remain usable on small phones and iOS standalone PWA mode.

### 2.4 Presentation

- A shared `PaymentMotion` component supplies direction, stroke and light for `sending`, `receiving`, `converting`, `sent`, `received` and `failed` states.
- For terminal success, animate a central *existing* `/brand/monogram.svg` asset, not a freshly invented logo.
- Directional line draws and local glow should occupy roughly 0.5–1.2 seconds; no full-screen white flash.
- A passive global receipt celebration stays visible for a few seconds of **foreground** time, pauses on hidden/background tabs, and has an explicit Done action.
- Do not add audible feedback by default. One existing, light native haptic at completed event is sufficient. No haptic on browser and no repeated POS haptic when the global event also fires.
- Observe `prefers-reduced-motion: reduce`: stop looping, remove streak/flash and present the final legible icon and text immediately.
- Keep amount, state text and Done controls readable on phone viewports (320, 360, 390 and 430 px) and desktop. Avoid horizontal overflow.

## 3. State and integration architecture

```text
User confirms Send  →  SDK processing  →  confirmed success / failure
                                        ↘ if sheet dismissed: SDK event overlay

POS Charge           →  real payable BOLT11 QR  →  SDK matching paymentSucceeded
                                             or verified reconciled paid order
                                             →  local received state

Wallet background receive  →  SDK event OR new settled receipt during sync
                         →  payment-ID de-dupe  →  global payment moment
```

The only sources of settlement are Breez SDK responses/events and matching completed wallet history. UI timers only dismiss presentation; they are never financial state transitions.

## 4. Privacy and trust constraints

- No logging private keys, seeds, invoices, preimages, recipient addresses or other secret-shaped payment details from animations.
- No extra transaction signing, SDK listeners per component or fee adjustments.
- No fake confetti or success in pending state. No paid receipt on the merchant's local click alone.
- A visual success mark is **not** a PIN/Face ID authorization control and does not close the separate P0 imported-wallet security gap.
- Offline and low-connectivity states must retain the truthful pending state until SDK confirmation.

## 5. Acceptance criteria

1. **Send:** active outward state while SDK is in flight, one terminal success flash on SDK confirmation, and zero success flashes on rejected sends.
2. **Receive:** one incoming moment per newly settled incoming payment; no first-login historical replay; late SDK-event and sync double reports are de-duplicated.
3. **POS:** after Charge, the branded QR is visible; after a wallet-confirmed payment, the QR changes to a branded received confirmation. Unpaid orders never enter success state.
4. **Background:** passive receipt timer does not silently consume the entire display duration in a hidden tab.
5. **Accessibility:** all essential states remain understandable with reduced motion, readable text and non-color indicators.
6. **Regression:** TypeScript, lint, unit, CodeQL, browser smoke and production build pass. Include explicit motion checks in browser smoke with reduced motion and POS paid/unpaid path.
7. **Mainnet gate:** prior to broad merchant launch, physically scan an actual invoice on a supported iOS/Android device, settle a low-value payment and verify wallet status, amount and lack of duplicate celebration. Automated fixture tests are not proof of real-world settlement.

## 6. Out of scope / separate release gates

Imported-wallet secure vault, Face ID / device biometric setup, per-transaction authorization, treasury monetization and exchange/AutoPay integrations. Never describe the payment-motion patch as those features being complete.
