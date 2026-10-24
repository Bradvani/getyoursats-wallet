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
