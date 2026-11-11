# Native PIN policy consumers

Internal implementation review, 27 October 2026 UTC. This follow-up is based on native read-lease commit `3cb98be2fcc035014f9f649e42bc1a6c0a76354c`. It does not enable an exit route, alter an SDK artifact, or authorize a real-funds release.

## Closed failure paths

The Lock Screen settings, database export and unilateral-exit entry screens now treat rejected PIN-policy reads as unavailable. None of these failures selects a no-PIN action. Each screen offers visible recovery/retry guidance and binds an accepted result to its request, policy and read revision.

Lock Screen settings also guards its later PIN and biometric actions. Delayed settings or authentication responses cannot open settings actions after their authorization changes. A failed credential write remains a visible unavailable state; it is not converted into a successful transition.

Export authorization belongs to the selected wallet and network. Cancelling, leaving, changing that context or revoking native access invalidates old PIN and confirmation callbacks. The database export helper accepts an optional assertion, checks it across its asynchronous name/open/dump boundaries and checks again immediately before sharing or downloading. Redaction remains in place. If an already-authorized share fails after access changes, it cannot start a fallback download. A share already handed to the operating system cannot be recalled by this check.

Unilateral-exit entry similarly binds authorization to phase, network and the current unlock function. The hook accepts an optional assertion that the page supplies, checking it after the awaited seed read and before deriving or publishing funding state. An obsolete read or error does not put the user back into an exit flow after leaving it. Existing provider, fee, signing and execution behavior is unchanged.

## Shared PIN gate

The shared gate now catches unavailable biometric settings and exposes a PIN fallback instead of leaving a blank screen. Its mirror controls presentation only. Biometric authentication checks durable PIN presence and biometric enablement before and after the operating-system ceremony. PIN and biometric completions are bound to the current callback target, foreground read revision and PIN-policy revision.

Peer review found one usability gap in the first version: changing the target during an automatic biometric ceremony could discard its result while leaving the PIN pad hidden. The correction preserves the once-per-mount automatic prompt and reveals the PIN/manual retry when the old ceremony has been superseded. The regression checks rejection of the stale result, visible fallback and successful fresh PIN completion for the new target.

## Verification

The focused verification passed all 78 cases across nine files: the three page policies, the shared PIN gate, the export helper, the exit hook and the pre-existing Settings/exit/export controls. TypeScript, changed-file ESLint and diff checks also passed.

The 69 new cases were also run against the previous `3cb98be` runtime in an isolated checkout. That negative control produced **60 failures, 9 passes and 10 unhandled errors**. These are regression-case counts, not a count of distinct vulnerabilities. The intentional failing run is kept separate from the corrected-source result.

The tests use controlled native/Preferences responses, callback completion, synthetic database requests and mocked wallet/funding boundaries. They include current successful controls, explicit rejection, background/lock/policy changes, target/network replacement, unmount, delayed dump completion, and failed-share fallback. No provider call, funded wallet, real seed, native vault or operating-system share was used.

This is internal source review and offline application verification. It does not establish physical native behavior, native signer isolation, provider execution, independent recovery, or qualified external security approval. The existing release gates remain open.
