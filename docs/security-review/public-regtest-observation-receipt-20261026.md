# Public Spark regtest observation: executed receipt

Date: 26 October 2026. Production decision: **NO-GO unchanged**.

## Passed: real operator connectivity and observation

GitHub Actions run `40243867314`, source `085efecf3c921dafebfb1d681aac2b05ecf78f9b`, job `121321237542`, completed successfully. Artifact `12617259285` contains `public-spark-observation.json`.

Two fresh isolated Chromium profiles created independent disposable regtest wallets through the actual compiled SDK and application `connectSdk` gateway. No API key or existing wallet data was supplied. Both connections returned a stable public signing identity, a Spark regtest receive address and a Bitcoin `bcrt1` address. Both observation-only refreshes reported zero balances. The reported Spark **receive-address fee** was zero.

Public identities (not private keys):
- `029fc74872182d56ae2eb5941f5982c29ea7c604b455423b252cdb354aae977185`
- `033446fa5a57dde8f5fd3037470ec355e6332c9746f11e17c3ed4d8275db9e78db`

The profiles were closed after verification. Do not fund those old addresses or reuse these disposable identities. No phrase, private key, password, credential, full invoice or preimage is included in the evidence.

**This is actual public-network observation, not a mock. It is not a funded transfer, a claim or a zero-fee settlement proof.** No outgoing Spark/Lightning/Bitcoin payment was attempted in this workflow.

## Faucet provisioning attempts: not established

A later isolated sandbox probe used the same guarded connection against fresh disposable regtest wallets and the public Lightspark faucet UI. Requests for 5,000 and 500 worthless regtest sats were attempted. No acknowledged faucet-funding mutation or incoming transfer was observed. Five subsequent observation reads in each probe still showed a zero balance; the later probe also returned an empty payment history.

The last probe identity was `0230ff2e4c096a36bfd70000b80e3df08507044f9ade5aae14a7d50fd76cfa2fe8`. It used the application source at `e947ad95b36b8d11348bd654ad9342a497bae7e2` plus the read-only history field now preserved in `10c4d33c2d47ef3f673e74d8915807ce48294094`. TypeScript and diff checks passed for that fixture change.

The sandbox's faucet page reported failed loads for some third-party resources, including `www.google.com`. That is an environment observation, not proof of the exact reason funding did not occur. No CAPTCHA was solved or bypassed, no authentication was bypassed and no repeated large funding requests were made. The faucet's displayed form is not a settlement receipt. No generic active SDK synchronization, unrestricted signing or unapproved receiving claim was enabled to make this test pass.

The funding probes are exploratory diagnostics, not release acceptance. The reproducible CI observation fixture remains non-spending and credential-free.

## Consequences for release acceptance

- Private operator-image access is **not required for basic public-regtest connection and observation**: this has now been demonstrated without API credentials.
- A reproducibly provisioned public-regtest balance or a controlled compatible operator/SSP cluster is still required for actual two-wallet direct Spark settlement acceptance.
- Receiving/claim authorization still needs completion; an observation-only API must not be changed into an implicit permission to claim, renew or resume value-moving work.
- Verify A-to-B and B-to-A transfer amounts, both wallet histories and **actual transfer fees of zero**. A receive-address fee of zero is not evidence of the transfer fee.
- Unrelated Lightning Address payments remain fee-aware and must not be silently rerouted. Automatic internal-recipient routing is not implemented by this integration.
- Lightning-provider and real-value acceptance, physical-device testing and independent security review remain separate gates.

The main acceptance packet is `release-acceptance-packet-20261026.md`. Nothing in this receipt authorizes production, a main-branch merge, real-user migration or real-value spending.
