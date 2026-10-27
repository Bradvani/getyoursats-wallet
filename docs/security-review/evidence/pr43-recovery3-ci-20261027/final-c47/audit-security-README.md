# c47 audit and security publication staging

Source `c47ffeda0550f08e3cda994bba06c9745adbdc3a`, tree `8f18bfbcec61c14b8a48b78359fd8686f26ec60b`. PR merge `fc52e5025b061334d4c5127275ba20ca27954ff6` has exactly that tree.

This packet contains only the completed `audit` and `security` directories: 34 original files, 1,033,212 bytes, preserved unchanged. Each deterministic archive has a readable per-file byte/hash inventory. Repeated generation and full member round-trip checks passed. Original inputs were unchanged afterward.

`audit-security-publication-review.json` records the expanded-log credential review, digest/source checks and exact limits. No candidate credentials or oversized embedded payloads were found; nothing was redacted or omitted within the two included scopes.

The retained CodeQL findings result is “No new alerts in code changed by this pull request,” with zero findings annotations. Three analyzer annotations and the 300-file/diff-informed-analysis limitations remain distinct. Both dependency scopes record zero advisories. Standard CI records 1,943 unit passes plus 1 skip, 236 Node passes, 11 Redis passes and eight lint warnings; checkpoint Chromium records 7 passes. Repeated suites are not summed into unique-case totals. The production interlock remains blocking.

Root's separate Tests/global metadata, history_pos's browser/smoke/matrix packet, governance and prior-head evidence are excluded from this snapshot. No independent security approval, funded/provider/device acceptance, production promotion or real-funds clearance is implied. No original evidence, source, ref or ruleset was changed.
