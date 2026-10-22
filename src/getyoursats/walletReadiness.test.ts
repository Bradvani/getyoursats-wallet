import {describe,it,expect} from 'vitest';
import {isConfiguredSdkKey,isWalletServiceConfigured} from './walletReadiness';
describe('wallet service preflight',()=>{
 it.each([undefined,null,'','  ','your_breez_api_key_here','placeholder','replace_me','changeme'])('rejects an unset/tutorial key: %s',k=>expect(isConfiguredSdkKey(k)).toBe(false));
 it('accepts a non-placeholder SDK key',()=>expect(isConfiguredSdkKey('provider-client-sdk-key')).toBe(true));
 it('permits local regtest',()=>expect(isWalletServiceConfigured('',true)).toBe(true));
});