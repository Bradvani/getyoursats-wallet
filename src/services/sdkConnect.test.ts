import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USDB_TICKER, USDB_TOKEN_IDENTIFIER } from '../constants/stableBalance';
import { buildConnectConfig } from './sdkConnect';
import { getSettings, saveSettings } from './settings';

describe('buildConnectConfig', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BREEZ_API_KEY', 'test-key');
    vi.stubEnv('VITE_SPARK_LOCAL_CONFIG', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an unset API key before wallet connection', () => {
    vi.stubEnv('VITE_BREEZ_API_KEY', '');
    expect(() => buildConnectConfig('mainnet')).toThrow(/connectivity is not configured/);
  });

  it('rejects a tutorial placeholder API key', () => {
    vi.stubEnv('VITE_BREEZ_API_KEY', 'your_breez_api_key_here');
    expect(() => buildConnectConfig('mainnet')).toThrow(/connectivity is not configured/);
  });

  it('ignores stale locally configured custom LNURL domains', () => {
    saveSettings({ ...getSettings(), lnurlDomain: 'unverified.getyoursats.test' });
    expect(buildConnectConfig('mainnet').lnurlDomain).not.toBe('unverified.getyoursats.test');
  });

  it('does not activate unverified GetYourSats LNURL domains', () => {
    vi.stubEnv('VITE_GETYOURSATS_LNURL_DOMAIN', 'getyoursats.example');
    expect(buildConnectConfig('mainnet').lnurlDomain).not.toBe('getyoursats.example');
  });

  it('does not enable branded addresses on an unapproved domain', () => {
    vi.stubEnv('VITE_GETYOURSATS_LNURL_DOMAIN', 'pay.getyoursats.com');
    vi.stubEnv('VITE_GETYOURSATS_LNURL_DOMAIN_APPROVED', 'false');
    expect(buildConnectConfig('mainnet').lnurlDomain).not.toBe('pay.getyoursats.com');
  });

  it('activates only the approved pay.getyoursats.com address domain on mainnet', () => {
    vi.stubEnv('VITE_GETYOURSATS_LNURL_DOMAIN', 'pay.getyoursats.com');
    vi.stubEnv('VITE_GETYOURSATS_LNURL_DOMAIN_APPROVED', 'true');
    expect(buildConnectConfig('mainnet').lnurlDomain).toBe('pay.getyoursats.com');
    expect(buildConnectConfig('regtest').lnurlDomain).not.toBe('pay.getyoursats.com');
  });

  it('rejects wrong LNURL domains even with approval flag', () => {
    vi.stubEnv('VITE_GETYOURSATS_LNURL_DOMAIN', 'another.domain.example');
    vi.stubEnv('VITE_GETYOURSATS_LNURL_DOMAIN_APPROVED', 'true');
    expect(buildConnectConfig('mainnet').lnurlDomain).not.toBe('another.domain.example');
  });

  it('sets the stable balance token and cross-chain sends on mainnet', () => {
    const config = buildConnectConfig('mainnet');
    expect(config.stableBalanceConfig?.tokens).toEqual([{ label: USDB_TICKER, tokenIdentifier: USDB_TOKEN_IDENTIFIER }]);
    expect(config.crossChainConfig).toBeDefined();
  });

  it('leaves both out on regtest, where the SDK refuses them at connect', () => {
    const config = buildConnectConfig('regtest');
    expect(config.stableBalanceConfig).toBeUndefined();
    expect(config.crossChainConfig).toBeUndefined();
  });

  it('hands the SDK the saved claim limit as its on-chain part', () => {
    saveSettings({ depositMaxFee: { type: 'rate', satPerVbyte: 3 } });
    expect(buildConnectConfig('regtest').maxDepositClaimFee).toEqual({ onchain: { type: 'rate', satPerVbyte: 3 } });
  });
});
