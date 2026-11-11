/** Server-only policy. Configure only after approving the rate and confirming
 * Rampnow's account base currency; it is not necessarily the buy currency.
 * No default rate, fixed amount, currency or FX conversion is inferred.
 */
import {RampnowError, rampnowPartnerFeeParameters} from './rampnow.mjs';

const invalid = () => {throw new RampnowError('RAMPNOW_FEE_CONFIG_INVALID');};
const canonical = value => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
function numericSetting(value) {
  if (typeof value !== 'string' || value.length > 32 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) invalid();
  const number = Number(value);
  // Reject rounding/truncation and exponent serialization rather than silently
  // changing the configured monetary value when producing the JSON number.
  if (!Number.isFinite(number) || String(number) !== canonical(value)) invalid();
  return number;
}

export function configuredRampnowPartnerFees(env) {
  const raw = [env.RAMPNOW_PARTNER_PCT_FEE, env.RAMPNOW_PARTNER_FIXED_FEE, env.RAMPNOW_PARTNER_FEE_BASE_CURRENCY];
  if (raw.every(value => value === undefined)) return undefined;
  if (raw.some(value => value === undefined) || typeof raw[2] !== 'string' || !/^[A-Z]{3}$/.test(raw[2])) invalid();
  return Object.freeze({...rampnowPartnerFeeParameters({partnerPctFee: numericSetting(raw[0]),
    partnerFixedFee: numericSetting(raw[1])}), baseCurrency: raw[2]});
}
