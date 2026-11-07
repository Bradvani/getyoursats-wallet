import {describe, expect, it} from 'vitest';
import {currencyCatalog} from './currencyCatalog';
import {buildFiatDisplayConfig} from './tokenFormatting';

describe('offline currency metadata', () => {
 it('supports selected currencies without a metadata request or a fabricated rate', () => {
  const catalog = currencyCatalog([], ['INR','USD'], 'en');
  expect(catalog.find(item => item.id === 'INR')).toEqual({id:'INR',name:'Indian Rupee',symbol:'₹'});
  expect(catalog.filter(item => item.id === 'USD')).toHaveLength(1);
  expect(catalog.some(item => item.id === 'BTC')).toBe(false);
 });
 it('localizes currency names independently from numeric conventions', () => {
  expect(currencyCatalog([], ['USD'], 'es').find(item => item.id === 'USD')?.name).toMatch(/dólar/i);
 });
 it.each([['JPY',0],['KWD',3],['INR',2]] as const)('retains %s precision while metadata is unavailable', (currency, digits) => {
  expect(buildFiatDisplayConfig(currency, []).fractionSize).toBe(digits);
 });
});
