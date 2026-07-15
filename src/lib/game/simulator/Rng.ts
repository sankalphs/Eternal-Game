// ============================================================================
// SIMULATOR — DETERMINISTIC RNG
//
// xorshift32 — small state, fast, deterministic, no allocations. Used
// everywhere in the simulator so millions of fights are reproducible.
//
// We never mutate global state. The Rng instance is owned by the runner
// and passed in. Callers must NOT depend on Math.random within a run.
// ============================================================================

export class Rng {
  private state: number;

  constructor(seed: number) {
    // xorshift32 requires a non-zero state
    this.state = (seed >>> 0) || 1;
  }

  /** Returns a number in [0, 1). */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  /** Integer in [min, max) (inclusive min, exclusive max). */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** Uniform float in [min, max). */
  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Gaussian via Box-Muller. Mean=0, stddev=1. */
  normal(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick one element. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)]!;
  }

  /** Fisher-Yates shuffle (in place, returns the same array). */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
    return arr;
  }

  /** Returns the current raw state (for checkpointing). */
  getState(): number {
    return this.state;
  }

  /** Restores the state from a checkpoint. */
  setState(state: number): void {
    this.state = (state >>> 0) || 1;
  }

  /** Derives a child seed deterministically. */
  derive(salt: number): Rng {
    return new Rng(this.mix(salt));
  }

  /** Mixes an integer into a new seed deterministically (FNV-1a + LCG step). */
  mix(salt: number): number {
    let h = 2166136261 ^ (salt | 0);
    h = Math.imul(h, 16777619);
    h = Math.imul(h ^ (this.state | 0), 16777619);
    return h >>> 0 || 1;
  }
}

// ----------------------------------------------------------------------------
// Determinism scopes
// ----------------------------------------------------------------------------
//
// `withDeterministicRandom` swaps the global Math.random for a callback
// duration. The combat engine uses Math.random in a few places (VFX
// spawns, hazard randomness, EnemyAI coin flips). For fully reproducible
// runs we override it.
//
// Restores the original on exit, even if the callback throws.
// ----------------------------------------------------------------------------

let installedOriginal: (() => number) | null = null;
let installedRng: Rng | null = null;

/** Replaces Math.random with a seeded Rng. */
export function installMathRandom(rng: Rng): void {
  if (installedOriginal) return; // already installed
  installedOriginal = Math.random;
  installedRng = rng;
  Math.random = rng.next.bind(rng);
}

/** Restores the original Math.random. */
export function uninstallMathRandom(): void {
  if (!installedOriginal) return;
  Math.random = installedOriginal;
  installedOriginal = null;
  installedRng = null;
}

/** True if installMathRandom is currently active. */
export function isMathRandomInstalled(): boolean {
  return installedOriginal !== null;
}

/** Runs fn with a deterministic Math.random. Restores on exit. */
export function withDeterministicRandom<T>(rng: Rng, fn: () => T): T {
  installMathRandom(rng);
  try {
    return fn();
  } finally {
    uninstallMathRandom();
  }
}
