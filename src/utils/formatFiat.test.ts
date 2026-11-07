import {describe, expect, it} from 'vitest';
import {fiatEstimateValue, formatFiat} from './formatFiat';

describe('fiat display across device languages', () => {
  it.each(['en', 'hi', 'ta', 'ar', 'es', 'pt', 'de-DE', 'ja', 'th', 'vi', 'zh-CN'])(
    'keeps INR lakh/crore grouping and decimal precision in %s', language => {
      expect(formatFiat(1234567.89, 'INR', language)).toBe('₹12,34,567.89');
      expect(formatFiat(1234567.8, 'INR', language, {numberOnly: true})).toBe('12,34,567.80');
    });
  it('uses the selected language for other currencies without dropping decimals', () => {
    expect(formatFiat(1234567.8, 'USD', 'en')).toBe('$1,234,567.80');
    expect(formatFiat(1234567.8, 'EUR', 'es')).toMatch(/1\.234\.567,80/);
    expect(formatFiat(1234, 'JPY', 'ja')).toBe('￥1,234');
    expect(formatFiat(Number.NaN, 'INR')).toBe('');
  });
});

describe('indicative fiat estimates', () => {
  const now = 1_000_000;
  it('values the exact sats total including its fee without changing atomic input', () => {
    const sats = 2002n;
    const result = fiatEstimateValue(sats, 8_000_000, now, now);
    expect(result.stale).toBe(false);
    expect(result.value).toBeCloseTo(160.16, 8);
    expect(sats).toBe(2002n);
  });
  it('does not present an expired or future-dated quote as current', () => {
    expect(fiatEstimateValue(2002, 8_000_000, now - 120_001, now)).toEqual({value: null, stale: true});
    expect(fiatEstimateValue(2002, 8_000_000, now + 1, now)).toEqual({value: null, stale: true});
  });
  it.each([undefined, 0, -1, NaN, Infinity])('does not invent a price for rate %s', rate => {
    expect(fiatEstimateValue(2002, rate, now, now).value).toBeNull();
  });
  it('requires a fetch timestamp and safe integer sats', () => {
    expect(fiatEstimateValue(2002, 8_000_000, undefined, now).value).toBeNull();
    expect(fiatEstimateValue(1.5, 8_000_000, now, now).value).toBeNull();
    expect(fiatEstimateValue(2n ** 60n, 8_000_000, now, now).value).toBeNull();
  });
});

describe('currency conventions are shared by every fiat surface', () => {
  it.each(['en','hi','ta','es','pt','ja','th','vi','ar','zh-CN'])('keeps USD grouping in %s', language => {
    expect(formatFiat(1234567.89, 'USD', language, {numberOnly:true})).toBe('1,234,567.89');
  });
  it.each([
    ['EUR','es','1.234.567,89'],['BRL','en','1.234.567,89'],['CHF','en','1’234’567.89'],
    ['JPY','en','1,234,568'],['KWD','en','1,234,567.890'],['BDT','en','12,34,567.89'],
  ])('uses the currency region and minor units for %s', (currency, language, expected) => {
    expect(formatFiat(1234567.89, currency, language, {numberOnly:true}).replace(/’/g, "'")).toBe(expected.replace(/’/g, "'"));
  });
});
