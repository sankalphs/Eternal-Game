// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — MATCHUP MATRIX
//
// PHASE 2 of the publication-quality evaluation layer.
//
// Builds the complete NxN matchup matrix. Every subject fights every
// other subject. Each cell reports:
//
//   - Win %
//   - Average damage dealt
//   - Average duration
//   - Average remaining HP
//   - Average adaptation score
//   - 95% CI on win rate
//   - Standard error on win rate
//   - p-value (vs 50% baseline)
//
// Exports: CSV, JSON, Markdown, Heatmap specification.
//
// Reuses:
//   - SimulationRunner from simulator/
//   - bootstrapWinRate, meanCi from research/Bootstrap
//   - Rng from simulator/Rng
// ============================================================================

import type { Subject, MatchupCell, MatchupMatrix } from "./types";
import { SimulationRunner, type RunFightParams, type RunSeriesParams } from "../simulator/SimulationRunner";
import { defaultOpponent } from "../simulator/HeadlessEngine";
import { createAgentById } from "../evolution/agents";
import { type IGenome } from "../evolution/types";
import { genomeToOpponentDef, opponentDefToGenome } from "../evolution/GenomeSerializer";
import { proportionCi, meanCi, proportionDiffCi } from "./Bootstrap";
import { Rng } from "../simulator/Rng";

// ----------------------------------------------------------------------------
// Matrix builder
// ----------------------------------------------------------------------------

export interface MatchupMatrixConfig {
  /** Matches per (row, col) cell. */
  matchesPerCell: number;
  /** Master seed. */
  seed: number;
  /** If true, also fill the symmetric (col, row) cell from the same data. */
  symmetric: boolean;
  /** Optional: only fill cells where rowId ∈ includeRows. */
  includeRows?: string[];
  /** Optional: skip cells where colId ∈ excludeCols. */
  excludeCols?: string[];
  /** Time step (default 1/30 for speed). */
  timeStep?: number;
  /** Optional: progress callback. */
  onProgress?: (current: number, total: number, rowId: string, colId: string) => void;
}

export const DEFAULT_MATCHUP_MATRIX_CONFIG: MatchupMatrixConfig = {
  matchesPerCell: 50,
  seed: 42,
  symmetric: true,
  timeStep: 1 / 30,
};

/** A single subject's "shape" — what the runner needs to spawn it. */
export interface SubjectAdapter {
  /** Resolve the sideA/sideB params for a given seed. */
  toFightParams(subjectId: string, side: 0 | 1, seed: number): RunFightParams;
  /** Resolve the id of the opponent archetype to use. */
  opponentArchetypeIdFor(subjectId: string): string;
}

export const DefaultSubjectAdapter: SubjectAdapter = {
  toFightParams(subjectId, side, seed) {
    // Look up the subject via the SubjectRegistry — but the default
    // adapter is permissive and lets the caller pass an already-resolved
    // OpponentDef via subjectId. The actual implementation is in
    // buildMatchupMatrix below, which has the subject list.
    throw new Error("DefaultSubjectAdapter: pass a custom adapter");
  },
  opponentArchetypeIdFor() { return "aggressive"; },
};

/**
 * Build the full NxN matchup matrix.
 *
 * @param subjects  All subjects in the matrix
 * @param runner    A SimulationRunner
 * @param adapter   Converts a subject into RunFightParams
 * @param config    Per-cell config
 */
export async function buildMatchupMatrix(
  subjects: Subject[],
  runner: SimulationRunner,
  adapter: SubjectAdapter,
  config: Partial<MatchupMatrixConfig> = {},
): Promise<MatchupMatrix> {
  const cfg: MatchupMatrixConfig = { ...DEFAULT_MATCHUP_MATRIX_CONFIG, ...config };
  const cells: MatchupCell[] = [];
  const subjectIds = subjects.map(s => s.id);
  // Total cells
  let total = 0;
  for (let i = 0; i < subjects.length; i++) {
    for (let j = 0; j < subjects.length; j++) {
      if (cfg.excludeCols?.includes(subjectIds[j]!)) continue;
      total++;
    }
  }
  let current = 0;
  for (let i = 0; i < subjects.length; i++) {
    for (let j = 0; j < subjects.length; j++) {
      const rowId = subjectIds[i]!;
      const colId = subjectIds[j]!;
      if (cfg.excludeCols?.includes(colId)) continue;
      if (cfg.includeRows && !cfg.includeRows.includes(rowId)) continue;
      const cell = await buildCell(rowId, colId, runner, adapter, cfg);
      cells.push(cell);
      current++;
      cfg.onProgress?.(current, total, rowId, colId);
    }
  }
  return {
    subjectIds,
    cells,
    symmetric: cfg.symmetric,
    generatedAt: Date.now(),
  };
}

