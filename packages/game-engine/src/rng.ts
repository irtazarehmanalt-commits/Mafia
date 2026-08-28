import { randomInt } from 'node:crypto';

/**
 * Injectable randomness. Production uses a CSPRNG (role assignment must not be
 * predictable); tests inject a deterministic generator.
 */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Cryptographically secure — the default everywhere outside tests. */
export const cryptoRng: Rng = {
  int(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0;
    return randomInt(maxExclusive);
  },
};

/** Deterministic mulberry32, for reproducible tests only. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    int(maxExclusive: number): number {
      if (maxExclusive <= 1) return 0;
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * maxExclusive);
    },
  };
}

/** Fisher–Yates. Returns a new array; the input is untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function pickOne<T>(items: readonly T[], rng: Rng): T | null {
  if (items.length === 0) return null;
  return items[rng.int(items.length)] as T;
}
