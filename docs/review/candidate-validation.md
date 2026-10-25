# Candidate validation

Baseline: `2c848e8666a415f216fb6a813b107a228345d156`. The containing commit and GitHub CI results identify the release candidate.

- TypeScript/build: passed in clean sandbox using the lockfile dependency versions.
- Unit tests: 798/798 passed.
- Browser regression run: 19 passed, 0 failed, 0 flaky, Chromium 147.
- Lint: zero errors, seven warnings.
- Wallet layout tests at 360, 390, 768, 1024, 1366 and 1920 pixels plus a 683x468 viewport-equivalent test. This is not a physical-device or actual 200% browser-zoom certification. Existing 320px smoke test also retained.
- Cancellation, pending payment, network failure and older-page checks prove no call to the tested removal function on refusal. They do not prove every deletion entry point is protected.
- Payment-result tests exercise completed, failed, pending and missing SDK result status. Fixture settlement is synthetic, not a funded payment test.
- Critical new keys are present in English, Hindi, Spanish and Portuguese. Human comprehension review and full-screen translation remain open.

No real funds were moved, no user's recovery phrase was read and no vault migration was performed. Security P0 and a durable merchant ledger are not complete. Screenshots and full CI output should be retained against the final commit before any observation is closed.
