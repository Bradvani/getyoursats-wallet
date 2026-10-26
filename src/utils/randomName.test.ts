import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateRandomName, generateRandomNameSuffix } from './randomName';

function samples(values: number[]) {
  const remaining = [...values];
  return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
    if (!(array instanceof Uint32Array)) throw new Error('Expected a 32-bit sample');
    const value = remaining.shift();
    if (value === undefined) throw new Error('No more test samples');
    array[0] = value;
    return array;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('anonymous Lightning names', () => {
  it('preserves the color-animal format, casing and existing maximum length', () => {
    samples([0, 0, 24, 25, 2, 13]);
    expect(generateRandomName()).toBe('SalmonBat');
    expect(generateRandomName()).toBe('CoralSnake');
    const longest = generateRandomName();
    expect(longest).toBe('TurquoiseHummingbird');
    expect(longest).toHaveLength(20);
  });

  it('keeps collision suffixes within the four-digit range', () => {
    samples([0, 8999]);
    expect(generateRandomNameSuffix()).toBe('1000');
    expect(generateRandomNameSuffix()).toBe('9999');
  });

  it('rejects biased samples for both name choices and collision suffixes', () => {
    const random = samples([0xffffffff, 1, 0xffffffff, 10, 0xffffffff, 8999]);
    expect(generateRandomName()).toBe('BlueFox');
    expect(generateRandomNameSuffix()).toBe('9999');
    expect(random).toHaveBeenCalledTimes(6);
  });

  it('fails closed when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(generateRandomName).toThrow('Secure randomness is unavailable');
    expect(generateRandomNameSuffix).toThrow('Secure randomness is unavailable');
  });

  it('propagates a CSPRNG failure without generating a substitute name', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => { throw new Error('CSPRNG failed'); });
    expect(generateRandomName).toThrow('CSPRNG failed');
    expect(generateRandomNameSuffix).toThrow('CSPRNG failed');
  });
});
