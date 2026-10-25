/** Display-only monetary values. Never use a display string as a payment amount. */
export type DisplayMoney =
  | { kind: 'sats'; amount: bigint | number }
  | { kind: 'btc'; sats: bigint | number }
  | { kind: 'token'; amount: bigint; decimals: number; ticker: string };
function exact(value: bigint | number): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe atomic amount');
  return BigInt(value);
}
export function atomicDecimal(value: bigint | number, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Invalid asset precision');
  const raw=exact(value); const negative=raw<0n; const digits=(negative?-raw:raw).toString().padStart(decimals+1,'0');
  const whole=decimals?digits.slice(0,-decimals):digits;
  const fraction=decimals?digits.slice(-decimals).replace(/0+$/,''):'';
  return `${negative?'-':''}${whole}${fraction?'.'+fraction:''}`;
}
export function formatMoney(value: DisplayMoney): string {
  if(value.kind==='sats')return `${exact(value.amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ')} sats`;
  if(value.kind==='btc')return `${atomicDecimal(value.sats,8)} BTC`;
  return `${atomicDecimal(value.amount,value.decimals)} ${value.ticker}`;
}
