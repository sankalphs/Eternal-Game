// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — LARGE SCALE BENCHMARK
//
// PHASE 4 of the publication-quality evaluation layer.
//
// Configurable large-N benchmarks with checkpoint resume and optional
// worker distribution. Designed for 500 / 1k / 5k / 10k / 25k+ matches
// per subject. Each subject × opponent combination gets
// `matchesPerCell` matches, and the result feeds the Bootstrap CIs
// (which need n ≥ 30 to be meaningful).
//
// Reuses:
//   - BatchExecutor from simulator/
//   - CheckpointStore from simulator/
//   - bootstrapWinRate / meanCi from research/Bootstrap
//   - BenchmarkSuite from simulator/ (for per-fight metrics)
// ============================================================================

import type { Subject } from "./types";
import { type LargeScaleBenchmarkConfig, DEFAULT_LARGE_SCALE_CONFIG } from "./types";
import { SimulationRunner, type RunFightParams } from "../simulator/SimulationRunner";
import { BatchExecutor, type CheckpointState, type BatchProgress } from "../simulator/BatchExecutor";
import { CheckpointStore, InMemoryIO, type CheckpointIO } from "../simulator/CheckpointStore";
import { bootstrapWinRate, meanCi, bootstrapMean, type FightBatchStats, bootstrapFightBatch } from "./Bootstrap";
import { defaultOpponent } from "../simulator/HeadlessEngine";
import { createAgentById } from "../evolution/agents";

// ----------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------

export interface SubjectBenchmark {
  subjectId: string;
  totalMatches: number;
  /** Wall time (ms). */
  wallMs: number;
  /** Throughput (matches/sec). */
  throughput: number;
  /** CIs for the standard metrics. */
  metrics: FightBatchStats;
  /** Optional per-opponent breakdown. */
  perOpponent: { opponentId: string; metrics: FightBatchStats }[];
  /** Resume info. */
  resumedFrom?: string;
  /** Checkpoint id used. */
  checkpointId?: string;
}

export interface LargeScaleBenchmarkReport {
  /** Per-subject results. */
  subjects: SubjectBenchmark[];
  /** Per-fight results (slim). */
  fights: { subjectId: string; opponentId: string; duration: number; winner: 0 | 1 | null; damageA: number; hpFracA: number }[];
  /** Wall time (ms). */
  wallMs: number;
  /** Throughput (matches/sec). */
  throughput: number;
  /** Generated timestamp. */
  generatedAt: number;
  /** Checkpoint id used (if any). */
  checkpointId?: string;
  /** Subject pool id. */
  subjectPoolId: string;
}

// ----------------------------------------------------------------------------
// LargeScaleBench
// ----------------------------------------------------------------------------

export class LargeScaleBench {
  private runner: SimulationRunner;
  private executor: BatchExecutor;
  private store: CheckpointStore;
  private config: LargeScaleBenchmarkConfig;

  constructor(
    runner: SimulationRunner,
    config: Partial<LargeScaleBenchmarkConfig> = {},
    io: CheckpointIO = new InMemoryIO(),
  ) {
    this.runner = runner;
    this.executor = new BatchExecutor(runner);
    this.config = { ...DEFAULT_LARGE_SCALE_CONFIG, ...config };
    this.store = new CheckpointStore(io, false);
  }

