import {describe, expect, it} from 'vitest';
import {createRecoveryChallenge} from './recoveryChallenge';

describe('manual recovery confirmation challenge', () => {
  it('selects two distinct valid 1-based word positions (stored as zero-based indices)', () => {
    for (let count = 0; count < 64; count++) {
      const challenge = createRecoveryChallenge(12);
      expect(challenge[0]).toBeGreaterThanOrEqual(0);
      expect(challenge[1]).toBeLessThan(12);
      expect(challenge[0]).toBeLessThan(challenge[1]);
    }
  });

  it('asks for two fresh words when returning to the phrase and continuing again', () => {
    let previous = createRecoveryChallenge(12);
    for (let attempt = 0; attempt < 32; attempt++) {
      const next = createRecoveryChallenge(12, previous);
      expect(next.some(index => previous.includes(index))).toBe(false);
      previous = next;
    }
  });

  it('supports BIP39 24-word backups', () => {
    const first = createRecoveryChallenge(24);
    const second = createRecoveryChallenge(24, first);
    expect(second.some(index => first.includes(index))).toBe(false);
  });

  it('rejects impossible backup sizes', () => {
    expect(() => createRecoveryChallenge(2)).toThrow(RangeError);
  });
});
