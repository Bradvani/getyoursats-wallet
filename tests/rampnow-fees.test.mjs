import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredRampnowPartnerFees} from '../server/rampnowFees.mjs';
import {bitcoinQuoteRequest, rampnowPartnerFeeParameters} from '../server/rampnow.mjs';

const configured = {RAMPNOW_PARTNER_PCT_FEE: '0.50', RAMPNOW_PARTNER_FIXED_FEE: '1.00',
  RAMPNOW_PARTNER_FEE_BASE_CURRENCY: 'USD'};

test('unset policy retains account fees and never invents a zero markup', () => {
  assert.equal(configuredRampnowPartnerFees({}), undefined);
  assert.deepEqual(rampnowPartnerFeeParameters(undefined), {});
  const request = bitcoinQuoteRequest({orderType: 'buy', fiatCurrency: 'INR', srcAmount: '1000'});
  assert.equal(Object.hasOwn(request, 'partnerPctFee'), false);
  assert.equal(Object.hasOwn(request, 'partnerFixedFee'), false);
});

test('explicit numeric overrides retain independently confirmed account denomination', () => {
  const policy = configuredRampnowPartnerFees(configured);
  assert.deepEqual(policy, {partnerPctFee: 0.5, partnerFixedFee: 1, baseCurrency: 'USD'});
  assert.equal(Object.isFrozen(policy), true);
  const request = bitcoinQuoteRequest({orderType: 'buy', fiatCurrency: 'INR', srcAmount: '1000', partnerFees: policy});
  assert.equal(request.partnerPctFee, 0.5); assert.equal(request.partnerFixedFee, 1);
  assert.equal(request.srcCurrency, 'INR');
  assert.equal(Object.hasOwn(request, 'baseCurrency'), false);
  assert.deepEqual(configuredRampnowPartnerFees({...configured, RAMPNOW_PARTNER_PCT_FEE: '0',
    RAMPNOW_PARTNER_FIXED_FEE: '0'}), {partnerPctFee: 0, partnerFixedFee: 0, baseCurrency: 'USD'});
});

test('partial, invalid or lossy configuration fails closed without defaulting', () => {
  for (const key of Object.keys(configured)) {
    const env = {...configured}; delete env[key];
    assert.throws(() => configuredRampnowPartnerFees(env), /RAMPNOW_FEE_CONFIG_INVALID/);
  }
  for (const value of ['', ' ', '01', '.5', '1e-2', '-1', 'Infinity', 'NaN', '0.1234567890123456789',
    '9007199254740993', '0.0000001', null, 1]) {
    for (const key of ['RAMPNOW_PARTNER_PCT_FEE', 'RAMPNOW_PARTNER_FIXED_FEE']) {
      assert.throws(() => configuredRampnowPartnerFees({...configured, [key]: value}), /RAMPNOW_FEE_CONFIG_INVALID/);
    }
  }
  for (const value of ['', 'usd', 'USD ', 'USDC', undefined]) {
    assert.throws(() => configuredRampnowPartnerFees({...configured, RAMPNOW_PARTNER_FEE_BASE_CURRENCY: value}),
      /RAMPNOW_FEE_CONFIG_INVALID/);
  }
  assert.throws(() => configuredRampnowPartnerFees({...configured, RAMPNOW_PARTNER_PCT_FEE: '100.01'}),
    /RAMPNOW_FEE_CONFIG_INVALID/);
  assert.throws(() => configuredRampnowPartnerFees({...configured, RAMPNOW_PARTNER_FIXED_FEE: '9007199254740992'}),
    /RAMPNOW_FEE_CONFIG_INVALID/);
});

test('protocol helper refuses one-sided or nonnumeric overrides', () => {
  for (const policy of [null, [], {}, {partnerPctFee: 1}, {partnerFixedFee: 1},
    {partnerPctFee: '1', partnerFixedFee: 1}, {partnerPctFee: 1, partnerFixedFee: -1},
    {partnerPctFee: NaN, partnerFixedFee: 1}, {partnerPctFee: 1, partnerFixedFee: Infinity}]) {
    assert.throws(() => rampnowPartnerFeeParameters(policy), /RAMPNOW_FEE_CONFIG_INVALID/);
  }
});
