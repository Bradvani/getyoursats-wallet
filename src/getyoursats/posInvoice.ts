/**
 * An SDK call can succeed but return malformed or unexpected data. Validate before
 * switching the merchant UI to the QR screen so a bad payload is a local error.
 * This is NOT an invoice signature/settlement verifier.
 */
export interface PosInvoice {
  invoice: string;
  feeSats: number;
}

export function validatePosInvoiceResponse(value: unknown): PosInvoice {
  if (!value || typeof value !== 'object') throw new Error('The wallet did not return an invoice.');
  const response = value as {paymentRequest?: unknown; fee?: unknown};
  const invoice = response.paymentRequest;
  if (typeof invoice !== 'string' || !/^ln(bc|tb|bcrt|sb)[0-9a-z]{20,}$/i.test(invoice)) {
    throw new Error('The wallet returned an invalid Lightning invoice. No QR was displayed.');
  }
  const fee = response.fee;
  if (typeof fee !== 'number' && typeof fee !== 'bigint' && typeof fee !== 'string') {
    throw new Error('The wallet returned an invalid receiver fee.');
  }
  const feeSats = Number(fee);
  if (!Number.isSafeInteger(feeSats) || feeSats < 0) {
    throw new Error('The wallet returned an invalid receiver fee.');
  }
  return {invoice, feeSats};
}

/** Validation of an SDK-decoded invoice, not an invoice signature check.
 * A new merchant QR must match the intended amount and connected network. */
export function verifyPosInvoiceIntent(parsed: import('@breeztech/breez-sdk-spark').InputType,
  expected:{invoice:string;amountSats:number;network:import('@breeztech/breez-sdk-spark').Network},
  nowSecs=Math.floor(Date.now()/1000)):number {
  const network=expected.network==='mainnet'?'bitcoin':expected.network;
  if(!Number.isSafeInteger(expected.amountSats)||expected.amountSats<=0||
     !Number.isSafeInteger(expected.amountSats*1000) ||
     parsed.type!=='bolt11Invoice'||parsed.network!==network||
     parsed.invoice.bolt11.toLowerCase()!==expected.invoice.toLowerCase()||
     parsed.amountMsat!==expected.amountSats*1000||
     !/^[a-f0-9]{64}$/i.test(parsed.paymentHash)||
     !Number.isSafeInteger(parsed.timestamp)||!Number.isSafeInteger(parsed.expiry)||
     parsed.expiry<30||parsed.expiry>86400||
     parsed.timestamp>nowSecs+30||parsed.timestamp<nowSecs-300||
     parsed.timestamp+parsed.expiry<=nowSecs)
    throw new Error('The Lightning invoice does not match the approved amount, network or expiry. No QR was displayed.');
  return (parsed.timestamp+parsed.expiry)*1000;
}
