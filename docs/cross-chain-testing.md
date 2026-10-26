# Cross-chain verification

GetYourSats has sending and receiving workflows for supported USDC/USDT routes. Treat the installed SDK's route and quote responses as authoritative. Do not hardcode a network count or infer an active route from a logo, address family or older test record.

## Test safely

Start with mocked SDK responses and disposable fixtures. Use regtest only for operations the SDK and providers actually support there. Mainnet settlement requires explicit approval of the route, destination, amount and maximum cost.

Use a recipient address copied from a disposable wallet controlled by the tester. **A token contract or mint address is not a recipient wallet address.** This guide deliberately provides no pasteable destination addresses. Confirm the recipient's asset and network independently before any funded test.

Never use a customer's recovery phrase, credentials or funds. Do not place secrets, payable credentials or unredacted wallet data in screenshots or CI artifacts.

## Sending

1. Choose the destination asset, enter or scan the recipient address and confirm an available network before entering the amount.
2. Check the complete destination, asset and network. EVM-shaped addresses alone do not identify a specific EVM network; Solana and Tron recipients still need explicit network confirmation.
3. Prepare a quote. Confirm the source asset and spend, recipient output, provider/network costs, any limits and expiry.
4. Review the exact transaction and satisfy the applicable authorization policy before execution. A displayed confirmation screen alone is not proof of authorization coverage.
5. Reconcile the SDK payment result and destination settlement. Pending or unknown is not failure and must not invite blind repayment.

Test malformed addresses, family/network mismatches, ambiguous EVM routes, no routes, provider timeout, expired quotes, insufficient balance including fees, changed destination/asset/network, repeated clicks and reload during execution.

## Receiving

1. Select the supported source token and network from a fresh route response.
2. Request the intended amount and prepare the quote.
3. Before showing funding instructions, disclose the exact required deposit, source chain/token, destination asset, expected wallet credit, provider costs, any overpayment buffer and expiry.
4. Verify that the deposit address and QR payload belong to that quote and network.
5. Reconcile the deposit, conversion and resulting wallet credit. A generated address is not evidence of settlement.

Do not label the entire difference between requested and deposited value as a fee without the provider's breakdown. Test stale responses after network changes, quote expiry, under/overpayment behavior supported by the provider, delayed settlement, interruption and safe recovery.

## Record evidence

For each case, record the application SHA, SDK revision, environment, route/provider response, sanitized quote details, expected behavior and result. Distinguish mocked behavior, browser layout tests, regtest execution and authorized live settlement. A supported-chain list is not a test matrix.

Suggested matrix columns: direction, source asset, source network, destination asset/network, address family, quote expiry, authorization outcome, execution outcome, reload recovery and settlement evidence. Mark unsupported or untested combinations explicitly.

See [release readiness](maintainers/release-readiness.md) for authorization, recovery and rollback gates.
