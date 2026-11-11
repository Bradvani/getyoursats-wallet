import { describe, expect, it } from 'vitest';
import { crossChainServiceFee } from './crossChainServiceFee';
import { formatMoney } from '../getyoursats/money';
import { crossChainFeeCopy } from '../locales/crossChainFees';
import { APP_LANGUAGES } from '../services/presentationPreferences';

describe('SDK cross-chain service fee denomination', () => {
  it('uses the fee asset precision independently of route and net amount', () => {
    const quote = { serviceFeeAmount: 12_345n, serviceFeeAsset: 'USDC', serviceFeeAssetDecimals: 6,
      feeAmount: 99_000_000_000_000_000n, estimatedOut: 9_901_000_000_000_000_000n,
      route: { asset: 'USDT', decimals: 18 } };
    expect(formatMoney(crossChainServiceFee(quote)!)).toBe('0.012345 USDC');
    expect(quote.feeAmount).toBe(99_000_000_000_000_000n);
    expect(quote.estimatedOut).toBe(9_901_000_000_000_000_000n);
  });

  it('uses sats only for the SDK-defined absent asset case', () => {
    expect(formatMoney(crossChainServiceFee({ serviceFeeAmount: 120n })!)).toBe('120 sats');
    expect(crossChainServiceFee({ serviceFeeAmount: 120n, serviceFeeAsset: 'USDC' })).toBeNull();
    expect(crossChainServiceFee({ serviceFeeAmount: 120n, serviceFeeAsset: '' })).toBeNull();
  });

  it('keeps a quoted zero distinct from missing or invalid fee data', () => {
    expect(formatMoney(crossChainServiceFee({ serviceFeeAmount: 0n })!)).toBe('0 sats');
    expect(formatMoney(crossChainServiceFee({ serviceFeeAmount: 0n, serviceFeeAsset: 'USDT', serviceFeeAssetDecimals: 6 })!)).toBe('0 USDT');
    expect(crossChainServiceFee({})).toBeNull();
    expect(crossChainServiceFee({ serviceFeeAmount: -1n })).toBeNull();
    expect(crossChainServiceFee({ serviceFeeAmount: 1n, serviceFeeAsset: 'USDC', serviceFeeAssetDecimals: 99 })).toBeNull();
  });

  it('provides the combined fee disclosure in every supported language', () => {
    for (const {code} of APP_LANGUAGES) {
      const copy = crossChainFeeCopy(code);
      expect(copy.serviceFee).toBeTruthy();
      expect(copy.unavailable).toBeTruthy();
      expect(copy.included).toContain('GetYourSats');
      if (code !== 'en') expect(copy.included).not.toBe(crossChainFeeCopy('en').included);
    }
  });
});
