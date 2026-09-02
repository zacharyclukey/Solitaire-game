/**
 * Deterministic, seedable RNG (mulberry32).
 *
 * Every run is reproducible from a single 32-bit seed, which makes bug reports,
 * daily challenges and the "replay this seed" feature trivial, and lets the
 * solver re-deal a level without any hidden state.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Raw float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Draw `n` distinct items without mutating the source. */
  sample<T>(arr: readonly T[], n: number): T[] {
    return this.shuffle(arr.slice()).slice(0, Math.min(n, arr.length));
  }

  /** Weighted pick. Entries with weight <= 0 are ignored. */
  weighted<T>(entries: readonly { item: T; weight: number }[]): T | null {
    let total = 0;
    for (const e of entries) if (e.weight > 0) total += e.weight;
    if (total <= 0) return null;
    let r = this.next() * total;
    for (const e of entries) {
      if (e.weight <= 0) continue;
      r -= e.weight;
      if (r <= 0) return e.item;
    }
    return entries[entries.length - 1].item;
  }

  fork(): Rng {
    return new Rng((this.s ^ (this.int(0xffffffff) >>> 0)) >>> 0);
  }
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Turns a short human-typeable string into a seed (for shareable seeds). */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Renders a seed as a 7-character code the player can share. */
export function seedToCode(seed: number): string {
  let n = seed >>> 0;
  let out = '';
  for (let i = 0; i < 7; i++) {
    out = SEED_ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}
