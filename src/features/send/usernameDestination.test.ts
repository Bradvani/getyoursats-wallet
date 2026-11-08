import {describe, expect, it} from 'vitest';
import {usernameDestination} from './usernameDestination';

describe('GetYourSats username destination', () => {
  it.each(['shiv', 'Shiv', ' SHIV ', 'sats123', 'a'.repeat(24)])('completes a bare username visibly: %s', input => {
    expect(usernameDestination(input)).toBe(`${input.trim().toLowerCase()}@getyoursats.com`);
  });

  it.each([
    '', 'sh', 'a'.repeat(25), '1shiv', 'my-name', 'my_name', 'shiv kumar', '@shiv',
    'shiv@getyoursats.com', 'shiv@other.example', 'SHIV@Other.Example', 'example.com',
    'https://example.com/pay/shiv', 'bitcoin:bc1synthetic', 'lightning:lnbc1synthetic',
    'lnurlp://example.com/pay', 'bc1short', 'tb1short', 'bcrt1short', 'LNBC1SHORT',
    'lntb1short', 'lnbcrt1short', 'lnsb1short', 'lnurl1short', 'lno1short', 'lni1short', 'lnr1short',
    'spark1short', 'sparkt1short', 'sparkrt1short', 'sp1short', 'tsp1short',
    '0x1111111111111111111111111111111111111111', 'So11111111111111111111111111111111111111112',
    'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
  ])('preserves a formatted, ambiguous or unsupported input: %s', input => {
    expect(usernameDestination(input)).toBeNull();
  });
});
