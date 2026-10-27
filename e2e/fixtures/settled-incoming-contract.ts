/** Public, historical REGTEST bindings. No wallet material belongs in this file. */
export const OBSERVATION_ORIGIN = 'http://127.0.0.1:5183';
export const EXPECTED_PATCH = '526a66a84989313aa91a391e2681635d147bfa934d8d8310358e19725609e195';
export const PRIOR_RECEIPT_SHA256 = 'c6913279fc88bbc6415f08728155faf4bc5d8f331ad2538c6b94421da0000d26';
export const EXECUTION_BLOCK = 'BLOCKED_PENDING_SUCCESSOR_STORAGE_PROVENANCE';
export function assertObservationExecutionAllowed(): void {throw new Error(EXECUTION_BLOCK);}
export const OBSERVATION_PLAN = Object.freeze([
  Object.freeze({profile: 'wallet-0', identity: '034c01f28e4db50219ccbceb75d1b5bdf064a05ef58532d910775454e55d6fb5bd',
    transfers: Object.freeze([
      Object.freeze({id: '01a17af2-82f5-7b40-ae7e-d961eac979b7', amount: '1000'}),
      Object.freeze({id: '117da763-c299-49af-b9d6-e6181cf00693', amount: '50'}),
    ])}),
  Object.freeze({profile: 'wallet-1', identity: '03f9751e36385090cbcb11837dcace5a6aa204291ee04ab20a34d0d3f7c020df86',
    transfers: Object.freeze([Object.freeze({id: 'cc62e536-6124-4abd-9f72-c4c33f75f8ad', amount: '100'})])}),
]);
export type ObservationPlan = (typeof OBSERVATION_PLAN)[number];
export type SettledTransfer = ObservationPlan['transfers'][number];

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): Record<string, unknown> {
  required(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an observation object');
  return value as Record<string, unknown>;
}

/** Project only public facts, never SDK objects, errors, cached records or headers. */
export function verifyCompletedObservation(value: unknown, plan: ObservationPlan, transfer: SettledTransfer, startedAt: number, finishedAt: number) {
  const observation = object(value);
  required(observation.paymentId === transfer.id, 'Observation transfer differs');
  required(observation.identityPubkey === plan.identity && observation.network === 'regtest', 'Observation wallet/network differs');
  required(observation.completed === true, 'Incoming transfer remains unresolved');
  const observedAt = observation.observedAt;
  required(typeof observedAt === 'number' && Number.isSafeInteger(observedAt)
    && observedAt >= Math.floor(startedAt / 1000) && observedAt <= Math.floor(finishedAt / 1000) + 5,
  'Observation is not fresh');
  const payment = object(observation.payment);
  required(payment.id === transfer.id && payment.paymentType === 'receive' && payment.method === 'spark'
    && payment.status === 'completed', 'Incoming payment type/status differs');
  required(typeof payment.amount === 'bigint' && payment.amount === BigInt(transfer.amount)
    && payment.fees === 0n && payment.conversionDetails === undefined && payment.tokenIdentifier === undefined,
  'Incoming amount/fee/asset differs');
  return Object.freeze({paymentId: transfer.id, identityPubkey: plan.identity, network: 'regtest',
    observedAt, amountSats: transfer.amount, feeSats: '0', completed: true});
}

export function publicIdentity(value: unknown): string {
  const data = object(value).bytes;
  required(Array.isArray(data) && data.length === 33 && data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255),
    'Identity must be a compressed public key');
  const hex = data.map(byte => (byte as number).toString(16).padStart(2, '0')).join('');
  required(/^(02|03)[0-9a-f]{64}$/.test(hex), 'Identity must be a compressed public key');
  return hex;
}

/** Bounded canonical protobuf fields for pinned authentication/request schemas. */
export function decodeProtoFields(bytes: Uint8Array): Map<number, Uint8Array | bigint> {
  required(bytes instanceof Uint8Array && bytes.length <= 16384, 'Invalid protobuf envelope');
  let position = 0;
  function varint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      required(position < bytes.length, 'Truncated protobuf integer');
      const byte = bytes[position++];
      required(i !== 9 || byte <= 1, 'Protobuf integer exceeds uint64');
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) {required(i === 0 || byte !== 0, 'Noncanonical protobuf integer'); return value;}
    }
    throw new Error('Oversized protobuf integer');
  }
  const fields = new Map<number, Uint8Array | bigint>();
  while (position < bytes.length) {
    const tag = varint(), number = Number(tag >> 3n), wire = Number(tag & 7n);
    required(number > 0 && number < 128 && !fields.has(number), 'Duplicate/unsupported protobuf field');
    if (wire === 0) fields.set(number, varint());
    else {
      required(wire === 2, 'Unsupported protobuf wire type');
      const length = varint(); required(length <= BigInt(bytes.length - position), 'Truncated protobuf field');
      fields.set(number, bytes.subarray(position, position + Number(length))); position += Number(length);
    }
  }
  return fields;
}

