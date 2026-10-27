# Dev-mode preference literal storage correction

## Finding and scope

The retained [CodeQL annotation](evidence/dev-mode-literal-storage-20261027/codeql-annotations.json) flags `src/services/settings.ts:404` at source `f912253d7a618f7fdc361e8221d37b6962b7eb8e`, with the title “Clear text storage of sensitive information” and `useSecretTap` as its source.

In this source, the hook returns an activation boolean, counters and functions; `SettingsPage` persists the activation preference. This review did not demonstrate wallet-seed or key exposure. The writer nevertheless accepted arbitrary runtime coercion through `String(enabled)` despite its TypeScript boolean parameter.

`setDevMode` now persists only `enabled === true ? 'true' : 'false'` under the existing `spark-dev-mode` key. Primitive booleans retain their persisted behavior. Other runtime values write `false` without invoking object coercion. The URL-only flag, hook, callers, wallet storage, SDK, security gates and CodeQL configuration are unchanged.

## Focused verification

- New controls against the original writer: **5 failed, 18 passed**, reproducing arbitrary string persistence and both throwing `toString` / `Symbol.toPrimitive` hooks.
- Final `node node_modules/vitest/vitest.mjs run src/services/settings.test.ts`: **23 passed**, no skips.
- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- Targeted ESLint on the two changed TypeScript files: passed.
- The copied dependencies passed the canonical installed-package preflight before test imports, bound to archive `32715449ed2e670740befe31f0a466b2adc0ab83651f410295a7cb34af55440c` and the selected `0007` source.

The initial sandbox subprocess denial and a test-only TypeScript inference error are retained separately with their successful follow-up results. No wallet connection, profile access, provider operation or deployment was performed. Prior-head CI is historical; CodeQL closure and full corrected-head verification require fresh CI.
