// ============================================================================
// SIMULATOR — STATISTICS ENGINE
//
// PHASE 6 of the research framework. Pure functions for descriptive and
// inferential statistics. Used by BenchmarkSuite, ExperimentManager, and
// the ReportWriter.
//
// No allocations in hot paths. All functions take a `samples: number[]`
// (or two) and return primitives or small objects.
// ============================================================================

// ----------------------------------------------------------------------------
// Descriptive statistics
// ----------------------------------------------------------------------------

export interface DescriptiveStats {
  n: number;
  mean: number;
  median: number;
  variance: number;
  stddev: number;
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  /** 95% confidence interval half-width. */
  ci95: number;
}

export function describe(samples: number[]): DescriptiveStats {
  const n = samples.length;
  if (n === 0) {
    return { n: 0, mean: 0, median: 0, variance: 0, stddev: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0, p95: 0, p99: 0, ci95: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sum(samples) / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (samples[i]! - mean) ** 2;
  variance = n > 1 ? variance / (n - 1) : 0;
  const stddev = Math.sqrt(variance);
  return {
    n,
    mean,
    median: percentile(sorted, 0.5),
    variance,
    stddev,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    ci95: 1.96 * (stddev / Math.sqrt(n)),
  };
}

export function sum(samples: number[]): number {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i]!;
  return s;
}

export function mean(samples: number[]): number {
  return samples.length === 0 ? 0 : sum(samples) / samples.length;
}

export function median(samples: number[]): number {
  if (samples.length === 0) return 0;
  return percentile([...samples].sort((a, b) => a - b), 0.5);
}

/** Linear-interpolation percentile. q in [0, 1]. */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const w = pos - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function variance(samples: number[]): number {
  if (samples.length < 2) return 0;
  const m = mean(samples);
  let v = 0;
  for (let i = 0; i < samples.length; i++) v += (samples[i]! - m) ** 2;
  return v / (samples.length - 1);
}

export function stddev(samples: number[]): number {
  return Math.sqrt(variance(samples));
}

// ----------------------------------------------------------------------------
// Shannon entropy
// ----------------------------------------------------------------------------

/** Normalized Shannon entropy in [0, 1]. */
export function shannonEntropy(probs: number[]): number {
  let total = 0;
  for (const p of probs) total += p;
  if (total === 0) return 0;
  let h = 0;
  for (const p of probs) {
    if (p > 0) {
      const q = p / total;
      h -= q * Math.log2(q);
    }
  }
  const max = Math.log2(Math.max(1, probs.length));
  return max === 0 ? 0 : h / max;
}

// ----------------------------------------------------------------------------
// Hypothesis testing
// ----------------------------------------------------------------------------

/** Two-sample Welch's t-test. Returns { t, df, p }. */
export function welchTTest(a: number[], b: number[]): { t: number; df: number; p: number } {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return { t: 0, df: 0, p: 1 };
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a);
  const vb = variance(b);
  const se = Math.sqrt(va / na + vb / nb);
  if (se === 0) return { t: 0, df: na + nb - 2, p: 1 };
  const t = (ma - mb) / se;
  const df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  // Two-tailed p-value via the Student-t survival function approximation.
  const p = 2 * tCdf(-Math.abs(t), df);
  return { t, df, p };
}

/** Paired t-test. Returns { t, df, p }. */
export function pairedTTest(a: number[], b: number[]): { t: number; df: number; p: number } {
  const n = Math.min(a.length, b.length);
  if (n < 2) return { t: 0, df: 0, p: 1 };
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) diffs.push(a[i]! - b[i]!);
  const md = mean(diffs);
  const vd = variance(diffs);
  if (vd === 0) return { t: 0, df: n - 1, p: 1 };
  const t = md / Math.sqrt(vd / n);
  const p = 2 * tCdf(-Math.abs(t), n - 1);
  return { t, df: n - 1, p };
}

/** Cohen's d effect size. */
export function cohensD(a: number[], b: number[]): number {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  const sa = stddev(a);
  const sb = stddev(b);
  const sp = Math.sqrt(((na - 1) * sa * sa + (nb - 1) * sb * sb) / (na + nb - 2));
  if (sp === 0) return 0;
  return (ma - mb) / sp;
}