// ----------------------------------------------------------------------------
// Single cell
// ----------------------------------------------------------------------------

async function buildCell(
  rowId: string,
  colId: string,
  runner: SimulationRunner,
  adapter: SubjectAdapter,
  cfg: MatchupMatrixConfig,
): Promise<MatchupCell> {
  const wins: number[] = [];
  const durations: number[] = [];
  const damages: number[] = [];
  const hpFracs: number[] = [];
  const adaptation: number[] = [];
  for (let m = 0; m < cfg.matchesPerCell; m++) {
    const seed = (cfg.seed + m * 1009 + hashStr(rowId) * 31 + hashStr(colId)) >>> 0;
    // Resolve params for row = subject, col = subject
    const paramsRow = adapter.toFightParams(rowId, 0, seed);
    const paramsCol = adapter.toFightParams(colId, 1, seed);
    // Run a single fight where row plays on sideA
    const series = runner.runSeries({
      ...paramsRow,
      sideA: paramsRow.sideA,
      sideB: paramsCol.sideB,
      seed,
      n: 1,
      matchType: "ga_vs_ga",
      config: { ...(paramsRow.config ?? {}), timeStep: cfg.timeStep, drainVfx: true, deterministic: true, fastRoundTransitions: true },
    });
    const f = series.fights[0]!;
    wins.push(f.winnerSide === 0 ? 1 : f.winnerSide === 1 ? 0 : 0.5);
    durations.push(f.durationSeconds);
    damages.push(f.sideA.damageDealt);
    hpFracs.push(f.sideA.hpFrac);
    adaptation.push(f.sideA.distanceStdDev);
  }
  const winRate = wins.reduce((a, b) => a + b, 0) / Math.max(1, wins.length);
  const avgDamage = damages.reduce((a, b) => a + b, 0) / Math.max(1, damages.length);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);
  const avgHp = hpFracs.reduce((a, b) => a + b, 0) / Math.max(1, hpFracs.length);
  const avgAdapt = adaptation.reduce((a, b) => a + b, 0) / Math.max(1, adaptation.length);
  // Parametric CI on win rate
  const propCi = proportionCi(winRate, wins.length);
  // p-value vs 50%
  const pValue = 2 * (1 - normalCdf(Math.abs((winRate - 0.5) / Math.max(0.0001, propCi.se))));
  return {
    rowId, colId,
    n: wins.length,
    winRate, avgDamage, avgDuration, avgRemainingHp: avgHp, avgAdaptation: avgAdapt,
    winRateCi95: propCi.ci95[1] - winRate,
    winRateSe: propCi.se,
    pValue,
  };
}

// ----------------------------------------------------------------------------
// Convenience: build a SubjectAdapter from a list of Subjects
// ----------------------------------------------------------------------------

export function makeSubjectAdapter(
  subjects: Subject[],
  defaultArchetype = "aggressive",
): SubjectAdapter {
  const byId = new Map<string, Subject>();
  for (const s of subjects) byId.set(s.id, s);
  return {
    toFightParams(subjectId, side, seed) {
      const subj = byId.get(subjectId);
      if (!subj) throw new Error(`Subject not found: ${subjectId}`);
      // Convert subject to sideA/sideB
      if (subj.kind === "player_archetype") {
        // The "subject" is a script; sideB is an opponent
        return {
          sideA: defaultOpponent(0),
          sideB: defaultOpponent(0),
          sideAAgent: createAgentById(subjectId),
          sideBAgent: undefined,
          seed,
          matchType: "ga_vs_archetype",
          config: { timeStep: 1 / 30, drainVfx: true, deterministic: true, fastRoundTransitions: true },
        };
      }
      // Genome-driven
      const genome = subj.genome;
      const opp = defaultOpponent(0);
      return {
        sideA: genome ?? opp,
        sideB: opp,
        sideAAgent: undefined,
        sideBAgent: (subj as any).kind === "player_archetype" ? createAgentById(subjectId) : undefined,
        seed,
        matchType: "ga_vs_ga",
        config: { timeStep: 1 / 30, drainVfx: true, deterministic: true, fastRoundTransitions: true },
      };
    },
    opponentArchetypeIdFor() { return defaultArchetype; },
  };
}

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

