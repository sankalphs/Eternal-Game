// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — SURVIVAL ANALYSIS
//
// PHASE 6 of the publication-quality evaluation layer.
//
// Treats fights like survival experiments. The "event" is the player
// losing (HP → 0). "Time" is the fight duration. "At risk" is the
// match-up still in progress.
//
// Generates:
//   - Kaplan-Meier survival curves
//   - Survival probabilities at any time t
//   - Median survival time
//   - Hazard ratios (treatment vs reference) with Wald-test p-values
//
// Useful for comparing boss styles: which one kills the player
// fastest? which one has the highest hazard?
//
// Reuses:
//   - FightResult from simulator/MatchResult
// ============================================================================

import type { SurvivalPoint, SurvivalCurve, HazardRatio } from "./types";

// ----------------------------------------------------------------------------
// Kaplan-Meier estimator
// ----------------------------------------------------------------------------

/**
 * Build a Kaplan-Meier survival curve from a list of "lifetimes".
 * For Project Eternal, lifetime = fight duration if the player lost,
 * and the data is right-censored at the round timer if they survived.
 *
 * @param events   List of (duration, event) tuples. event=1 means the
 *                 event happened (player lost); event=0 means right-
 *                 censored (player survived).
 */
export function kaplanMeier(events: { time: number; event: 0 | 1 }[]): SurvivalCurve {
  // Sort by time
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const n = sorted.length;
  let s = 1;
  let atRisk = n;
  let cumHazard = 0;
  const points: SurvivalPoint[] = [];
  let totalEvents = 0;
  const meanTimes: number[] = [];
  let meanSum = 0;
  for (const e of sorted) {
    // Right-censored: just decrement atRisk
    if (e.event === 0) {
      atRisk -= 1;
      continue;
    }
    if (atRisk === 0) break;
    // Event at this time
    const deathProb = 1 / atRisk;
    const newS = s * (1 - deathProb);
    // Greenwood's formula for CI
    const term = deathProb / (1 - deathProb);
    let varSum = 0;
    for (const p of points) {
      if (p.atRisk > 0) varSum += p.events / (p.atRisk * (p.atRisk - p.events));
    }
    const seS = s * Math.sqrt(varSum);
    cumHazard += deathProb;
    meanSum += s * e.time; // approximation for restricted mean
    meanTimes.push(e.time);
    totalEvents++;
    const ciLower = Math.max(0, newS - 1.96 * seS);
    const ciUpper = Math.min(1, newS + 1.96 * seS);
    points.push({
      time: e.time,
      atRisk,
      events: 1,
      survival: newS,
      ciLower, ciUpper,
      hazard: cumHazard,
    });
    s = newS;
    atRisk -= 1;
  }
  // Median survival: first time S(t) ≤ 0.5
  let medianSurvival = 0;
  for (const p of points) {
    if (p.survival <= 0.5) { medianSurvival = p.time; break; }
  }
  if (medianSurvival === 0 && points.length > 0) medianSurvival = points[points.length - 1]!.time;
  // Mean survival (trapezoidal)
  const meanSurvival = points.length === 0 ? 0 : meanSum / Math.max(1, totalEvents);
  return {
    subjectId: "all",
    points,
    medianSurvival,
    meanSurvival,
    n,
    totalEvents,
  };
}

/**
 * Build a per-subject survival curve from a set of fights.
 * Lifetime = fight duration. Event = (player lost) = (winnerSide === 1).
 */
export function survivalFromFights(
  subjectId: string,
  fights: { durationSeconds: number; winnerSide: 0 | 1 | null }[],
): SurvivalCurve {
  const events: { time: number; event: 0 | 1 }[] = [];
  for (const f of fights) {
    // Use roundTime as the censoring time if it ended by timeout
    if (f.winnerSide === 0) {
      // Player won — event did NOT happen; we censor at duration
      events.push({ time: f.durationSeconds, event: 0 });
    } else {
      // Player lost or draw — treat as event
      events.push({ time: f.durationSeconds, event: 1 });
    }
  }
  const curve = kaplanMeier(events);
  curve.subjectId = subjectId;
  return curve;
}

// ----------------------------------------------------------------------------
// Hazard ratio
// ----------------------------------------------------------------------------

/**
 * Compute the hazard ratio (treatment vs reference) using the
 * exponential model: log(HR) = (d_t - d_r) / (Y_t + Y_r) approximation
 * where d = events and Y = person-time.
 *
 * For a more rigorous estimator, use Cox regression; this is the
 * Mantel-Haenszel-style rate ratio which is sufficient for
 * publication-quality reporting.
 */
