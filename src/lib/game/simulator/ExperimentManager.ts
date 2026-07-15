// ============================================================================
// SIMULATOR — EXPERIMENT MANAGER
//
// PHASE 7 of the research framework. Stores Experiment records with
// every version pin: id, seed, model, prompt version, dataset version,
// genome version, director version, teacher version, student version,
// results, comparison, notes. Everything is reproducible from a
// single record (the seed + versions uniquely determine the result).
//
// Reuses:
//   - SimulationRunner
//   - BenchmarkSuite
//   - StatisticsEngine
//   - ReportWriter
// ============================================================================

import { IGenome } from "../evolution/types";
import { SimulationRunner, type RunFightParams } from "./SimulationRunner";
import type { FightResult, SeriesResult } from "./MatchResult";
import { describe, welchTTest, pairedTTest, cohensD, type DescriptiveStats } from "./StatisticsEngine";

// ----------------------------------------------------------------------------
// Experiment record
// ----------------------------------------------------------------------------

export interface Experiment {
  /** Stable id. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Master seed (all sub-seeds derive from this). */
  seed: number;
  /** Match type. */
  matchType: string;
  /** Number of fights / matches. */
  n: number;
  /** Model id. */
  model: string;
  /** Prompt version. */
  promptVersion: string;
  /** Dataset version. */
  datasetVersion: string;
  /** Genome version (e.g. "1.0.0" or a generation number). */
  genomeVersion: string;
  /** Director version ("V3" or "V4"). */
  directorVersion: string;
  /** Teacher version (e.g. "distilled-2024-01-15"). */
  teacherVersion: string;
  /** Student version (e.g. "fine-tuned-2024-02-01"). */
  studentVersion: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Wall-clock duration (ms). */
  wallMs: number;
  /** Free-form notes. */
  notes?: string;
  /** Tags. */
  tags?: string[];
  /** Captured results (lightweight). */
  results: ExperimentResults;
  /** Optional comparison vs another experiment. */
  comparison?: ExperimentComparison;
  /** Raw fights (optional — large). */
  fights?: FightResult[];
}

export interface ExperimentResults {
  /** Per-side stats (descriptive). */
  winRate: DescriptiveStats;
  damageDealt: DescriptiveStats;
  damageTaken: DescriptiveStats;
  duration: DescriptiveStats;
  comboVariety: DescriptiveStats;
  behaviourDiversity: DescriptiveStats;
}

export interface ExperimentComparison {
  /** Other experiment id. */
  otherExperimentId: string;
  /** Paired t-test on win rate. */
  pairedWinRate: { t: number; df: number; p: number };
  /** Welch's t-test on duration. */
  welchDuration: { t: number; df: number; p: number };
  /** Cohen's d on win rate. */
  cohensD: number;
  /** Human-readable summary. */
  summary: string;
}

// ----------------------------------------------------------------------------
// ExperimentManager
// ----------------------------------------------------------------------------

export class ExperimentManager {
  private readonly runner: SimulationRunner;
  private readonly experiments: Map<string, Experiment> = new Map();
  /** Optional dataset sink. */
  public onResult: ((experimentId: string, result: FightResult) => void) | null = null;

