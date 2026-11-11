# Rampnow sandbox proof and release checks — 11 November 2026

This change connects the existing Rampnow sandbox challenge contract to the
restricted browser wallet gateway. It is production preparation, not production
approval. Baseline: security PR #71 at
`f473c5588a287476f0003e3c8e990c45470a877c`; checkout contract inspected at PR #72
`4bbab4572631db60e05bb947cf7c5c90b30e8ce3`.

## Signing boundary

The gateway accepts only compact `gys-rampnow-v1` proofs containing the canonical
six-string JSON tuple: sandbox environment, the existing exact checkout preview
origin, one of `prepare` / `submit` / `status` / `reconcile`, a lowercase 32-byte
payload digest, an 18-byte nonce and the current compressed wallet public key.
Only signet is admitted. Mainnet, regtest, production origins, other purposes,
noncanonical JSON and arbitrary messages remain denied. The existing scoped
email proof remains supported.

The wallet must remain unlocked, with the same signer identity and storage
generation, before and after identity lookup and signing. The SDK identity and
returned signing identity must match the challenge owner. A connection-local
nonce reservation occurs synchronously immediately before entering the signer,
so concurrent requests cannot sign the same nonce twice. A failed, revoked or
ambiguous signing attempt retains that reservation for the server challenge's
five-minute lifetime. It does not replace the server's durable nonce consumption.

This proof grants no spending or recovery permit and exposes no raw SDK method.
Status and reconciliation proofs remain usable while payment outcomes are
unresolved. Value-moving operations still use their existing authorization and
durable-journal gates.

## Automated evidence on this patch

| Check | Result |
| --- | --- |
| Checkout/email proof, gateway, browser connection/lifetime, recovery, storage and migration suites | 491 tests passed in 16 files, including nonce TTL/capacity and oversized-message cases |
| Installed storage migration schema binding | 2 tests passed |
| Canonical installed SDK, WASM identity/guards, observation/storage identity and browser PBKDF2 | `npm run test:security:wasm` passed; no funded wallet or provider request |
| TypeScript | `npx tsc --noEmit` passed |
| Changed TypeScript lint and diff integrity | Passed |
| Vercel production build | Expected refusal with the explicit browser security release error |

The companion security workflow now includes the existing PR #72 branch in all
three jobs: software acceptance, Chromium/Firefox/WebKit acceptance and local
Bitcoin recovery. This prevents those checks from silently skipping after the
security candidate is integrated into the on-ramp branch. This local change is
not evidence that those remote jobs have run on the final combined commit.

## Release gates still open

- Review and test the final combined on-ramp/security artifact, including the
  actual checkout client through this gateway and the exact modified SDK.
- Resolve populated legacy database admission, provider-backed replacement-device
  recovery, and restricted receiving/claims and fresh/rebuilt exits before
  migrating existing wallets. See
  [the migration acceptance record](../review/security-migration-acceptance-20261031.md).
- Complete physical iPhone/Safari/PWA and Android/Chrome/PWA acceptance, including
  interrupted migration, old/new tabs, service-worker update and compatible
  recovery. Automated Linux tests do not close these gates.
- Obtain an independent review of the final application and modified SDK, then
  establish the production checkout origin/environment/network proof contract.
  This patch deliberately adds no production proof capability.
- Complete the on-ramp provider, BTC/Lightning settlement, fee and webhook gates
  recorded by the checkout workstream.

The production build interlock and public purchase gating remain in place. No
production deployment, live wallet mutation or real-funds transaction was
performed for this change.
