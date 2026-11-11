/** Read-only preparation for BTC purchase receipts. Not a production capability.
 *
 * The source must be the authenticated raw SDK owned by the wallet gateway;
 * assertCurrentSession must check its captured connection, unlock and session
 * generation. Neither a serialized response nor an `authenticated` boolean is
 * accepted as evidence. The SDK performs the fresh operator/SSP correlation.
 * Its response is not a portable, cryptographically signed receipt.
 *
 * This module is deliberately not connected to the gateway or purchase UI.
 * A settled claim proves the exact wallet deposit's historical net credit. It
 * does not establish Rampnow's payout attribution, the checkout destination's
 * on-chain output, or which leaves remain spendable now. Those adapters and
 * production acceptance are still missing; walletReceiptVerified stays false.
 */
import type {BreezSdk, Network, ObserveDepositClaimResponse} from '@breeztech/breez-sdk-spark';

const MAX_SATS = 2_100_000_000_000_000n;
const MAX_OBSERVATION_MS = 30_000;

export interface BtcReceiptOutput {
  readonly txid: string;
  readonly vout: number;
  readonly amountSats: bigint;
}

export interface BtcReceiptRequest {
  /** An independently authenticated payout binding is required before this
   * request can be associated with a purchase. A quote or balance is not one. */
  readonly outputs: readonly BtcReceiptOutput[];
  /** The reviewed deposit-claim ceiling, not the payment provider's fee. */
  readonly maximumClaimFeeSats: bigint;
}

export interface BtcReceiptAssessment {
  readonly identityPubkey: string;
  readonly network: Network;
  readonly outpoint: Readonly<BtcReceiptOutput>;
  readonly observedAt: number;
  readonly walletClaim: Readonly<{
    status: 'not_observed' | 'pending' | 'settled';
    paymentId: string | null;
    netCreditSats: bigint | null;
    claimFeeSats: bigint | null;
  }>;
  readonly providerCompletion: 'not_checked';
  readonly purchaseAttribution: 'unverified';
  readonly onchainOutput: 'not_checked';
  readonly currentSpendability: 'unverified';
  readonly walletReceiptVerified: false;
}

export class BtcReceiptObservationError extends Error {
  constructor(message = 'Bitcoin receipt could not be verified. Check its status again.') {
    super(message);
    this.name = 'BtcReceiptObservationError';
  }
}

function validSats(value: unknown): value is bigint {
  return typeof value === 'bigint' && value >= 0n && value <= MAX_SATS;
}

function copyRequest(request: BtcReceiptRequest) {
  if (!Array.isArray(request?.outputs) || request.outputs.length !== 1) {
    throw new BtcReceiptObservationError('Only single-output Bitcoin receipts are supported.');
  }
  const output = request.outputs[0];
  if (!output || typeof output.txid !== 'string' || !/^[0-9a-f]{64}$/.test(output.txid) || !Number.isSafeInteger(output.vout)
    || output.vout < 0 || output.vout > 0xffffffff || !validSats(output.amountSats)
    || output.amountSats === 0n || !validSats(request.maximumClaimFeeSats)
    || request.maximumClaimFeeSats >= output.amountSats) throw new BtcReceiptObservationError();
  return {
    output: Object.freeze({txid: output.txid, vout: output.vout, amountSats: output.amountSats}),
    maximumClaimFeeSats: request.maximumClaimFeeSats,
  };
}

/** Does not authorize/submit a claim, resume it, run active sync, or persist
 * purchase status. The SDK may cache content-addressed observation evidence.
 * A failed read never establishes absence. Keep the raw SDK inside the gateway. */
export function createBtcReceiptObserver(options: {
  sdk: Pick<BreezSdk, 'getInfo' | 'observeDepositClaim'>;
  network: Network;
  identityPubkey: string;
  assertCurrentSession: () => void;
  now?: () => number;
}) {
  const {sdk, network, identityPubkey, assertCurrentSession} = options;
  const now = options.now ?? Date.now;
  if (!['mainnet', 'signet', 'regtest'].includes(network) || typeof identityPubkey !== 'string'
    || !/^(02|03)[0-9a-f]{64}$/.test(identityPubkey)
    || typeof sdk?.observeDepositClaim !== 'function' || typeof sdk?.getInfo !== 'function'
    || typeof assertCurrentSession !== 'function') throw new BtcReceiptObservationError();
  let busy = false;
  const clock = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new BtcReceiptObservationError();
    return value;
  };
  return Object.freeze({
    async observe(request: BtcReceiptRequest): Promise<BtcReceiptAssessment> {
      assertCurrentSession();
      if (busy) throw new BtcReceiptObservationError('A Bitcoin receipt check is already in progress.');
      // Copy before any await so the caller cannot replace the outpoint/amount.
      const {output, maximumClaimFeeSats} = copyRequest(request);
      busy = true;
      try {
        const requestedAt = clock();
        const before = await sdk.getInfo({ensureSynced: false});
        assertCurrentSession();
        if (before?.identityPubkey !== identityPubkey) throw new BtcReceiptObservationError();
        const received = await sdk.observeDepositClaim({txid: output.txid, vout: output.vout});
        assertCurrentSession();
        const observation: ObserveDepositClaimResponse = structuredClone(received);
        const after = await sdk.getInfo({ensureSynced: false});
        assertCurrentSession();
        const finishedAt = clock();
        if (after?.identityPubkey !== identityPubkey || finishedAt < requestedAt
          || finishedAt - requestedAt > MAX_OBSERVATION_MS || !observation
          || observation.identityPubkey !== identityPubkey || observation.network !== network
          || observation.txid !== output.txid || observation.vout !== output.vout
          || typeof observation.completed !== 'boolean'
          || !Number.isSafeInteger(observation.observedAt) || !Number.isSafeInteger(observation.observedAt * 1000)
          || observation.observedAt < Math.floor(requestedAt / 1000)
          || observation.observedAt * 1000 > finishedAt + 1000) throw new BtcReceiptObservationError();

        const payment = observation.payment;
        let status: BtcReceiptAssessment['walletClaim']['status'] = 'not_observed';
        if (payment) {
          const details = payment.details;
          if (typeof payment.id !== 'string' || !payment.id || payment.id.length > 512
            || payment.paymentType !== 'receive' || payment.method !== 'deposit' || payment.conversionDetails
            || details?.type !== 'deposit' || details.txId !== output.txid || details.vout !== output.vout
            || !validSats(payment.amount) || payment.amount === 0n || !validSats(payment.fees)
            || payment.fees > maximumClaimFeeSats || payment.amount + payment.fees !== output.amountSats
            || (observation.completed ? payment.status !== 'completed' : payment.status !== 'pending')) {
            throw new BtcReceiptObservationError();
          }
          status = observation.completed ? 'settled' : 'pending';
        } else if (observation.completed) {
          throw new BtcReceiptObservationError();
        }
        // No result retains mutable SDK response objects or an aggregate balance.
        return Object.freeze({
          identityPubkey, network, outpoint: output, observedAt: observation.observedAt,
          walletClaim: Object.freeze({status, paymentId: payment?.id ?? null,
            netCreditSats: payment?.amount ?? null, claimFeeSats: payment?.fees ?? null}),
          providerCompletion: 'not_checked', purchaseAttribution: 'unverified',
          onchainOutput: 'not_checked', currentSpendability: 'unverified', walletReceiptVerified: false,
        });
      } catch {
        // Transport/provider diagnostics are not safe product copy. A failed
        // check is never a terminal receipt or permission to submit again.
        throw new BtcReceiptObservationError();
      } finally {
        busy = false;
      }
    },
  });
}