export function validateAuthenticationChallenge(bytes: Uint8Array, expectedIdentity: string) {
  const fields = decodeProtoFields(bytes);
  const exact = (input: Map<number, unknown>, expected: number[]) => {
    required(input.size === expected.length && expected.every(key => input.has(key)), 'Unknown/missing authentication field');
  };
  let challenge = fields;
  let tags = [1, 2, 3, 4];
  let protocol = 'operator';
  if (fields.has(10)) {
    exact(fields, [1, 10, 20]);
    required(fields.get(1) === 1n && fields.get(20) instanceof Uint8Array
      && (fields.get(20) as Uint8Array).length === 32 && fields.get(10) instanceof Uint8Array, 'Invalid protected authentication challenge');
    challenge = decodeProtoFields(fields.get(10) as Uint8Array); tags = [1, 10, 20, 30]; protocol = 'ssp';
  }
  exact(challenge, tags);
  const [versionTag, timeTag, nonceTag, keyTag] = tags;
  const timestamp = challenge.get(timeTag), nonce = challenge.get(nonceTag), key = challenge.get(keyTag);
  required(challenge.get(versionTag) === 1n && typeof timestamp === 'bigint' && timestamp > 0n
    && timestamp <= 0x7fff_ffff_ffff_ffffn && nonce instanceof Uint8Array && nonce.length === 32
    && key instanceof Uint8Array && publicIdentity({bytes: Array.from(key)}) === expectedIdentity,
  'Authentication challenge is not issued to this identity');
  return protocol;
}

type SignerResource = {breezSigner: object; sparkSigner: object; free: () => void};
/** Authentication is identity signing, not cryptographic domain separation.
 * The separately enforced exact transport policy remains essential. */
export function observationSigners(resources: SignerResource, expectedIdentity: string) {
  let revoked = false;
  let denialCount = 0;
  const counts: Record<string, number> = {};
  const pending = new Set<Promise<unknown>>();
  const check = () => {required(!revoked, 'Observation session is closed');};
  const reject = (): never => {
    denialCount++; revoked = true;
    throw new Error('Observation signing guard rejected a capability');
  };
  function wrap(target: object, allowed: readonly string[]) {
    return new Proxy(Object.create(null) as object, {
      get: (_target, key) => {
        if (key === 'then' || typeof key === 'symbol') return undefined;
        return (...args: unknown[]) => {
          try {
          check();
          required(allowed.includes(key), 'Signing capability is unavailable to observation');
          counts[key] = (counts[key] ?? 0) + 1;
          required(counts[key] <= 32, 'Observation signer request budget exhausted');
          const method = Reflect.get(target, key);
          required(typeof method === 'function', 'Observation signer capability is unavailable');
          if (key === 'isRemote') {
            required(args.length === 0, 'Remote signer lookup takes no arguments');
            const value = Reflect.apply(method, target, args);
            required(typeof value === 'boolean', 'Remote signer flag must be boolean');
            return value;
          }
          if (key === 'signAuthenticationChallenge') {
            const bytes = args[0];
            required(args.length === 1 && bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 4096,
              'Invalid authentication challenge');
            validateAuthenticationChallenge(bytes, expectedIdentity);
          } else required(args.length === 0, 'Identity lookup takes no arguments');
          const operation = Promise.resolve(Reflect.apply(method, target, args)).then(value => {
            check();
            if (key === 'getIdentityPublicKey') required(publicIdentity(value) === expectedIdentity, 'Restored public identity differs');
            return value;
          }).catch(reject);
          pending.add(operation);
          void operation.then(() => pending.delete(operation), () => pending.delete(operation));
          return operation;
          } catch {return reject();}
        };
      },
      set: () => false, defineProperty: () => false, setPrototypeOf: () => false,
    });
  }
  return {
    breezSigner: wrap(resources.breezSigner, []),
    sparkSigner: wrap(resources.sparkSigner, ['getIdentityPublicKey', 'isRemote', 'signAuthenticationChallenge']),
    revoke: () => {revoked = true;},
    reject,
    assertActive: () => {try {check();} catch {reject();}},
    counts: () => ({...counts, denied: denialCount}),
    dispose: async () => {
      revoked = true;
      await Promise.allSettled([...pending]);
      for (const signer of [resources.breezSigner, resources.sparkSigner]) {
        const free = Reflect.get(signer, 'free');
        if (typeof free === 'function') Reflect.apply(free, signer, []);
      }
      resources.free();
    },
  };
}

export function assertObservationConfig(config: Record<string, unknown>) {
  required(config.network === 'regtest' && config.backgroundTasksEnabled === false
    && config.apiKey === undefined && config.proxy === undefined && config.realTimeSyncServerUrl === undefined
    && config.stableBalanceConfig === undefined && config.crossChainConfig === undefined
    && config.lnurlDomain === undefined && config.privateEnabledDefault === false
    && config.preferSparkOverLightning === false && config.maxDepositClaimFee === undefined,
  'Observation configuration is not restricted');
  required(object(config.leafOptimizationConfig).autoEnabled === false
    && object(config.tokenOptimizationConfig).autoEnabled === false, 'Observation optimizers must be disabled');
}

/** No getInfo/sync/receive/payment controller is part of this call surface. */
export async function readExactSettledTransfers(
  raw: {observeIncomingTransfer: (id: string) => Promise<unknown>}, plan: ObservationPlan,
  live: () => void, now: () => number = Date.now,
) {
  const receipts = [];
  for (const transfer of plan.transfers) {
    live(); const startedAt = now();
    const response = await raw.observeIncomingTransfer(transfer.id);
    live();
    receipts.push(verifyCompletedObservation(response, plan, transfer, startedAt, now()));
  }
  return receipts;
}
