import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Network} from '@breeztech/breez-sdk-spark';

const sdk = vi.hoisted(() => ({
  defaultConfig: vi.fn((network: Network) => ({network, leafOptimizationConfig: {autoEnabled: true}})),
}));
vi.mock('@breeztech/breez-sdk-spark', () => ({...sdk, SdkBuilder: {}, connect: vi.fn()}));
vi.mock('./settings', () => ({getSettings: () => ({})}));
import {buildConnectConfig, selectedNetwork} from './sdkConnect';

const ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const INTENT = 'e4973df9-bfe8-49c6-821d-2ee5fed9fb93';
const RETURN = `${ORIGIN}/rampnow/return?intent=${INTENT}&network=signet`;
const at = (url: string) => vi.stubGlobal('window', {location: new URL(url)});

beforeEach(() => {
  vi.stubEnv('VITE_BREEZ_API_KEY', 'test-key');
  vi.stubEnv('VITE_SPARK_LOCAL_CONFIG', '');
});
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs();});

describe('checkout return network before wallet connection', () => {
  it('restores the supported sandbox network before creating the SDK configuration', () => {
    at(RETURN);
    expect(selectedNetwork()).toBe('signet');
    expect(buildConnectConfig().network).toBe('signet');
    expect(sdk.defaultConfig).toHaveBeenCalledExactlyOnceWith('signet');
  });

  it.each([
    RETURN.replace('&network=signet', ''),
    RETURN.replace('network=signet', 'network=mainnet'),
    RETURN.replace('network=signet', 'network=testnet'),
    RETURN.replace('network=signet', 'network=regtest'),
    RETURN + '&network=mainnet',
    RETURN + '&network=signet',
    RETURN + `&intent=${INTENT}`,
    RETURN.replace(INTENT, 'invalid'),
    RETURN.replace(`intent=${INTENT}&`, ''),
    RETURN + '&completed=true',
    RETURN + '#network=mainnet',
    RETURN.replace(ORIGIN, 'https://wallet.getyoursats.com'),
    RETURN.replace('/rampnow/return', '/rampnow/return/'),
  ])('rejects an incomplete or altered return without configuring any wallet: %s', url => {
    at(url);
    expect(() => buildConnectConfig()).toThrow(/checkout return/i);
    expect(sdk.defaultConfig).not.toHaveBeenCalled();
  });

  it.each<Network>(['mainnet', 'regtest'])('refuses a conflicting internal override: %s', network => {
    at(RETURN);
    expect(() => buildConnectConfig(network)).toThrow(/checkout return/i);
    expect(sdk.defaultConfig).not.toHaveBeenCalled();
  });

  it('accepts a matching override without changing the return context', () => {
    at(RETURN);
    expect(buildConnectConfig('signet').network).toBe('signet');
  });

  it.each<Network>(['mainnet', 'regtest', 'signet'])('preserves ordinary network selection: %s', network => {
    at(`https://wallet.getyoursats.com/?network=${network}&dev=true`);
    expect(selectedNetwork()).toBe(network);
  });

  it('keeps mainnet as the default outside checkout returns', () => {
    at('https://wallet.getyoursats.com/');
    expect(selectedNetwork()).toBe('mainnet');
  });

  it.each(['', 'testnet', 'testnet3', 'testnet4', 'unknown', 'SIGNET', 'signet&network=mainnet'])(
    'rejects unsupported or ambiguous ordinary network selection: %s', network => {
      at(`https://wallet.getyoursats.com/?network=${network}`);
      expect(() => buildConnectConfig()).toThrow(/wallet network/i);
      expect(sdk.defaultConfig).not.toHaveBeenCalled();
    });

  it('rejects an unsupported runtime override before configuring the SDK', () => {
    at('https://wallet.getyoursats.com/');
    expect(() => buildConnectConfig('testnet' as Network)).toThrow(/wallet network/i);
    expect(sdk.defaultConfig).not.toHaveBeenCalled();
  });
});
