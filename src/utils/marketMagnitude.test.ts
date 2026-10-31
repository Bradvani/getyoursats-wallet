import {describe,it,expect} from 'vitest';
import {formatMarketMagnitude} from './formatFiat';
describe('market magnitudes',()=>{
 it('spells out large Indian and international currency values',()=>{
  expect(formatMarketMagnitude(180e12,'INR','en')).toBe('₹180 lakh crore');
  expect(formatMarketMagnitude(2.1e12,'USD','en')).toBe('$ 2.1 trillion');
  expect(formatMarketMagnitude(180e12,'INR','hi')).toContain('180 लाख करोड़');
 });
 it('localizes magnitude words and rejects unavailable figures',()=>{
  expect(formatMarketMagnitude(2.1e12,'EUR','es')).toContain('billones');
  expect(formatMarketMagnitude(NaN,'INR')).toBe('');
 });
});
