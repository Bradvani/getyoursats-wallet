import {describe, expect, it} from 'vitest';
import type {LightningAddressInfo} from '@breeztech/breez-sdk-spark';
import {assertNativeLightningAddress, nativeLightningLookupUrl} from './nativeLightningAddress';

const address = (url: string): LightningAddressInfo => ({
  username: 'alice', lightningAddress: 'alice@getyoursats.com', description: 'Pay Alice',
  lnurl: {url, bech32: 'lnurl1fixture'},
});

describe('native Lightning address URLs', () => {
  it.each([
    ['https://getyoursats.com/.well-known/lnurlp/alice', 'https://getyoursats.com/.well-known/lnurlp/alice'],
    ['https://getyoursats.com/lnurlp/alice', 'https://getyoursats.com/lnurlp/alice'],
    ['lnurlp://getyoursats.com/.well-known/lnurlp/alice', 'https://getyoursats.com/.well-known/lnurlp/alice'],
    ['lnurlp://getyoursats.com/lnurlp/alice', 'https://getyoursats.com/lnurlp/alice'],
  ])('converts the validated %s address to its HTTPS lookup', (input, expected) => {
    const value = address(input);
    expect(() => assertNativeLightningAddress(value)).not.toThrow();
    expect(nativeLightningLookupUrl(value)).toBe(expected);
    expect(value.lnurl.url).toBe(input);
  });

  it.each([
    'http://getyoursats.com/lnurlp/alice',
    'lnurlw://getyoursats.com/lnurlp/alice',
    'file://getyoursats.com/lnurlp/alice',
    'javascript:alert(1)',
    'lnurlp://breez.tips/lnurlp/alice',
    'https://getyoursats.com.attacker.example/lnurlp/alice',
    'lnurlp://getyoursats.com.attacker.example/lnurlp/alice',
    'lnurlp://getyoursats.com./lnurlp/alice',
    'lnurlp://www.getyoursats.com/lnurlp/alice',
    'lnurlp://user@getyoursats.com/lnurlp/alice',
    'https://user:secret@getyoursats.com/lnurlp/alice',
    'https://@getyoursats.com/lnurlp/alice',
    'https://getyoursats.com:443/lnurlp/alice',
    'lnurlp://getyoursats.com:443/lnurlp/alice',
    'lnurlp://getyoursats.com/lnurlp/bob',
    'lnurlp://getyoursats.com/lnurlp/alice/invoice',
    'lnurlp://getyoursats.com/lnurlp/alice/',
    'lnurlp://getyoursats.com/lnurlp/alice?amount=1',
    'https://getyoursats.com/lnurlp/alice?',
    'lnurlp://getyoursats.com/lnurlp/alice#fragment',
    'https://getyoursats.com/lnurlp/alice#',
    'https://getyoursats.com/lnurlp/../lnurlp/alice',
    'lnurlp://getyoursats.com/lnurlp/%61lice',
    'https://getyoursats.com/lnurlp/alice%2f',
    ' https://getyoursats.com/lnurlp/alice',
    'lnurlp://getyoursats.com/lnurlp/alice\n',
    'https://getyoursats.com\\lnurlp\\alice',
  ])('rejects an altered provider URL before a lookup: %s', input => {
    expect(() => nativeLightningLookupUrl(address(input))).toThrow('Could not confirm your GetYourSats address');
  });

  it.each([
    {username: 'bob'},
    {username: '1alice'},
    {username: 'al'},
    {lightningAddress: 'bob@getyoursats.com'},
    {lightningAddress: 'alice@breez.tips'},
  ])('requires the provider username and Lightning address to agree', override => {
    expect(() => nativeLightningLookupUrl({...address('lnurlp://getyoursats.com/lnurlp/alice'), ...override}))
      .toThrow('Could not confirm your GetYourSats address');
  });
});