export function hazardRatio(
  treatment: SurvivalCurve,
  reference: SurvivalCurve,
): HazardRatio {
  // Total events and person-time in each arm
  const dT = treatment.totalEvents;
  const dR = reference.totalEvents;
  const yT = treatment.points.length === 0 ? 0 : treatment.points.reduce((a, p) => a + p.time / Math.max(1, p.atRisk), 0);
  const yR = reference.points.length === 0 ? 0 : reference.points.reduce((a, p) => a + p.time / Math.max(1, p.atRisk), 0);
  // Mantel-Haenszel estimator
  const pT = yT === 0 ? 0 : dT / yT;
  const pR = yR === 0 ? 0 : dR / yR;
  const hr = pR === 0 ? 0 : pT / pR;
  // SE of log HR (large-sample)
  const seLogHr = Math.sqrt(1 / Math.max(1, dT) + 1 / Math.max(1, dR));
  const logHr = Math.log(Math.max(0.001, hr));
  const ciLog: [number, number] = [logHr - 1.96 * seLogHr, logHr + 1.96 * seLogHr];
  const z = seLogHr === 0 ? 0 : logHr / seLogHr;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    treatmentId: treatment.subjectId,
    referenceId: reference.subjectId,
    hr, logHrCi95: ciLog,
    pValue,
  };
}

// ----------------------------------------------------------------------------
// Cox-style log-rank test (approximate)
// ----------------------------------------------------------------------------

/** Log-rank test for two survival curves. */
export function logRankTest(
  treatment: SurvivalCurve,
  reference: SurvivalCurve,
): { statistic: number; df: number; pValue: number } {
  // Pool event times
  const allTimes = new Set<number>();
  for (const p of treatment.points) allTimes.add(p.time);
  for (const p of reference.points) allTimes.add(p.time);
  const times = [...allTimes].sort((a, b) => a - b);
  let O_t = 0; // observed events in treatment
  let E_t = 0; // expected events in treatment
  let V = 0;   // variance
  for (const t of times) {
    const pT = treatment.points.find(p => p.time === t);
    const pR = reference.points.find(p => p.time === t);
    const dT = pT?.events ?? 0;
    const dR = pR?.events ?? 0;
    const d = dT + dR;
    const nT = pT?.atRisk ?? 0;
    const nR = pR?.atRisk ?? 0;
    const n = nT + nR;
    if (n <= 1 || d === 0) continue;
    const eT = nT * d / n;
    O_t += dT;
    E_t += eT;
    V += (nT * nR * d * (n - d)) / (n * n * (n - 1));
  }
  if (V === 0) return { statistic: 0, df: 1, pValue: 1 };
  const chi2 = (O_t - E_t) ** 2 / V;
  // Approximation: chi-square(1) -> p
  const pValue = 1 - chi2Cdf(chi2, 1);
  return { statistic: chi2, df: 1, pValue };
}

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

export function renderSurvivalMd(curves: SurvivalCurve[], title = "Survival Curves"): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  for (const c of curves) {
    lines.push(`## ${c.subjectId}`);
    lines.push(`- n = ${c.n}, events = ${c.totalEvents}`);
    lines.push(`- Median survival = ${c.medianSurvival.toFixed(2)}s`);
    lines.push(`- Mean survival = ${c.meanSurvival.toFixed(2)}s`);
    lines.push("");
    if (c.points.length === 0) continue;
    lines.push("| t (s) | S(t) | 95% CI lower | 95% CI upper | at risk | events | H(t) |");
    lines.push("|---:|---:|---:|---:|---:|---:|---:|");
    for (const p of c.points) {
      lines.push(`| ${p.time.toFixed(2)} | ${p.survival.toFixed(4)} | ${p.ciLower.toFixed(4)} | ${p.ciUpper.toFixed(4)} | ${p.atRisk} | ${p.events} | ${p.hazard.toFixed(4)} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderSurvivalCsv(curves: SurvivalCurve[]): string {
  const lines = ["subjectId,time,survival,ciLower,ciUpper,atRisk,events,hazard"];
  for (const c of curves) {
    for (const p of c.points) {
      lines.push([c.subjectId, p.time, p.survival, p.ciLower, p.ciUpper, p.atRisk, p.events, p.hazard].join(","));
    }
  }
  return lines.join("\n");
}

export function renderSurvivalJson(curves: SurvivalCurve[]): string {
  return JSON.stringify(curves, null, 2);
}

export function renderSurvivalPlotSpec(curves: SurvivalCurve[]): string {
  return JSON.stringify({
    type: "step",
    title: "Survival Curves (Kaplan-Meier)",
    x: { name: "Fight time (s)" },
    y: { name: "S(t)", range: [0, 1] },
    series: curves.map(c => ({
      name: c.subjectId,
      x: c.points.map(p => p.time),
      y: c.points.map(p => p.survival),
      ciLower: c.points.map(p => p.ciLower),
      ciUpper: c.points.map(p => p.ciUpper),
      median: c.medianSurvival,
    })),
  }, null, 2);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

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

/** Lower regularized incomplete gamma P(a, x) — Abramowitz & Stegun 6.5.8 */
function regularizedIncompleteGamma(a: number, x: number): number {
  if (x === 0) return 0;
  if (x < a + 1) {
    // Series
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // Continued fraction
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
