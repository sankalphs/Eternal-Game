// ============================================================================
// PHASE 4: DATASET BALANCER
//
// A balanced training set should not over-represent any single bucket
// of skill, archetype, difficulty, etc. The Balancer identifies
// over-represented buckets and downsamples them, and flags
// under-represented buckets for collection.
//
// It never INVENTS samples. It only removes redundant ones.
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import type { RankedSample } from "./types";
import { extractBuckets, makeRng } from "./types";

export interface BalanceDimension {
  key: string;                   // "skill" | "archetype" | ...
  distribution: Record<string, number>;
  entropy: number;               // 0..1, 1 = perfectly uniform
  dominantBucket: string;
  dominantShare: number;         // 0..1
  isImbalanced: boolean;         // dominantShare > imbalanceThreshold
  removed: number;               // how many samples were downsampled
  underRepresented: string[];    // buckets with < minShare of total
}

export interface BalanceConfig {
  imbalanceThreshold: number;    // 0..1 — flag if a bucket exceeds this share
  minShare: number;              // 0..1 — flag if a bucket is below this share
  // Cap per bucket as a multiple of the most-balanced bucket's size.
  // 1.0 = strict uniform; 2.0 = no bucket larger than 2x the median.
  capMultiplier: number;
  // Random seed for downsampling determinism
  seed: number;
}

export const DEFAULT_BALANCE_CONFIG: BalanceConfig = {
  imbalanceThreshold: 0.35,
  minShare: 0.04,
  capMultiplier: 1.5,
  seed: 42,
};

export interface BalanceReport {
  total: number;
  removed: number;
  finalSize: number;
  dimensions: BalanceDimension[];
  overallEntropy: number;        // 0..1
  imbalancesDetected: number;
  flaggedBuckets: string[];      // "skill:novice=0.42" etc.
  summary: string;
}

export class DatasetBalancer {
  private config: BalanceConfig;

  constructor(config: Partial<BalanceConfig> = {}) {
    this.config = { ...DEFAULT_BALANCE_CONFIG, ...config };
  }

  /**
   * Return a rebalanced dataset. Within each over-represented bucket,
   * the lowest-quality samples are dropped first; ties are broken
   * deterministically.
   */
  rebalance(ranked: RankedSample[]): { samples: GameDesignSample[]; report: BalanceReport } {
    const samples = ranked.map(r => r.sample);
    const buckets = ranked.map(r => r.buckets);

    const dimensions: BalanceDimension[] = [];
    const allKeys: (keyof typeof buckets[number])[] = [
      "skill", "archetype", "campaignStage", "difficulty", "emotion",
      "bossStyle", "genome", "weather", "narrativeEvent", "winLoss", "adaptation",
    ];
    const removalSet = new Set<string>();
    const flagged: string[] = [];

    for (const dim of allKeys) {
      const dist: Record<string, number> = {};
      for (const b of buckets) {
        const v = String(b[dim] ?? "unknown");
        dist[v] = (dist[v] ?? 0) + 1;
      }
      const total = samples.length;
      const entropy = shannonEntropy(dist, total);
      const dominant = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
      const dominantShare = total > 0 ? dominant[1] / total : 0;
      const isImbalanced = dominantShare > this.config.imbalanceThreshold;
      const under = Object.entries(dist)
        .filter(([, c]) => total > 0 && c / total < this.config.minShare)
        .map(([k]) => k);

      let removed = 0;
      if (isImbalanced) {
        // Compute cap = median bucket size × capMultiplier
        const sizes = Object.values(dist).sort((a, b) => a - b);
        const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
        const cap = Math.max(1, Math.floor(median * this.config.capMultiplier));
        if (dominant[1] > cap) {
          // Drop lowest-quality samples in the dominant bucket
          const dominantBucket = dominant[0];
          const inBucket = ranked
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => String(r.buckets[dim] ?? "unknown") === dominantBucket);
          // Stable sort: lowest score first; ties broken by id hash.
          inBucket.sort((a, b) => {
            if (a.r.score !== b.r.score) return a.r.score - b.r.score;
            return a.r.sample.id.localeCompare(b.r.sample.id);
          });
          const toRemove = dominant[1] - cap;
          for (let k = 0; k < toRemove; k++) {
            removalSet.add(inBucket[k].r.sample.id);
            removed++;
          }
        }
        flagged.push(`${dim}:${dominant[0]}=${(dominantShare * 100).toFixed(1)}%`);
      }
      for (const u of under) {
        flagged.push(`${dim}:${u}=${((dist[u] ?? 0) / Math.max(1, total) * 100).toFixed(1)}%`);
      }

      dimensions.push({
        key: dim,
        distribution: dist,
        entropy,
        dominantBucket: dominant[0],
        dominantShare,
        isImbalanced,
        removed,
        underRepresented: under,
      });
    }

    const final = samples.filter(s => !removalSet.has(s.id));
    const overallEntropy = average(dimensions.map(d => d.entropy));

    return {
      samples: final,
      report: {
        total: samples.length,
        removed: samples.length - final.length,
        finalSize: final.length,
        dimensions,
        overallEntropy,
        imbalancesDetected: dimensions.filter(d => d.isImbalanced).length,
        flaggedBuckets: flagged,
        summary: this.summarise(dimensions, samples.length - final.length, overallEntropy),
      },
    };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private summarise(dims: BalanceDimension[], removed: number, entropy: number): string {
    const imbalanced = dims.filter(d => d.isImbalanced).length;
    return `Balanced ${dims.length} dimensions. Removed ${removed} redundant samples. ` +
      `Overall entropy: ${(entropy * 100).toFixed(1)}%. ` +
      `${imbalanced} dimension(s) imbalanced.`;
  }
}

// ---- Pure helpers ----
function shannonEntropy(dist: Record<string, number>, total: number): number {
  if (total === 0) return 0;
  const n = Object.keys(dist).length;
  if (n <= 1) return 0;
  let h = 0;
  for (const [, c] of Object.entries(dist)) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  const maxH = Math.log2(n);
  return maxH === 0 ? 0 : h / maxH;
}

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---- Optional: bucket-stratified sampling (used by the curriculum builder) ----
export function stratifiedSample<T>(
  items: T[],
  pick: (item: T) => string,
  capMultiplier: number,
  rngSeed: number,
): { picked: T[]; removed: number } {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const k = pick(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(it);
  }
  const sizes = [...buckets.values()].map(b => b.length).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const cap = Math.max(1, Math.floor(median * capMultiplier));
  const rng = makeRng(rngSeed);
  const picked: T[] = [];
  let removed = 0;
  for (const [, arr] of buckets) {
    if (arr.length <= cap) {
      picked.push(...arr);
    } else {
      // Shuffle with rng, take the first `cap`
      const copy = arr.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      picked.push(...copy.slice(0, cap));
      removed += arr.length - cap;
    }
  }
  return { picked, removed };
}
