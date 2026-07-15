// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — STATISTICAL SIGNIFICANCE TESTS
//
// PHASE 8 of the publication-quality evaluation layer.
//
// Implements every test you would expect in a publication-quality
// RL evaluation paper:
//
//   * t-test (independent two-sample, paired)
//   * Welch's t-test
//   * Mann-Whitney U (non-parametric)
//   * Chi-square test of independence
//   * Permutation test
//   * Effect size: Cohen's d, Hedges' g, Cliff's delta
//
// Each test returns a TestResult with:
//   - statistic, pValue, significant (alpha = 0.05)
//   - effect size with 95% CI
//   - free-form interpretation
//
// Reuses:
//   - welchTTest, pairedTTest from simulator/StatisticsEngine
//   - cohensD, cohensDCi from research/Bootstrap
//   - Rng from simulator/Rng
// ============================================================================

import type { TestResult } from "./types";
import { Rng } from "../simulator/Rng";
import { welchTTest, pairedTTest, mean as meanFn, stddev as stddevFn } from "../simulator/StatisticsEngine";
import { cohensDCi } from "./Bootstrap";

// ----------------------------------------------------------------------------
// t-test
// ----------------------------------------------------------------------------

export function tTest(a: number[], b: number[]): TestResult {
  const r = welchTTest(a, b);
  const e = cohensDCi(a, b);
  return {
    test: "Welch's t-test",
    statistic: r.t,
    pValue: r.p,
    significant: r.p < 0.05,
    effectSize: e.d,
    effectCi95: e.ci95,
    n: a.length + b.length,
    interpretation: interpret("Welch's t", r.t, r.p, e.d),
  };
}

export function pairedTTestResult(a: number[], b: number[]): TestResult {
  const r = pairedTTest(a, b);
  // Paired Cohen's d
  const n = Math.min(a.length, b.length);
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) diffs.push(a[i]! - b[i]!);
  const d = stddevFn(diffs) === 0 ? 0 : meanFn(diffs) / stddevFn(diffs);
  return {
    test: "Paired t-test",
    statistic: r.t,
    pValue: r.p,
    significant: r.p < 0.05,
    effectSize: d,
    effectCi95: [d - 1.96 / Math.sqrt(n), d + 1.96 / Math.sqrt(n)],
    n,
    interpretation: interpret("Paired t", r.t, r.p, d),
  };
}

// ----------------------------------------------------------------------------
// Mann-Whitney U
// ----------------------------------------------------------------------------

export function mannWhitneyU(a: number[], b: number[]): TestResult {
  if (a.length === 0 || b.length === 0) {
    return { test: "Mann-Whitney U", statistic: 0, pValue: 1, significant: false, effectSize: 0, effectCi95: [0, 0], n: 0, interpretation: "Empty sample" };
  }
  // Rank-pool
  const all = a.map((v, i) => ({ v, g: 0 })).concat(b.map((v, i) => ({ v, g: 1 })));
  all.sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j < all.length && all[j]!.v === all[i]!.v) j++;
    const avg = (i + j - 1) / 2 + 1; // 1-based midrank
    for (let k = i; k < j; k++) ranks[k] = avg;
    i = j;
  }
  // Sum of ranks for group 0 (a)
  let R1 = 0;
  for (let k = 0; k < all.length; k++) if (all[k]!.g === 0) R1 += ranks[k]!;
  const n1 = a.length;
  const n2 = b.length;
  const U1 = R1 - n1 * (n1 + 1) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);
  // Normal approximation (with tie correction)
  const meanU = n1 * n2 / 2;
  let tieAdjust = 0;
  let ti = 1;
  while (ti < all.length) {
    let tj = ti;
    while (tj < all.length && all[tj]!.v === all[ti - 1]!.v) tj++;
    const count = tj - ti + 1;
    if (count > 1) tieAdjust += (count * count * count - count) / 12;
    ti = tj + 1;
  }
  const sdU = Math.sqrt((n1 * n2 / 12) * ((n1 + n2 + 1) - tieAdjust / (n1 * n2 * (n1 + n2))));
  const z = sdU === 0 ? 0 : (U - meanU) / sdU;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  // Cliff's delta effect size
  let more = 0, less = 0;
  for (const x of a) for (const y of b) {
    if (x > y) more++;
    else if (x < y) less++;
  }
  const cliff = (more - less) / (n1 * n2);
  return {
    test: "Mann-Whitney U",
    statistic: U,
    pValue,
    significant: pValue < 0.05,
    effectSize: cliff,
    effectCi95: [cliff - 1.96 * Math.sqrt((n1 * n2 + 1) / (3 * n1 * n2)), cliff + 1.96 * Math.sqrt((n1 * n2 + 1) / (3 * n1 * n2))],
    n: n1 + n2,
    interpretation: interpret("Mann-Whitney U", U, pValue, cliff),
  };
}

// ----------------------------------------------------------------------------
// Chi-square test
// ----------------------------------------------------------------------------

