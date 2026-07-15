// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — PARETO FRONTIER
//
// PHASE 5 of the publication-quality evaluation layer.
//
// Multi-objective Pareto analysis. Each subject has a vector of
// objective values. A point is on the Pareto frontier if no other
// point dominates it (i.e. is at least as good on every objective and
// strictly better on at least one).
//
// Objectives (default):
//   - winRate (maximize)
//   - behaviourDiversity (maximize)
//   - adaptationScore (maximize)
//   - entertainmentScore (maximize)
//   - duration (minimize — faster is better)
//   - challenge (maximize — how often the player is pushed)
//   - novelty (maximize)
//
// Exports: CSV, JSON, plot specification, frontier indices, dominated
// solutions.
//
// Reuses:
//   - ParetoPoint from research/types
// ============================================================================

import type { ParetoPoint, ParetoFrontier, Subject } from "./types";

// ----------------------------------------------------------------------------
// Objectives
// ----------------------------------------------------------------------------

export interface ObjectiveSpec {
  /** Objective name. */
  name: string;
  /** True to maximize, false to minimize. */
  maximize: boolean;
  /** Optional weight (used in hypervolume). */
  weight?: number;
}

export const DEFAULT_OBJECTIVES: ObjectiveSpec[] = [
  { name: "winRate", maximize: true, weight: 1.0 },
  { name: "behaviourDiversity", maximize: true, weight: 1.0 },
  { name: "adaptationScore", maximize: true, weight: 1.0 },
  { name: "entertainmentScore", maximize: true, weight: 1.0 },
  { name: "duration", maximize: false, weight: 1.0 },
  { name: "challenge", maximize: true, weight: 1.0 },
  { name: "novelty", maximize: true, weight: 1.0 },
];

// ----------------------------------------------------------------------------
// Pareto analysis
// ----------------------------------------------------------------------------

export function computeParetoFrontier(
  subjects: Subject[],
  objectiveValues: Map<string, Record<string, number>>,
  objectives: ObjectiveSpec[] = DEFAULT_OBJECTIVES,
): ParetoFrontier {
  // Build points
  const points: ParetoPoint[] = subjects.map(s => {
    const values = objectiveValues.get(s.id) ?? {};
    return {
      subjectId: s.id,
      objectives: { ...values },
      isFrontier: false,
      dominatedBy: [],
    };
  });
  // Determine dominance
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const dom = dominates(points[j]!, points[i]!, objectives);
      if (dom) points[i]!.dominatedBy.push(points[j]!.subjectId);
    }
  }
  // Frontier = non-dominated
  for (const p of points) p.isFrontier = p.dominatedBy.length === 0;
  const frontierIndices = points.map((p, i) => p.isFrontier ? i : -1).filter(i => i >= 0);
  // Hypervolume in 2D (objective 0 vs objective 1)
  let hypervolume: number | null = null;
  if (objectives.length === 2) {
    hypervolume = hypervolume2D(points, objectives);
  }
  return {
    points,
    frontierIndices,
    objectiveNames: objectives.map(o => o.name),
    maximize: Object.fromEntries(objectives.map(o => [o.name, o.maximize])),
    hypervolume,
    generatedAt: Date.now(),
  };
}

/** Check if point A dominates point B. */
export function dominates(a: ParetoPoint, b: ParetoPoint, objectives: ObjectiveSpec[]): boolean {
  let atLeastOne = false;
  for (const o of objectives) {
    const va = a.objectives[o.name];
    const vb = b.objectives[o.name];
    if (va === undefined || vb === undefined) continue;
    if (o.maximize) {
      if (va < vb) return false;
      if (va > vb) atLeastOne = true;
    } else {
      if (va > vb) return false;
      if (va < vb) atLeastOne = true;
    }
  }
  return atLeastOne;
}

/** 2D hypervolume (maximize both, ref point = (0, 0)). */
function hypervolume2D(points: ParetoPoint[], objectives: ObjectiveSpec[]): number {
  if (objectives.length < 2) return 0;
  const xName = objectives[0]!.name;
  const yName = objectives[1]!.name;
  const pts = points.map(p => ({
    x: p.objectives[xName] ?? 0,
    y: p.objectives[yName] ?? 0,
  })).filter(p => p.x > 0 && p.y > 0);
  if (pts.length === 0) return 0;
  // Sort by x desc
  pts.sort((a, b) => b.x - a.x);
  let hv = 0;
  let prevY = 0;
  for (const p of pts) {
    hv += p.x * Math.max(0, p.y - prevY);
    prevY = Math.max(prevY, p.y);
  }
  return hv;
}

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

