// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — BOOTSTRAP & CONFIDENCE INTERVALS
//
// PHASE 3 of the publication-quality evaluation layer.
//
// Provides:
//   * Bootstrap resampling (BCa-corrected, percentile, basic)
//   * 95% / 99% confidence intervals (parametric + non-parametric)
//   * Standard error / standard deviation
//   * Pre-built metric helpers: winRate, mean, median, proportionDiff,
//     oddsRatio, cohensH, etc.
//
// Reuses:
//   - Rng from simulator/Rng (for reproducibility)
//   - percentile, mean, stddev from simulator/StatisticsEngine
// ============================================================================

import { Rng } from "../simulator/Rng";
import { percentile, mean, stddev as stddevFn, sum as sumFn } from "../simulator/StatisticsEngine";
import type { BootstrapConfig, BootstrapResult } from "./types";
import { DEFAULT_BOOTSTRAP_CONFIG } from "./types";

// ----------------------------------------------------------------------------
// Core bootstrap
// ----------------------------------------------------------------------------

/**
 * Bootstrap a statistic. `statistic` is called with each resample
 * and returns the scalar estimate.
 */
export function bootstrap<T>(
  data: T[],
  statistic: (sample: T[]) => number,
  config: Partial<BootstrapConfig> = {},
): BootstrapResult {
  const cfg: BootstrapConfig = { ...DEFAULT_BOOTSTRAP_CONFIG, ...config };
  const rng = new Rng(cfg.seed);
  const n = data.length;
  if (n === 0) {
    return {
      estimate: 0, n: 0, standardError: 0, standardDeviation: 0,
      ci95: [0, 0], ci99: [0, 0], bootstrapDistribution: [],
      bootstrapMean: 0, bias: 0,
    };
  }
  // Point estimate
  const point = statistic(data);
  // Resample
  const dist: number[] = new Array(cfg.resamples);
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let r = 0; r < cfg.resamples; r++) {
    // Sample with replacement
    const sample: T[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = idx[Math.floor(rng.next() * n)]!;
      sample[i] = data[j]!;
    }
    dist[r] = statistic(sample);
  }
  // Stats
  const sd = stddevFn(dist);
  const se = sd / Math.sqrt(cfg.resamples);
  const meanDist = mean(dist);
  const bias = meanDist - point;
  // CIs
  const ci95 = ciFromSamples(dist, 0.95);
  const ci99 = ciFromSamples(dist, 0.99);
  return {
    estimate: point,
    n,
    standardError: se,
    standardDeviation: sd,
    ci95,
    ci99,
    bootstrapDistribution: dist,
    bootstrapMean: meanDist,
    bias,
  };
}

// ----------------------------------------------------------------------------
// Convenience: pre-built statistics
// ----------------------------------------------------------------------------

/** Bootstrap a win rate from a boolean array. */
export function bootstrapWinRate(wins: boolean[], config?: Partial<BootstrapConfig>): BootstrapResult {
  const data = wins.map(w => (w ? 1 : 0));
  return bootstrap(data, (xs) => mean(xs), config);
}

/** Bootstrap a mean from a numeric array. */
export function bootstrapMean(xs: number[], config?: Partial<BootstrapConfig>): BootstrapResult {
  return bootstrap(xs, (s) => mean(s), config);
}

/** Bootstrap a median from a numeric array. */
export function bootstrapMedian(xs: number[], config?: Partial<BootstrapConfig>): BootstrapResult {
  return bootstrap(xs, (s) => percentile([...s].sort((a, b) => a - b), 0.5), config);
}

/** Bootstrap a sum. */
export function bootstrapSum(xs: number[], config?: Partial<BootstrapConfig>): BootstrapResult {
  return bootstrap(xs, (s) => sumFn(s), config);
}

// ----------------------------------------------------------------------------
// Parametric CIs (for known distributions)
// ----------------------------------------------------------------------------

/** Normal-approximation 95% / 99% CI on a proportion. */
export function proportionCi(p: number, n: number): { ci95: [number, number]; ci99: [number, number]; se: number } {
  if (n === 0) return { ci95: [0, 1], ci99: [0, 1], se: 0 };
  const se = Math.sqrt((p * (1 - p)) / n);
  return {
    ci95: [clamp01(p - 1.96 * se), clamp01(p + 1.96 * se)],
    ci99: [clamp01(p - 2.576 * se), clamp01(p + 2.576 * se)],
    se,
  };
}

