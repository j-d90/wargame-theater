// Seeded PRNG (sfc32, seeded via cyrb128). The state is a plain object so it
// lives inside the world state: it is hashed, snapshotted, and restored with it.
// This is the only source of randomness the sim may use.

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Create an independent stream for (seed, label). Each sim system uses its own
 * label so adding draws in one system never shifts another system's numbers.
 */
export function createRng(seed: number, label = 'main'): RngState {
  const [a, b, c, d] = cyrb128(`${seed}:${label}`);
  const state: RngState = { a, b, c, d };
  for (let i = 0; i < 15; i++) nextU32(state);
  return state;
}

/** Next uniform 32-bit unsigned integer. Mutates the state. */
export function nextU32(s: RngState): number {
  const t = (((s.a + s.b) | 0) + s.d) | 0;
  s.d = (s.d + 1) | 0;
  s.a = s.b ^ (s.b >>> 9);
  s.b = (s.c + (s.c << 3)) | 0;
  s.c = (s.c << 21) | (s.c >>> 11);
  s.c = (s.c + t) | 0;
  return t >>> 0;
}

/** Uniform float in [0, 1). */
export function nextFloat(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** Uniform integer in [min, max], both inclusive. */
export function nextInt(s: RngState, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`nextInt: bad range [${min}, ${max}]`);
  }
  return min + Math.floor(nextFloat(s) * (max - min + 1));
}
