// ============================================================================
// ACTIVE LEARNING ENGINE — ORCHESTRATOR
//
// Closes the learning loop. Periodically:
//
//   1. Read the stored GameDesignDataset (play)
//   2. Replay each sample with the current student (model makes decision)
//   3. Score via the ReplayEvaluator (replay evaluator)
//   4. Score via the ConfidenceEngine signal (confidence)
//   5. Score via the DisagreementDetector (disagreement detector)
//   6. Sample via the UncertaintySampler (send ONLY these to teacher)
//   7. Query the teacher (existing OfflineDistillationPipeline.distillOne)
//   8. The teacher's response becomes the new training set
//   9. (Retraining happens externally; this engine just emits the bundle)
//
// The teacher is the OfflineDistillationPipeline with best-of-N candidates,
// head-to-head tie-breaks, and a quality-engine pick. We only run it on
// the selected subset, not the whole pool. This is the active-learning
// signal: 100,000 self-confident samples don't help, but 500 uncertain
// ones do.
//
// Reuses:
//   - GameDesignSample, GameDesignDatasetLogger from gamedesigner
//   - ReplayEvaluator from gamedesigner (for fresh replays)
//   - OfflineDistillationPipeline.distillOne from distillation (the teacher)
//   - All existing types
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import type { GameDesignDatasetLogger } from "../gamedesigner/GameDesignDatasetLogger";
import type { ReplayEvaluator } from "../gamedesigner/ReplayEvaluator";
import type { GameDesignPlan } from "../gamedesigner/GameDesignPlan";
import type { OfflineDistillationPipeline } from "../distillation/OfflineDistillationPipeline";
import type { DistilledSample } from "../distillation/types";
import { DisagreementDetector } from "./DisagreementDetector";
import { UncertaintySampler } from "./UncertaintySampler";
import {
  DEFAULT_ACTIVE_LEARNING_CONFIG,
  emptyReasonBreakdown,
  type ActiveLearningConfig,
  type ActiveLearningReport,
  type DisagreementReason,
  type ScoredSample,
} from "./types";

export interface ActiveLearningEngineDeps {
  // Source of stored samples (read-only — this engine never mutates the dataset)
  datasetLogger: GameDesignDatasetLogger;
  // Replay (runs the new student on each sample's context)
  replayEvaluator: ReplayEvaluator;
  // Distillation pipeline (the teacher). We call `distillOne` per selection.
  teacher: OfflineDistillationPipeline;
}

export interface ActiveLearningRoundOptions {
  // Override the pool (otherwise reads from datasetLogger)
  pool?: GameDesignSample[];
  // Pre-computed fresh plans from the new student (one per sampleId)
  freshPlans?: Map<string, GameDesignPlan>;
  // Progress callback
  onProgress?: (phase: ActiveLearningPhase, current: number, total: number) => void;
  // Hard cap on the round (overrides the budget cap)
  maxQueries?: number;
}

export type ActiveLearningPhase =
  | "scoring"
  | "sampling"
  | "querying-teacher"
  | "done";

export class ActiveLearningEngine {
  private readonly deps: ActiveLearningEngineDeps;
  private config: ActiveLearningConfig;
  private readonly detector: DisagreementDetector;
  private readonly sampler: UncertaintySampler;

  constructor(deps: ActiveLearningEngineDeps, config: Partial<ActiveLearningConfig> = {}) {
    this.deps = deps;
    this.config = { ...DEFAULT_ACTIVE_LEARNING_CONFIG, ...config };
    this.detector = new DisagreementDetector({ replayEvaluator: deps.replayEvaluator });
    this.sampler = new UncertaintySampler(this.config.seed);
  }

  // --------------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------------

  setConfig(config: Partial<ActiveLearningConfig>): void {
    this.config = { ...this.config, ...config };
    this.sampler.setSeed?.(this.config.seed);
  }

  getConfig(): ActiveLearningConfig {
    return { ...this.config };
  }

  getDetector(): DisagreementDetector { return this.detector; }
  getSampler(): UncertaintySampler { return this.sampler; }

  // --------------------------------------------------------------------------
  // Public — run one round
  // --------------------------------------------------------------------------

  /**
   * Run one full active-learning round over the stored dataset.
   * Returns a report + the small teaching set.
   */
  async runRound(options: ActiveLearningRoundOptions = {}): Promise<ActiveLearningReport> {
    const startedAt = Date.now();
    const roundId = `alr_${startedAt}_${Math.random().toString(36).slice(2, 6)}`;
    const pool = options.pool ?? this.deps.datasetLogger.getSamples();
    const onProgress = options.onProgress;

    onProgress?.("scoring", 0, pool.length);

    // 1. Score the pool (with replays if provided)
    const scored = this.scorePool(pool, options.freshPlans, onProgress);
    onProgress?.("sampling", scored.length, pool.length);

    // 2. Sample the budget
    let selection = this.sampler.select(scored, this.config);
    if (options.maxQueries !== undefined) {
      selection = selection.slice(0, options.maxQueries);
    }
    onProgress?.("querying-teacher", 0, selection.length);

    // 3. Query the teacher (one at a time, so a single bad sample doesn't
    //    abort the round)
    const teachingSet: DistilledSample[] = [];
    let fellback = 0;
    let totalLatency = 0;
    for (let i = 0; i < selection.length; i++) {
      const s = selection[i]!;
      try {
        const distilled = await this.deps.teacher.distillOne(s.sample, this.config.distillation);
        if (distilled) {
          teachingSet.push(distilled);
          const dAny = distilled as DistilledSample & { latencyMs?: number };
          totalLatency += dAny.latencyMs ?? distilled.provenance.totalLatencyMs;
        } else {
          fellback++;
        }
      } catch (err) {
        fellback++;
      }
      onProgress?.("querying-teacher", i + 1, selection.length);
    }

    // 4. Build the report
    const reasonBreakdown = this.tallyReasons(selection);
    const valueStats = this.valueStats(selection);
    const report: ActiveLearningReport = {
      roundId,
      generatedAt: startedAt,
      poolSize: pool.length,
      scored: scored.length,
      selected: selection.length,
      queried: teachingSet.length,
      fellback,
      totalLatencyMs: totalLatency,
      teacherCost: this.sampler.estimateCost(selection),
      reasonBreakdown,
      valueStats,
      selection,
      teachingSet,
      summary: "",
      jsonReport: "",
    };
    report.summary = this.formatSummary(report);
    report.jsonReport = JSON.stringify(this.serializeReport(report), null, 2);
    onProgress?.("done", selection.length, selection.length);
    return report;
  }

