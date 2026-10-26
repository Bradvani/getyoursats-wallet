# GetYourSats security

## Report a vulnerability privately

Use the [GetYourSats contact form](https://getyoursats.com/support#contact), select **Wallet & payment help**, and begin your message with **Security report**. Send a short description and a safe way to continue the conversation. Do not publish exploit details in a GitHub issue or pull request while the issue remains unresolved.

Useful initial information includes:

- Affected commit, version or website URL.
- Browser, operating system and whether the app was installed as a PWA.
- Expected behavior, observed behavior and potential impact.
- Reproduction steps using disposable or mocked data.

Never send recovery phrases, private keys, passwords, passkey secrets, API credentials or unredacted wallet logs. Do not test against another person's wallet or send real funds as part of a report. If the form is unavailable, open an issue requesting a private reporting channel without describing the vulnerability.

This is the reporting route for **GetYourSats**. For a vulnerability isolated to an upstream dependency, also follow that project's published security policy. GetYourSats is not operated by Breez.

## Security boundaries

GetYourSats relies on the Breez Spark SDK and the browser or native platform for key handling and payment execution. These environments do not provide identical guarantees.

- Do not assume that every browser storage path encrypts wallet material or that a screen lock protects an already loaded signer.
- Browser encryption cannot protect an unlocked wallet from malicious application code, a compromised dependency or a sufficiently privileged extension.
- A passkey sign-in or an application password prompt is not, by itself, hardware-backed authorization of the exact transaction.
- Recovery must restore the same wallet identity. A new passkey-derived wallet must not silently replace an imported recovery-phrase wallet.
- Email, usernames and support cannot reconstruct lost wallet keys.

Keep an independent recovery method before removing an app or clearing browser data. Read the recovery and security information shown by the version you use.

## Evidence and release decisions

A running website, a green CI check or a large test count does not certify custody security, recovery or settlement. Security-sensitive releases require review of the exact application and SDK revision, negative authorization tests, migration/rollback evidence and the relevant real-device verification. The [maintainer release checklist](docs/maintainers/release-readiness.md) records those requirements.

This policy does not promise a bounty, response deadline or third-party security certification.