  constructor(runner: SimulationRunner) {
    this.runner = runner;
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  /** Create a new experiment record. */
  createExperiment(params: Omit<Experiment, "id" | "createdAt" | "results" | "wallMs" | "fights">): string {
    const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const exp: Experiment = {
      ...params,
      id,
      createdAt: new Date().toISOString(),
      wallMs: 0,
      results: this.emptyResults(),
    };
    this.experiments.set(id, exp);
    return id;
  }

  /** Get an experiment by id. */
  get(id: string): Experiment | undefined {
    return this.experiments.get(id);
  }

  /** List all experiments. */
  list(): Experiment[] {
    return [...this.experiments.values()];
  }

  // --------------------------------------------------------------------------
  // Run
  // --------------------------------------------------------------------------

  /**
   * Run an experiment. Calls runSeries via the runner, then captures
   * the descriptive stats and attaches them to the record.
   */
  async runExperiment(
    id: string,
    params: RunFightParams,
    n: number,
    onProgress?: (i: number, total: number) => void,
  ): Promise<SeriesResult> {
    const exp = this.experiments.get(id);
    if (!exp) throw new Error(`Experiment not found: ${id}`);
    const startedAt = Date.now();
    const series = this.runner.runSeries({
      ...params,
      seed: exp.seed,
      n,
      matchType: exp.matchType as any,
      onProgress: (i, t) => onProgress?.(i, t),
    });
    exp.wallMs = Date.now() - startedAt;
    exp.n = series.fights.length;
    exp.results = this.computeResults(series);
    if (this.onResult) {
      for (const f of series.fights) this.onResult(id, f);
    }
    exp.fights = series.fights;
    return series;
  }

  // --------------------------------------------------------------------------
  // Compare
  // --------------------------------------------------------------------------

  /** Compare two experiments on win rate and duration. */
  compare(aId: string, bId: string): ExperimentComparison {
    const a = this.experiments.get(aId);
    const b = this.experiments.get(bId);
    if (!a || !b) throw new Error(`compare: missing experiment (a=${aId}, b=${bId})`);
    const aWR = a.fights?.map(f => (f.winnerSide === 0 ? 1 : 0)) ?? [];
    const bWR = b.fights?.map(f => (f.winnerSide === 0 ? 1 : 0)) ?? [];
    const aDur = a.fights?.map(f => f.durationSeconds) ?? [];
    const bDur = b.fights?.map(f => f.durationSeconds) ?? [];
    const paired = pairedTTest(aWR, bWR);
    const welch = welchTTest(aDur, bDur);
    const d = cohensD(aWR, bWR);
    const sumA = aWR.length === 0 ? 0 : aWR.reduce((s: number, v: number) => s + v, 0);
    const sumB = bWR.length === 0 ? 0 : bWR.reduce((s: number, v: number) => s + v, 0);
    const winA = aWR.length === 0 ? 0 : sumA / aWR.length;
    const winB = bWR.length === 0 ? 0 : sumB / bWR.length;
    const summary = `A win rate: ${(winA * 100).toFixed(2)}%, B win rate: ${(winB * 100).toFixed(2)}% (paired t=${paired.t.toFixed(3)}, p=${paired.p.toFixed(4)}, d=${d.toFixed(3)}). Duration: t=${welch.t.toFixed(3)}, p=${welch.p.toFixed(4)}.`;
    const cmp: ExperimentComparison = {
      otherExperimentId: bId,
      pairedWinRate: paired,
      welchDuration: welch,
      cohensD: d,
      summary,
    };
    a.comparison = cmp;
    return cmp;
  }

  // --------------------------------------------------------------------------
  // Serialization
  // --------------------------------------------------------------------------

  /** JSON-serialize an experiment (with optional fight omission). */
  serialize(id: string, includeFights = false): string {
    const e = this.experiments.get(id);
    if (!e) throw new Error(`Experiment not found: ${id}`);
    const copy: Experiment = { ...e };
    if (!includeFights) delete copy.fights;
    return JSON.stringify(copy, null, 2);
  }

  /** Load an experiment from JSON. Returns the new id. */
  load(json: string): string {
    const parsed = JSON.parse(json) as Experiment;
    if (!parsed.id) parsed.id = `exp_loaded_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.experiments.set(parsed.id, parsed);
    return parsed.id;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private emptyResults(): ExperimentResults {
    const empty = describe([]);
    return {
      winRate: empty, damageDealt: empty, damageTaken: empty,
      duration: empty, comboVariety: empty, behaviourDiversity: empty,
    };
  }

  private computeResults(series: SeriesResult): ExperimentResults {
    const wr: number[] = [];
    const dd: number[] = [];
    const dt: number[] = [];
    const dur: number[] = [];
    const cv: number[] = [];
    const bd: number[] = [];
    for (const f of series.fights) {
      wr.push(f.winnerSide === 0 ? 1 : 0);
      dd.push(f.sideA.damageDealt);
      dt.push(f.sideA.damageTaken);
      dur.push(f.durationSeconds);
      const k = new Set<string>([...Object.keys(f.sideA.attackKinds), ...Object.keys(f.sideB.attackKinds)]);
      cv.push(k.size);
      bd.push(f.sideA.attackKinds ? entropyOf(Object.values(f.sideA.attackKinds)) : 0);
    }
    return {
      winRate: describe(wr),
      damageDealt: describe(dd),
      damageTaken: describe(dt),
      duration: describe(dur),
      comboVariety: describe(cv),
      behaviourDiversity: describe(bd),
    };
  }
}

function entropyOf(xs: number[]): number {
  let s = 0;
  for (const v of xs) s += v;
  if (s === 0) return 0;
  let h = 0;
  for (const v of xs) {
    if (v > 0) {
      const p = v / s;
      h -= p * Math.log2(p);
    }
  }
  return h;
}
