/**
 * Select new BIP39 backup confirmation positions whenever the user enters
 * verification. Keep the mnemonic unchanged and prefer two positions that
 * were not shown in the previous challenge.
 *
 * Use rejection sampling on crypto.getRandomValues to avoid modulo bias.
 * Never use Math.random for recovery verification prompts.
 */
function randomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0xffffffff) {
    throw new RangeError('Invalid challenge range');
  }
  const range = 0x100000000;
  const ceiling = Math.floor(range / maxExclusive) * maxExclusive;
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= ceiling);
  return sample[0] % maxExclusive;
}

export type RecoveryChallenge = readonly [number, number];

export function createRecoveryChallenge(
  wordCount: number,
  previous?: RecoveryChallenge,
): RecoveryChallenge {
  if (!Number.isSafeInteger(wordCount) || wordCount < 4) {
    throw new RangeError('A recovery phrase must contain at least four words');
  }

  const available = Array.from({length: wordCount}, (_, index) => index)
    .filter(index => !previous?.includes(index));
  // With BIP39 12/24-word backups, both positions are always fresh.
  const first = randomInt(available.length);
  const [firstPosition] = available.splice(first, 1);
  const second = randomInt(available.length);
  const secondPosition = available[second];

  return firstPosition < secondPosition
    ? [firstPosition, secondPosition]
    : [secondPosition, firstPosition];
}
