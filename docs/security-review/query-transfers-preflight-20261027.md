# Anonymous exact-transfer method preflight

At **00:49:33 UTC on 27 October 2026**, two bounded anonymous reads established basic availability of the exact-ID transfer method on the SDK's configured coordinator. This evidence does not accept complete provider compatibility or funded behavior.

The [original execution receipt](../../evidence/security-review/query-transfers-preflight-20261027/gys-query-transfers-preflight-result.json) is preserved byte for byte, SHA-256 `ba8d7327cacb217985e75c0e82b1fc7ff98ef15c122c7b98eaa79de9093e23fa`. Its `operatorCommit` field names the public source used to design the probe. **The deployed operator revision is unknown.** The [scope annotation](../../evidence/security-review/query-transfers-preflight-20261027/provenance-and-scope.json) makes that distinction explicit.

| Read | Observed result |
| --- | --- |
| Fresh canonical UUID with `REGTEST = 2` | HTTP 200, gRPC 0, zero transfers and explicit terminal offset `-1`; 377 ms |
| Empty-ID negative control | HTTP 200, gRPC 3 (`InvalidArgument`) in headers with no body; 105 ms |

Both calls used `https://0.spark.lightspark.com/spark.SparkService/query_transfers_by_id`. The [executed script](../../evidence/security-review/query-transfers-preflight-20261027/gys-query-transfers-preflight.mjs), SHA-256 `e55d3495ea7086aa32e660ff61c115d1fafc9cf080df6ab5e435f8a0a7414c5d`, uses a stateless transport and normal certificate verification. Its limits are two attempts, a four-second connection timeout, eight-second request timeout, nine-second hard process deadline, 8 KiB each for headers and body, and two gRPC-web frames. It has no retry or redirect-following path. No wallet, SDK authentication, session, signing, claim or funding operation is involved.

The [offline decoder and control tests](../../evidence/security-review/query-transfers-preflight-20261027/gys-query-transfers-preflight.test.mjs) passed 27 cases. They cover malformed wire data, explicit signed `-1`, conflicting status, unexpected records, authentication/challenge stops, response caps and request limits. Invocation without `--execute` sends no requests. A prior syntax failure and the later successful test log are retained separately.

Execution followed the local SDK source review, 171 native tests and release WASM compilation for patched source tree `a1400c1851d4a6e2c274133be0d86d272d6f4586`, patch SHA-256 `f00e39b8013d239a1560ceaf1ac0369fa6519a0ab6f0bd3bd3d271c0ee7e05c8`. The probe itself did not use the installed SDK and therefore does not establish its authentication or serialization behavior.

## Remaining provider evidence

The result confirms that this endpoint accepts the basic request format and returns the expected terminal empty response. An empty response cannot distinguish absence from privacy filtering and never permits a retry or proves non-execution. Legitimate owned-transfer reads must still establish complete participants, assigned leaves, status and economic fields through the final installed SDK. Funded operation, interrupted execution and recovery acceptance remain open. This internal verification is not qualified independent security approval.