export function renderParetoCsv(frontier: ParetoFrontier): string {
  const lines: string[] = ["subjectId,onFrontier,dominatedBy," + frontier.objectiveNames.join(",")];
  for (const p of frontier.points) {
    const objVals = frontier.objectiveNames.map(n => (p.objectives[n] ?? 0).toFixed(4));
    lines.push([
      p.subjectId, p.isFrontier ? "1" : "0",
      `"${p.dominatedBy.join("|")}"`,
      ...objVals,
    ].join(","));
  }
  return lines.join("\n");
}

export function renderParetoJson(frontier: ParetoFrontier): string {
  return JSON.stringify(frontier, null, 2);
}

export function renderParetoMd(frontier: ParetoFrontier): string {
  const lines: string[] = [];
  lines.push("# Pareto Frontier");
  lines.push("");
  lines.push(`Objectives: ${frontier.objectiveNames.join(", ")}`);
  lines.push(`Frontier size: ${frontier.frontierIndices.length}/${frontier.points.length}`);
  if (frontier.hypervolume !== null) {
    lines.push(`Hypervolume (2D): ${frontier.hypervolume.toFixed(4)}`);
  }
  lines.push("");
  lines.push("## Frontier (non-dominated)");
  lines.push("");
  lines.push("| Subject | " + frontier.objectiveNames.map(n => n).join(" | ") + " |");
  lines.push("|---" + frontier.objectiveNames.map(() => "|---:").join(""));
  for (const idx of frontier.frontierIndices) {
    const p = frontier.points[idx]!;
    const row = [p.subjectId];
    for (const n of frontier.objectiveNames) row.push((p.objectives[n] ?? 0).toFixed(3));
    lines.push("| " + row.join(" | ") + " |");
  }
  lines.push("");
  lines.push("## Dominated solutions");
  lines.push("");
  for (const p of frontier.points) {
    if (p.isFrontier) continue;
    if (p.dominatedBy.length === 0) continue;
    const objVals = frontier.objectiveNames.map(n => (p.objectives[n] ?? 0).toFixed(3)).join(", ");
    lines.push(`- ${p.subjectId} — dominated by [${p.dominatedBy.join(", ")}] — (${objVals})`);
  }
  return lines.join("\n");
}

/** Plot specification (JSON consumable by matplotlib / D3). */
export function renderParetoPlotSpec(frontier: ParetoFrontier, xObj = "winRate", yObj = "behaviourDiversity"): string {
  const points = frontier.points.map(p => ({
    subjectId: p.subjectId,
    x: p.objectives[xObj] ?? 0,
    y: p.objectives[yObj] ?? 0,
    onFrontier: p.isFrontier,
    dominatedBy: p.dominatedBy,
  }));
  return JSON.stringify({
    type: "scatter",
    title: `Pareto: ${xObj} vs ${yObj}`,
    x: { name: xObj, maximize: frontier.maximize[xObj] ?? true },
    y: { name: yObj, maximize: frontier.maximize[yObj] ?? true },
    points,
    frontierPoints: points.filter(p => p.onFrontier),
  }, null, 2);
}

// ----------------------------------------------------------------------------
// Convenience: build a frontier from a BenchmarkSuite
// ----------------------------------------------------------------------------

export function buildObjectiveMapFromBenchmark(
  reports: { subject: string; metrics: { winRate: number; behaviourDiversity: number; adaptationScore: number; playerEnjoymentProxy: number; fightLength: { mean: number; stddev: number } } }[],
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const r of reports) {
    out.set(r.subject, {
      winRate: r.metrics.winRate,
      behaviourDiversity: r.metrics.behaviourDiversity,
      adaptationScore: r.metrics.adaptationScore,
      entertainmentScore: r.metrics.playerEnjoymentProxy,
      duration: r.metrics.fightLength.mean,
      challenge: r.metrics.fightLength.stddev / Math.max(0.001, r.metrics.fightLength.mean),
      novelty: 0, // filled in by caller if available
    });
  }
  return out;
}