/** Chi-square test of independence on a 2x2 contingency table. */
export function chiSquare2x2(
  a: number, b: number, c: number, d: number,
): TestResult {
  const n = a + b + c + d;
  if (n === 0) {
    return { test: "Chi-square 2x2", statistic: 0, pValue: 1, significant: false, effectSize: 0, effectCi95: [0, 0], n: 0, interpretation: "Empty" };
  }
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const col2 = b + d;
  if (row1 === 0 || row2 === 0 || col1 === 0 || col2 === 0) {
    return { test: "Chi-square 2x2", statistic: 0, pValue: 1, significant: false, effectSize: 0, effectCi95: [0, 0], n, interpretation: "Zero margin" };
  }
  const eA = row1 * col1 / n;
  const eB = row1 * col2 / n;
  const eC = row2 * col1 / n;
  const eD = row2 * col2 / n;
  const chi2 = ((a - eA) ** 2 / eA) + ((b - eB) ** 2 / eB) + ((c - eC) ** 2 / eC) + ((d - eD) ** 2 / eD);
  const pValue = 1 - chi2Cdf(chi2, 1);
  // Phi coefficient as effect size
  const phi = Math.sqrt(chi2 / n);
  // Odds ratio
  const or = (b === 0 || c === 0) ? Infinity : (a * d) / (b * c);
  return {
    test: "Chi-square 2x2",
    statistic: chi2,
    pValue,
    significant: pValue < 0.05,
    effectSize: phi,
    effectCi95: [phi - 1.96 * Math.sqrt(1 / n), phi + 1.96 * Math.sqrt(1 / n)],
    n,
    interpretation: interpret("Chi-square", chi2, pValue, phi) + ` | odds ratio = ${or.toFixed(2)}`,
  };
}

/** Chi-square goodness-of-fit. */
export function chiSquareGof(observed: number[], expected: number[]): TestResult {
  if (observed.length !== expected.length) {
    return { test: "Chi-square GoF", statistic: 0, pValue: 1, significant: false, effectSize: 0, effectCi95: [0, 0], n: 0, interpretation: "Mismatched lengths" };
  }
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) {
    if (expected[i]! <= 0) continue;
    chi2 += (observed[i]! - expected[i]!) ** 2 / expected[i]!;
  }
  const df = observed.length - 1;
  const pValue = df > 0 ? 1 - chi2Cdf(chi2, df) : 1;
  return {
    test: "Chi-square GoF",
    statistic: chi2,
    pValue,
    significant: pValue < 0.05,
    effectSize: Math.sqrt(chi2 / (observed.reduce((a, b) => a + b, 0) || 1)),
    effectCi95: [0, 0],
    n: observed.length,
    interpretation: interpret("Chi-square GoF", chi2, pValue, 0),
  };
}

// ----------------------------------------------------------------------------
// Permutation test
// ----------------------------------------------------------------------------

/**
 * Permutation test for the difference in means (or a custom statistic).
 * `statistic` is called with each permuted split (a, b) and returns a
 * scalar; the p-value is the fraction of permutations that produce
 * a statistic at least as extreme as the observed.
 */
export function permutationTest(
  a: number[],
  b: number[],
  statistic: (a: number[], b: number[]) => number = (x, y) => meanFn(x) - meanFn(y),
  permutations = 10000,
  seed = 42,
): TestResult {
  const rng = new Rng(seed);
  const observed = statistic(a, b);
  const combined = [...a, ...b];
  const nA = a.length;
  let count = 0;
  for (let p = 0; p < permutations; p++) {
    // Shuffle
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [combined[i], combined[j]] = [combined[j]!, combined[i]!];
    }
    const aP = combined.slice(0, nA);
    const bP = combined.slice(nA);
    const sP = statistic(aP, bP);
    if (Math.abs(sP) >= Math.abs(observed)) count++;
  }
  const pValue = count / permutations;
  // Effect size = Cohen's d of the observed split
  const e = cohensDCi(a, b);
  return {
    test: `Permutation test (${permutations} reps)`,
    statistic: observed,
    pValue,
    significant: pValue < 0.05,
    effectSize: e.d,
    effectCi95: e.ci95,
    n: a.length + b.length,
    interpretation: interpret("Permutation", observed, pValue, e.d),
  };
}

// ----------------------------------------------------------------------------
// All-tests-in-one
// ----------------------------------------------------------------------------

export function allTests(a: number[], b: number[], labels: [string, string] = ["a", "b"]): TestResult[] {
  return [
    tTest(a, b),
    pairedTTestResult(a, b),
    mannWhitneyU(a, b),
    permutationTest(a, b),
  ];
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function interpret(test: string, stat: number, p: number, d: number): string {
  const sig = p < 0.001 ? "highly significant" : p < 0.01 ? "very significant" : p < 0.05 ? "significant" : "not significant";
  const dSize = Math.abs(d) < 0.2 ? "negligible" : Math.abs(d) < 0.5 ? "small" : Math.abs(d) < 0.8 ? "medium" : "large";
  return `${test}: statistic=${stat.toFixed(3)}, p=${p.toFixed(4)} (${sig}); effect size d=${d.toFixed(3)} (${dSize})`;
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

function chi2Cdf(x: number, df: number): number {
  if (x <= 0) return 0;
  return 1 - regularizedIncompleteGamma(df / 2, x / 2);
}

function regularizedIncompleteGamma(a: number, x: number): number {
  if (x === 0) return 0;
  if (x < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a;
  let c = 1e30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

function logGamma(x: number): number {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) { y += 1; ser += cof[j]! / y; }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