  /**
   * Run a full benchmark sweep: every subject vs every archetype pool.
   */
  async runSweep(params: {
    subjects: Subject[];
    archetypes?: string[];
    onProgress?: (subjectIdx: number, total: number, progress: BatchProgress) => void;
  }): Promise<LargeScaleBenchmarkReport> {
    const startedAt = Date.now();
    const archetypeIds = params.archetypes ?? [
      "aggressive", "defensive", "counter", "combo", "risky",
    ];
    const subjects = params.subjects;
    const subjectBenchmarks: SubjectBenchmark[] = [];
    const allFights: LargeScaleBenchmarkReport["fights"] = [];
    const baseOpp = defaultOpponent(0);
    for (let s = 0; s < subjects.length; s++) {
      const subj = subjects[s]!;
      const perOpp: { opponentId: string; metrics: FightBatchStats }[] = [];
      const winResults: (0 | 1 | null)[] = [];
      const durations: number[] = [];
      const damages: number[] = [];
      const hpFracs: number[] = [];
      const adaptation: number[] = [];
      // Build the full factory: subject × archetype × matchesPerCell
      const total = archetypeIds.length * this.config.matchesPerCell;
      let seedCounter = 0;
      for (const arch of archetypeIds) {
        const oppWins: (0 | 1 | null)[] = [];
        const oppDur: number[] = [];
        const oppDmg: number[] = [];
        const oppHp: number[] = [];
        const oppAd: number[] = [];
        for (let m = 0; m < this.config.matchesPerCell; m++) {
          const seed = (seedCounter + 1 * 0x9e3779b1) >>> 0;
          seedCounter++;
          const fight = this.runner.runFight({
            sideA: subj.genome ?? baseOpp,
            sideB: baseOpp,
            sideAAgent: undefined,
            sideBAgent: createAgentById(arch),
            seed,
            matchType: "ga_vs_archetype",
            config: {
              baseOpponentIndex: 0,
              fastRoundTransitions: true,
              drainVfx: true,
              deterministic: true,
              timeStep: 1 / 30,
            },
            meta: { subjectId: subj.id, archetypeId: arch, matchType: "ga_vs_archetype" },
          });
          oppWins.push(fight.winnerSide);
          oppDur.push(fight.durationSeconds);
          oppDmg.push(fight.sideA.damageDealt);
          oppHp.push(fight.sideA.hpFrac);
          oppAd.push(fight.sideA.distanceStdDev);
          // Aggregate
          winResults.push(fight.winnerSide);
          durations.push(fight.durationSeconds);
          damages.push(fight.sideA.damageDealt);
          hpFracs.push(fight.sideA.hpFrac);
          adaptation.push(fight.sideA.distanceStdDev);
          allFights.push({
            subjectId: subj.id,
            opponentId: `archetype:${arch}`,
            duration: fight.durationSeconds,
            winner: fight.winnerSide,
            damageA: fight.sideA.damageDealt,
            hpFracA: fight.sideA.hpFrac,
          });
        }
        perOpp.push({
          opponentId: `archetype:${arch}`,
          metrics: bootstrapFightBatch(oppWins, oppDur, oppDmg, oppHp, oppAd),
        });
        params.onProgress?.(s, subjects.length, {
          current: seedCounter,
          total: subjects.length * total,
          elapsedMs: Date.now() - startedAt,
          fightsPerSecond: 0,
          estimatedRemainingMs: 0,
          currentSeed: 0,
          checkpointCount: 0,
        });
      }
      const metrics = bootstrapFightBatch(winResults, durations, damages, hpFracs, adaptation);
      subjectBenchmarks.push({
        subjectId: subj.id,
        totalMatches: winResults.length,
        wallMs: Date.now() - startedAt,
        throughput: 0,
        metrics,
        perOpponent: perOpp,
      });
    }
    const wallMs = Date.now() - startedAt;
    const totalMatches = subjectBenchmarks.reduce((a, s) => a + s.totalMatches, 0);
    return {
      subjects: subjectBenchmarks,
      fights: allFights,
      wallMs,
      throughput: wallMs > 0 ? (totalMatches / wallMs) * 1000 : 0,
      generatedAt: Date.now(),
      subjectPoolId: `pool-${subjects.length}`,
    };
  }