/** CSV export. One row per cell. */
export function renderMatchupMatrixCsv(matrix: MatchupMatrix): string {
  const lines = [
    "row,col,n,winRate,winRateCi95,se,pValue,avgDamage,avgDuration,avgRemainingHp,avgAdaptation",
  ];
  for (const c of matrix.cells) {
    lines.push([
      c.rowId, c.colId, c.n,
      c.winRate.toFixed(4),
      c.winRateCi95.toFixed(4),
      c.winRateSe.toFixed(4),
      c.pValue.toFixed(4),
      c.avgDamage.toFixed(2),
      c.avgDuration.toFixed(2),
      c.avgRemainingHp.toFixed(3),
      c.avgAdaptation.toFixed(3),
    ].join(","));
  }
  return lines.join("\n");
}

/** JSON export. */
export function renderMatchupMatrixJson(matrix: MatchupMatrix): string {
  return JSON.stringify(matrix, null, 2);
}

/** Markdown table. */
export function renderMatchupMatrixMd(matrix: MatchupMatrix, value: "winRate" | "avgDamage" | "avgDuration" = "winRate"): string {
  const labels: Record<string, string> = {
    winRate: "Win Rate",
    avgDamage: "Avg Damage",
    avgDuration: "Avg Duration (s)",
  };
  const lines: string[] = [];
  lines.push(`# Matchup Matrix — ${labels[value]}`);
  lines.push("");
  // Header row
  lines.push("| | " + matrix.subjectIds.join(" | ") + " |");
  lines.push("|---" + matrix.subjectIds.map(() => "|---:").join(""));
  for (const rowId of matrix.subjectIds) {
    const row = [rowId];
    for (const colId of matrix.subjectIds) {
      const cell = matrix.cells.find(c => c.rowId === rowId && c.colId === colId);
      if (!cell) { row.push("-"); continue; }
      if (value === "winRate") {
        row.push(`${(cell.winRate * 100).toFixed(1)}%`);
      } else if (value === "avgDamage") {
        row.push(cell.avgDamage.toFixed(1));
      } else {
        row.push(cell.avgDuration.toFixed(1));
      }
    }
    lines.push("| " + row.join(" | ") + " |");
  }
  return lines.join("\n");
}

/** Heatmap spec (JSON consumable by D3/plotly/matplotlib). */
export function renderMatchupMatrixHeatmapSpec(matrix: MatchupMatrix, value: "winRate" | "avgDamage" | "avgDuration" = "winRate"): string {
  const labels = matrix.subjectIds;
  // Build Z matrix (rows × cols)
  const z: number[][] = [];
  for (const rowId of labels) {
    const row: number[] = [];
    for (const colId of labels) {
      const cell = matrix.cells.find(c => c.rowId === rowId && c.colId === colId);
      if (!cell) { row.push(0); continue; }
      const v = value === "winRate" ? cell.winRate : value === "avgDamage" ? cell.avgDamage : cell.avgDuration;
      row.push(v);
    }
    z.push(row);
  }
  return JSON.stringify({
    type: "heatmap",
    title: `Matchup Matrix — ${value}`,
    xLabels: labels,
    yLabels: labels,
    z,
    zMin: value === "winRate" ? 0 : undefined,
    zMax: value === "winRate" ? 1 : undefined,
    colorScale: value === "winRate" ? "RdYlGn" : "Viridis",
    annotations: matrix.cells.map(c => ({
      x: c.colId, y: c.rowId,
      text: value === "winRate" ? `${(c.winRate * 100).toFixed(0)}%` : c.avgDamage.toFixed(0),
    })),
  }, null, 2);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}
