/** Display-unit presets for a fresh Lightning payment request.
 * Fiat presets are indicative: invoice settlement is always exact integer sats.
 * No live exchange quote or bank payment is implied by a fiat label. */
export function receiveAmountPresets(unit:string, isStableBalance=false):string[] {
  if(isStableBalance)return ['5','20','50'];
  if(unit==='sats')return ['1000','5000','10000'];
  if(unit==='BTC')return ['0.00001','0.00005','0.0001'];
  if(unit==='INR')return ['100','500','1000'];
  return ['5','20','50'];
}
