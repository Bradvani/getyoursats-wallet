/**
 * Random name generator using color + animal pattern
 * Extracted from Misty Breez for Lightning Address usernames
 */

const COLORS = [
  "Salmon", "Blue", "Turquoise", "Orchid", "Purple", "Tomato", "Cyan", "Crimson",
  "Orange", "Lime", "Pink", "Green", "Red", "Yellow", "Azure", "Silver", "Magenta",
  "Olive", "Violet", "Rose", "Wine", "Mint", "Indigo", "Jade", "Coral"
] as const;

const ANIMALS = [
  "Bat", "Bear", "Boar", "Cat", "Chick", "Cow", "Deer", "Dog", "Eagle", "Elephant",
  "Fox", "Frog", "Hippo", "Hummingbird", "Koala", "Lion", "Monkey", "Mouse", "Owl",
  "Ox", "Panda", "Pig", "Rabbit", "Seagull", "Sheep", "Snake"
] as const;

function randomInt(maxExclusive: number): number {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure randomness is unavailable');
  }
  // Discard the incomplete final bucket so every name and suffix has the
  // same chance. An unavailable or failed CSPRNG must never use a fallback.
  const ceiling = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const sample = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(sample);
  } while (sample[0] >= ceiling);
  return sample[0] % maxExclusive;
}

/**
 * Generates a random name in the format "ColorAnimal" (e.g., "BlueFox")
 * Used for Lightning Address usernames and other display purposes
 */
export const generateRandomName = (): string => {
  const color = COLORS[randomInt(COLORS.length)];
  const animal = ANIMALS[randomInt(ANIMALS.length)];
  return `${color}${animal}`;
};

export const generateRandomNameSuffix = (): string => String(1000 + randomInt(9000));