// ----------------------------------------------------------------------------
// Histogram
// ----------------------------------------------------------------------------

export interface Histogram {
  binEdges: number[];
  binCounts: number[];
  binDensities: number[];
}

/** Equal-width histogram. */
export function histogram(samples: number[], binCount = 20): Histogram {
  if (samples.length === 0) return { binEdges: [], binCounts: [], binDensities: [] };
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  if (min === max) {
    return { binEdges: [min, max], binCounts: [samples.length], binDensities: [1] };
  }
  const edges: number[] = [];
  const counts: number[] = new Array(binCount).fill(0);
  const width = (max - min) / binCount;
  for (let i = 0; i <= binCount; i++) edges.push(min + i * width);
  for (const s of samples) {
    let idx = Math.floor((s - min) / width);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    counts[idx]!++;
  }
  const total = samples.length;
  const densities = counts.map(c => c / total);
  return { binEdges: edges, binCounts: counts, binDensities: densities };
}

// ----------------------------------------------------------------------------
// Rolling average
// ----------------------------------------------------------------------------

/** Windowed rolling average. */
export function rollingAverage(samples: number[], window: number): number[] {
  if (samples.length === 0 || window <= 0) return [];
  const out: number[] = new Array(samples.length).fill(0);
  let s = 0;
  for (let i = 0; i < samples.length; i++) {
    s += samples[i]!;
    if (i >= window) s -= samples[i - window]!;
    out[i] = s / Math.min(i + 1, window);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Trend
// ----------------------------------------------------------------------------

export interface TrendResult {
  /** Slope of the linear fit (per-index). */
  slope: number;
  /** Intercept. */
  intercept: number;
  /** Coefficient of determination (R^2). */
  r2: number;
  /** p-value of the slope. */
  p: number;
}

/** Linear regression on (i, samples[i]). */
export function linearTrend(samples: number[]): TrendResult {
  const n = samples.length;
  if (n < 2) return { slope: 0, intercept: samples[0] ?? 0, r2: 0, p: 1 };
  const xs: number[] = new Array(n);
  for (let i = 0; i < n; i++) xs[i] = i;
  const mx = mean(xs);
  const my = mean(samples);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = samples[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return { slope: 0, intercept: my, r2: 0, p: 1 };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  // t-stat for slope
  const sse = syy - slope * sxy;
  const sigma2 = sse / (n - 2);
  const se = Math.sqrt(sigma2 / sxx);
  const t = se === 0 ? 0 : slope / se;
  const p = 2 * tCdf(-Math.abs(t), n - 2);
  return { slope, intercept, r2, p };
}

// ----------------------------------------------------------------------------
// Correlation
// ----------------------------------------------------------------------------

/** Pearson correlation. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = a[i]! - ma;
    const dy = b[i]! - mb;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Correlation matrix. */
export function correlationMatrix(rows: number[][]): number[][] {
  const k = rows.length;
  const m: number[][] = new Array(k);
  for (let i = 0; i < k; i++) {
    m[i] = new Array(k).fill(0);
    for (let j = i; j < k; j++) {
      const c = i === j ? 1 : correlation(rows[i]!, rows[j]!);
      m[i]![j] = c;
      m[j]![i] = c;
    }
  }
  return m;
}

// ----------------------------------------------------------------------------
// Student-t CDF approximation
// ----------------------------------------------------------------------------

/** Approximation of the Student-t CDF (Lenth, 1987 / Abramowitz & Stegun). */
function tCdf(t: number, df: number): number {
  if (df <= 0) return 0.5;
  const x = df / (df + t * t);
  // Regularized incomplete beta
  const ib = incBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Continued fraction (Numerical Recipes)
  const maxIter = 100;
  const eps = 1e-10;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return Math.exp(
    a * Math.log(x) + b * Math.log(1 - x) +
    Math.log(h) - Math.log(a) - logBeta(a, b),
  );
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
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