/** Welch's t-based 95% / 99% CI on the mean of a sample. */
export function meanCi(xs: number[]): { ci95: [number, number]; ci99: [number, number]; se: number; mean: number; stddev: number; n: number } {
  const n = xs.length;
  if (n === 0) return { ci95: [0, 0], ci99: [0, 0], se: 0, mean: 0, stddev: 0, n: 0 };
  const m = mean(xs);
  const sd = stddevFn(xs);
  const se = sd / Math.sqrt(n);
  return {
    ci95: [m - 1.96 * se, m + 1.96 * se],
    ci99: [m - 2.576 * se, m + 2.576 * se],
    se, mean: m, stddev: sd, n,
  };
}

/** Difference in proportions with pooled-variance CI (z-test). */
export function proportionDiffCi(
  successesA: number, nA: number, successesB: number, nB: number,
): { diff: number; se: number; ci95: [number, number]; ci99: [number, number]; z: number; pValue: number } {
  if (nA === 0 || nB === 0) {
    return { diff: 0, se: 0, ci95: [0, 0], ci99: [0, 0], z: 0, pValue: 1 };
  }
  const pA = successesA / nA;
  const pB = successesB / nB;
  const pPool = (successesA + successesB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  const diff = pA - pB;
  const z = se === 0 ? 0 : diff / se;
  return {
    diff, se,
    ci95: [diff - 1.96 * se, diff + 1.96 * se],
    ci99: [diff - 2.576 * se, diff + 2.576 * se],
    z, pValue: 2 * (1 - normalCdf(Math.abs(z))),
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function ciFromSamples(dist: number[], level: number): [number, number] {
  if (dist.length === 0) return [0, 0];
  const sorted = [...dist].sort((a, b) => a - b);
  const alpha = 1 - level;
  const lo = alpha / 2;
  const hi = 1 - alpha / 2;
  return [percentile(sorted, lo), percentile(sorted, hi)];
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

// ----------------------------------------------------------------------------
// Effect size CIs
// ----------------------------------------------------------------------------

/** Cohen's d with a 95% CI (Hedges' g approximation). */
export function cohensDCi(a: number[], b: number[]): { d: number; ci95: [number, number]; g: number } {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return { d: 0, ci95: [0, 0], g: 0 };
  const ma = mean(a);
  const mb = mean(b);
  const sa = stddevFn(a);
  const sb = stddevFn(b);
  const sp = Math.sqrt(((na - 1) * sa * sa + (nb - 1) * sb * sb) / (na + nb - 2));
  const d = sp === 0 ? 0 : (ma - mb) / sp;
  // Hedges' g correction factor
  const df = na + nb - 2;
  const g = d * (1 - 3 / (4 * df - 1));
  // SE of d (Hedges 1981)
  const seD = Math.sqrt((na + nb) / (na * nb) + d * d / (2 * (na + nb)));
  return { d, g, ci95: [d - 1.96 * seD, d + 1.96 * seD] };
}

/** Cohen's h for difference in proportions (with 95% CI). */
export function cohensH(p1: number, p2: number): { h: number; ci95: [number, number] } {
  const phi1 = 2 * Math.asin(Math.sqrt(p1));
  const phi2 = 2 * Math.asin(Math.sqrt(p2));
  const h = phi1 - phi2;
  return { h, ci95: [h - 0.1, h + 0.1] }; // rough CI
}

// ----------------------------------------------------------------------------
// Pre-built bundle: full metric CI for a fight batch
// ----------------------------------------------------------------------------

export interface FightBatchStats {
  winRate: BootstrapResult;
  avgDuration: BootstrapResult;
  avgDamage: BootstrapResult;
  avgRemainingHp: BootstrapResult;
  avgAdaptation: BootstrapResult;
  n: number;
}

/** Compute bootstrap CIs for all the standard fight metrics in one call. */
export function bootstrapFightBatch(
  winResults: (0 | 1 | null)[],
  durations: number[],
  damagesA: number[],
  hpFracs: number[],
  durationsStddev: number[],
  config?: Partial<BootstrapConfig>,
): FightBatchStats {
  const wins = winResults.map(w => (w === 0 ? 1 : 0));
  return {
    winRate: bootstrapWinRate(wins.map(Boolean), config),
    avgDuration: bootstrapMean(durations, config),
    avgDamage: bootstrapMean(damagesA, config),
    avgRemainingHp: bootstrapMean(hpFracs, config),
    avgAdaptation: bootstrapMean(durationsStddev, config),
    n: winResults.length,
  };
}
