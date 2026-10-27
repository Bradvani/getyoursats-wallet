# Continuous SDK provenance checks in the standard verification job

The standard `GetYourSats checks` workflow now runs the existing SDK source,
package and compiled-boundary checks on pull requests and the configured push
branches. This closes the coverage gap where these gates ran only in isolated
SDK builds or release workflows.

After dependency installation and before the application build, the unchanged
`verify` job now requires:

```sh
python3 -B tests/sdk-build-guards.test.py
python3 -B tests/canonical-installed-sdk.test.py
npm run test:security:wasm
```

The npm security command starts with the complete canonical installed-package
preflight. Its subsequent signer, observation/API, namespace and PBKDF2 checks
remain unchanged. Installation uses `npm ci --ignore-scripts`, matching the
isolated SDK builder: package lifecycle scripts cannot execute SDK code before
the canonical preflight. Explicit later workflow commands still run normally.

The following step also exercises the existing production release interlock.
It runs `VERCEL_ENV=production NO_COLOR=1 npx vite build`, retains ordinary
build output in `$RUNNER_TEMP/security-production-interlock.log`, and requires
the command to fail with the exact full `Error:` line from `vite.config.ts`.
A successful production build or a failure without that exact interlock error
fails the job. The log is printed without dumping environment variables or
credentials. The ordinary application build follows this check. This enforces
the existing release restriction and adds no new approval policy.

This change preserves the existing workflow triggers, read-only permissions,
job name, Node version, action pins, 35-minute job limit, application build,
unit tests, Node tests, Redis installation, cross-instance support-quota check
and lint. It does not change package dependencies, SDK/vendor bytes, runtime
code, wallet state, provider access, release policy or the running build branch.

## Validation boundary

The initial change is based on published source
`1298724dfe1d95b7a0a24f19be80e6e977cec011`; the interlock step follows local
commit `87e0f6daad157454665d3e3bb48cfab7a71d935e`. PyYAML parsed the workflow with
duplicate-key rejection and preserved the literal GitHub `on` key. An exact
structural comparison confirmed only the intended install-step replacement and
four inserted gates. The follow-up comparison against `87e0f6d` confirmed only
the added interlock step. All eleven `run` blocks passed
`bash --noprofile --norc -n`.
Referenced scripts exist, and the canonical preflight remains the first command
in `test:security:wasm`. The expected rejection line exactly matches the existing
Vite configuration error. The validation receipt is
[`evidence/continuous-sdk-ci-20261027.json`](evidence/continuous-sdk-ci-20261027.json).

This is configuration validation. No dependency installation, test suite, SDK
initialization, production or ordinary build, wallet connection or provider
operation was executed for this change. Actionlint and ShellCheck were
unavailable, so their results are not
claimed. The standard CI run against the final combined source and canonical
SDK artifact remains required. The retained older artifact cannot satisfy the
selected `0007` provenance gate, and no bypass or conditional skip is added.