  /**
   * Distributed run via the BatchExecutor. Splits the NxM matrix into
   * chunks and runs them with checkpoint+resume.
   */
  async runDistributed(params: {
    subjects: Subject[];
    archetypes?: string[];
    checkpointId: string;
    onProgress?: (p: BatchProgress) => void;
  }): Promise<LargeScaleBenchmarkReport> {
    const archetypeIds = params.archetypes ?? ["aggressive", "defensive", "counter"];
    const baseOpp = defaultOpponent(0);
    // Build the full match list
    const matches: RunFightParams[] = [];
    let sIdx = 0;
    for (const subj of params.subjects) {
      for (const arch of archetypeIds) {
        for (let m = 0; m < this.config.matchesPerCell; m++) {
          const seed = ((sIdx * 7919) + (m * 1009) + hashStr(arch)) >>> 0;
          matches.push({
            sideA: subj.genome ?? baseOpp,
            sideB: baseOpp,
            sideAAgent: undefined,
            sideBAgent: createAgentById(arch),
            seed,
            matchType: "ga_vs_archetype",
            config: {
              baseOpponentIndex: 0,
              fastRoundTransitions: true,
              drainVfx: true,
              deterministic: true,
              timeStep: 1 / 30,
            },
            meta: { subjectId: subj.id, archetypeId: arch, matchType: "ga_vs_archetype" },
          });
        }
      }
      sIdx++;
    }
    // Try to resume
    const cpState = await this.store.load(params.checkpointId);
    if (cpState) {
      this.executor.setResumeState(cpState);
    }
    const result = await this.executor.run({
      seed: 12345,
      matches,
      total: matches.length,
      matchType: "ga_vs_archetype",
      sideAId: "subjects",
      sideBId: "archetypes",
      checkpointEvery: this.config.checkpointEvery,
      progressEvery: Math.max(100, Math.floor(matches.length / 100)),
      chunkSize: Math.max(50, Math.floor(matches.length / 200)),
      onProgress: params.onProgress,
      checkpoint: async (state: CheckpointState) => {
        await this.store.save(params.checkpointId, state);
      },
    });
    // Persist the final result
    await this.store.save(params.checkpointId + "-final", {
      nextIndex: result.series.fights.length,
      seed: 12345,
      results: result.series.fights,
      rngState: 0,
      timestamp: Date.now(),
      aggregate: result.series.aggregate,
      sideAId: "subjects",
      sideBId: "archetypes",
      matchType: "ga_vs_archetype",
    });
    // Convert to SubjectBenchmark[]
    const subjects = params.subjects;
    const bySubject = new Map<string, { wins: (0 | 1 | null)[]; durs: number[]; dmgs: number[]; hps: number[]; adapts: number[] }>();
    for (const f of result.series.fights) {
      const sid = f.meta.subjectId ?? "?";
      if (!bySubject.has(sid)) bySubject.set(sid, { wins: [], durs: [], dmgs: [], hps: [], adapts: [] });
      const b = bySubject.get(sid)!;
      b.wins.push(f.winnerSide);
      b.durs.push(f.durationSeconds);
      b.dmgs.push(f.sideA.damageDealt);
      b.hps.push(f.sideA.hpFrac);
      b.adapts.push(f.sideA.distanceStdDev);
    }
    const subjectBenchmarks: SubjectBenchmark[] = subjects.map(s => {
      const b = bySubject.get(s.id) ?? { wins: [], durs: [], dmgs: [], hps: [], adapts: [] };
      return {
        subjectId: s.id,
        totalMatches: b.wins.length,
        wallMs: result.wallMs,
        throughput: result.throughput,
        metrics: bootstrapFightBatch(b.wins, b.durs, b.dmgs, b.hps, b.adapts),
        perOpponent: [],
        resumedFrom: cpState ? params.checkpointId : undefined,
        checkpointId: params.checkpointId,
      };
    });
    return {
      subjects: subjectBenchmarks,
      fights: result.series.fights.map(f => ({
        subjectId: f.meta.subjectId ?? "?",
        opponentId: f.meta.archetypeId ?? "?",
        duration: f.durationSeconds,
        winner: f.winnerSide,
        damageA: f.sideA.damageDealt,
        hpFracA: f.sideA.hpFrac,
      })),
      wallMs: result.wallMs,
      throughput: result.throughput,
      generatedAt: Date.now(),
      checkpointId: params.checkpointId,
      subjectPoolId: `pool-${subjects.length}`,
    };
  }
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
