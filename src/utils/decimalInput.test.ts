import {describe, it, expect} from 'vitest';
import {normalizeDecimalInput, normalizeIntegerInput, validAmountInput} from './decimalInput';
import {parseAmountToSats} from './tokenFormatting';

describe('amount entry preserves monetary intent', () => {
  it.each([['5,25','5.25'],['1.5','1.5'],['',''],['5,','5.'],['0,001','0.001']])('normalizes decimal keyboard input %s', (raw, expected) => {
    expect(normalizeDecimalInput(raw)).toBe(expected);
  });
  it.each([['1,234.56','1234.56'],['12,34,567.89','1234567.89'],['1.234.567,89','1234567.89'],['1\u202f234,56','1234.56'],['12,34,567','1234567']])('preserves an unambiguous grouped paste %s', (raw, expected) => {
    const normalized = normalizeDecimalInput(raw);
    expect(normalized).toBe(expected);
    expect(parseAmountToSats(normalized, true, 100000)).toBe(BigInt(Math.round(Number(expected) * 1000)));
  });
  it.each(['5.2,5','5,2.5','1a2','-12','1e3','0x10','1,234','12,34.56'])('keeps malformed or ambiguous %s visible and nonpayable', raw => {
    const normalized = normalizeDecimalInput(raw);
    expect(normalized).toBe(raw);
    expect(validAmountInput(normalized, 2)).toBe(false);
    expect(parseAmountToSats(normalized, true, 100000)).toBeNull();
  });
  it('does not turn fractional sats into a larger whole amount', () => {
    expect(normalizeIntegerInput('1.5')).toBe('1.5');
    expect(parseAmountToSats(normalizeIntegerInput('1.5'), false, 0)).toBeNull();
    expect(normalizeIntegerInput('12,34,567')).toBe('1234567');
    expect(normalizeIntegerInput('1 234')).toBe('1234');
  });
  it('enforces the selected currency precision', () => {
    expect(validAmountInput('1.23', 0)).toBe(false);
    expect(validAmountInput('1.234', 2)).toBe(false);
    expect(validAmountInput('1.234', 3)).toBe(true);
  });
});
