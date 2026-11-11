# SDK 0007 offline artifact cross-check

**Internal artifact cross-check passed. Release approval: no.**

The supplied [run 40473745510](https://github.com/Bradvani/getyoursats-wallet/actions/runs/40473745510) status is `success`; its preserve-job status is `success`. Matching package bytes and a preserved commit do not independently establish successful CI.

Application source `1298724dfe1d95b7a0a24f19be80e6e977cec011` and reviewed SDK tree `0fad9ee69476211ee47bafb413ba75639a22014f` were reproduced from existing Git objects and the pinned cumulative patch. Preserved commit `de5100c3728bc11d019744f09624648b4aff8803` is an exact child of that application source and changes only the package archive, build manifest and dependency lock. The reconstructed files, uploaded patch and `compiled-unverified` copy agree byte-for-byte. The package SHA256 is `32715449ed2e670740befe31f0a466b2adc0ab83651f410295a7cb34af55440c`; all 17 generated artifact hashes, both source-bound browser adapters, embedded manifest and lockfile SHA512 agree.

The recorded log contains 221 passing native cases across 16 groups, six actual WASM storage CAS cases and ten actual WASM identity cases. The browser report records nine passes in each of Chromium, Firefox and WebKit, without retries, skips, failures or flakes. Installed preflight and namespace receipts agree with the archive inventory, explicitly reported npm ignore-file renames and frozen verifier source. These are cross-checks of recorded CI assertions; this script did not rerun those checks or inspect the original installed filesystem.

No SDK was imported, wallet/profile accessed, provider contacted, package executed, or Git ref changed. Legacy storage ownership, execution/recovery contracts, physical-device checks and independent review remain separate release boundaries. The complete values and limitations are in [receipt.json](receipt.json).