  /**
   * Plan-only: score + sample, but do NOT query the teacher. Returns the
   * selection so the caller can decide whether to spend the budget.
   */
  planRound(options: { pool?: GameDesignSample[]; freshPlans?: Map<string, GameDesignPlan> } = {}): {
    poolSize: number;
    scored: ScoredSample[];
    selected: ScoredSample[];
    estimatedCost: number;
  } {
    const pool = options.pool ?? this.deps.datasetLogger.getSamples();
    const scored = this.scorePool(pool, options.freshPlans);
    const selected = this.sampler.select(scored, this.config);
    return {
      poolSize: pool.length,
      scored,
      selected,
      estimatedCost: this.sampler.estimateCost(selected),
    };
  }

  // --------------------------------------------------------------------------
  // Internal — scoring
  // --------------------------------------------------------------------------

  private scorePool(
    pool: GameDesignSample[],
    freshPlans: Map<string, GameDesignPlan> | undefined,
    onProgress?: (phase: ActiveLearningPhase, current: number, total: number) => void,
  ): ScoredSample[] {
    if (freshPlans && freshPlans.size > 0) {
      const step = Math.max(1, Math.floor(pool.length / 50));
      const out: ScoredSample[] = [];
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i]!;
        const fresh = freshPlans.get(s.id);
        const scored = fresh
          ? this.detector.scoreAgainstReplay(s, fresh, this.config)
          : this.detector.score(s, this.config);
        if (scored) out.push(scored);
        if (i % step === 0) onProgress?.("scoring", i + 1, pool.length);
      }
      return out;
    }
    // Lightweight path — no fresh replays
    return this.detector.scorePool(pool, this.config);
  }

  // --------------------------------------------------------------------------
  // Report helpers
  // --------------------------------------------------------------------------

  private tallyReasons(selection: ScoredSample[]): Record<DisagreementReason, number> {
    const out = emptyReasonBreakdown();
    for (const s of selection) {
      for (const r of s.reasons) out[r]++;
    }
    return out;
  }

  private valueStats(selection: ScoredSample[]): { mean: number; p50: number; p95: number; min: number; max: number } {
    if (selection.length === 0) return { mean: 0, p50: 0, p95: 0, min: 0, max: 0 };
    const values = selection.map(s => s.value).sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const p = (q: number) => values[Math.min(values.length - 1, Math.floor(values.length * q))]!;
    return { mean, p50: p(0.5), p95: p(0.95), min: values[0]!, max: values[values.length - 1]! };
  }

  private formatSummary(r: ActiveLearningReport): string {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const costPct = r.poolSize > 0 ? r.selected / r.poolSize : 0;
    const reasons = Object.entries(r.reasonBreakdown)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(", ") || "none";
    return [
      `Active Learning Round ${r.roundId}`,
      `Pool: ${r.poolSize} samples -> Scored: ${r.scored} -> Selected: ${r.selected} (${pct(costPct)} of pool)`,
      `Teacher: queried ${r.queried}, fellback ${r.fellback}, latency ${r.totalLatencyMs}ms, cost ${r.teacherCost} candidate-queries`,
      `Reasons: ${reasons}`,
      `Value: mean=${r.valueStats.mean.toFixed(3)} p50=${r.valueStats.p50.toFixed(3)} p95=${r.valueStats.p95.toFixed(3)}`,
    ].join("\n");
  }

  /**
   * Strip the heavy fields from the report so the JSON dump is small
   * (selection is kept as IDs + scores only; the full DistilledSample
   * list is in `teachingSet`).
   */
  private serializeReport(r: ActiveLearningReport): unknown {
    return {
      roundId: r.roundId,
      generatedAt: r.generatedAt,
      poolSize: r.poolSize,
      scored: r.scored,
      selected: r.selected,
      queried: r.queried,
      fellback: r.fellback,
      totalLatencyMs: r.totalLatencyMs,
      teacherCost: r.teacherCost,
      reasonBreakdown: r.reasonBreakdown,
      valueStats: r.valueStats,
      summary: r.summary,
      selection: r.selection.map(s => ({
        sampleId: s.sampleId,
        value: s.value,
        signals: s.signals,
        reasons: s.reasons,
        estimatedTeacherCost: s.estimatedTeacherCost,
      })),
      teachingSet: r.teachingSet.map(d => ({
        originalId: d.original.id,
        lineageId: d.lineageId,
        winnerSource: d.provenance.winnerSource,
        improvement: d.provenance.improvement,
        winnerScore: d.provenance.winnerScore,
        originalScore: d.provenance.originalScore,
      })),
    };
  }
}

