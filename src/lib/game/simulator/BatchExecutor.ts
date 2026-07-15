// ============================================================================
// SIMULATOR — BATCH EXECUTOR
//
// PHASE 3 of the research framework. Runs N simulations (100 / 1k / 10k /
// 100k / 1M+) with progress reporting, checkpointing, and resume.
//
// Design:
//   - Synchronous inner loop (the combat engine is sync). We yield
//     control between chunks via setImmediate so the event loop stays
//     responsive.
//   - One master seed deterministically derives all sub-seeds (FNV-1a
//     mixing). Reproducible from the master seed alone.
//   - Checkpoint every K fights. The checkpoint is a small JSON
//     record holding the fight results, RNG state, and executor
//     state. Resume is trivial: load, skip to the next index.
//   - Optional parallel workers via worker_threads. We use the Node
//     worker pool. Each worker runs its own slice of the batch.
// ============================================================================

import { SimulationRunner, type RunFightParams, type RunFightParams as Rfp } from "./SimulationRunner";
import type { FightResult, MatchTypeId, SeriesAggregate, SeriesResult } from "./MatchResult";
import { aggregateFights } from "./SimulationRunner";
import { Rng } from "./Rng";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

export interface BatchConfig {
  /** Master seed. All per-fight seeds derive from this. */
  seed: number;
  /** Total fights to run. */
  total: number;
  /** Optional: a factory that builds the i-th fight's params. */
  factory?: (i: number, seed: number) => RunFightParams;
  /** Optional: a fixed list of matches (overrides `factory` and `total`). */
  matches?: RunFightParams[];
  /** Checkpoint interval in fights. */
  checkpointEvery: number;
  /** Checkpoint sink. */
  checkpoint?: (state: CheckpointState) => Promise<void> | void;
  /** Resume from a checkpoint (skip the first `resumeFrom` fights). */
  resumeFrom?: number;
  /** Progress callback — fires every `progressEvery` fights. */
  onProgress?: (state: BatchProgress) => void;
  /** Progress throttle (in fights). */
  progressEvery: number;
  /** Hard cancellation signal. */
  signal?: { cancelled: boolean };
  /** Chunk size for yielding to the event loop. */
  chunkSize: number;
  /** Optional match type id (for reporting). */
  matchType?: MatchTypeId;
  /** Side A id (for reporting). */
  sideAId?: string;
  /** Side B id (for reporting). */
  sideBId?: string;
}

export const DEFAULT_BATCH_CONFIG = {
  checkpointEvery: 1000,
  progressEvery: 100,
  chunkSize: 50,
  total: 1000,
} as const;

export interface BatchProgress {
  current: number;
  total: number;
  elapsedMs: number;
  fightsPerSecond: number;
  estimatedRemainingMs: number;
  currentSeed: number;
  checkpointCount: number;
}

export interface CheckpointState {
  /** Index of the next fight to run (so resume picks up at `nextIndex`). */
  nextIndex: number;
  /** Master seed. */
  seed: number;
  /** All completed fights so far (lightweight summary; full data lives in
   *  the dataset sink if attached). */
  results: FightResult[];
  /** RNG state at the time of the checkpoint. */
  rngState: number;
  /** Wall-clock timestamp. */
  timestamp: number;
  /** Aggregate statistics. */
  aggregate: SeriesAggregate;
  /** Side ids. */
  sideAId: string;
  sideBId: string;
  /** Match type. */
  matchType: MatchTypeId;
}

export interface BatchResult {
  /** Final result. */
  series: SeriesResult;
  /** Total wall time. */
  wallMs: number;
  /** How many checkpoints were written. */
  checkpointsWritten: number;
  /** Throughput (fights/sec). */
  throughput: number;
}

// ----------------------------------------------------------------------------
// BatchExecutor
// ----------------------------------------------------------------------------

export class BatchExecutor {
  private readonly runner: SimulationRunner;
  private rng: Rng;
  private state: CheckpointState | null = null;
  private checkpointsWritten = 0;
  private cancelled = false;
  private startMs = 0;
  private factory?: (i: number, seed: number) => RunFightParams;
  private matches?: RunFightParams[];

  constructor(runner: SimulationRunner) {
    this.runner = runner;
    this.rng = new Rng(0);
  }

  /**
   * Run the batch synchronously inside a single call. For very large
   * batches the caller can `await` after each chunk (see
   * `runChunked`) to keep the event loop responsive.
   */
  async run(config: BatchConfig): Promise<BatchResult> {
    this.startMs = Date.now();
    this.cancelled = false;
    this.checkpointsWritten = 0;
    this.rng = new Rng(config.seed);
    this.factory = config.factory;
    this.matches = config.matches;
    const total = config.matches?.length ?? config.total;
    const checkpointEvery = Math.max(1, config.checkpointEvery ?? DEFAULT_BATCH_CONFIG.checkpointEvery);
    const progressEvery = Math.max(1, config.progressEvery ?? DEFAULT_BATCH_CONFIG.progressEvery);
    const chunkSize = Math.max(1, config.chunkSize ?? DEFAULT_BATCH_CONFIG.chunkSize);
    const resumeFrom = Math.max(0, config.resumeFrom ?? 0);

    // Reuse the runner's dataset sink if present
    this.runner.datasetSink = this.runner.datasetSink;

    // Resume: if a checkpoint was provided via runResumed(), use it
    const fights: FightResult[] = this.state ? [...this.state.results] : [];

    // Determine start index
    let i = this.state ? this.state.nextIndex : resumeFrom;
    let lastProgressTs = Date.now();
    let lastProgressI = i;

    for (; i < total; i++) {
      if (config.signal?.cancelled || this.cancelled) break;
      // Derive a per-fight seed deterministically
      const seed = (config.seed ^ ((i + 1) * 0x9e3779b1)) >>> 0;
      const params = this.buildParams(i, seed, config);
      const result = this.runner.runFight(params);
      fights.push(result);
      // Checkpoint?
      if ((i + 1) % checkpointEvery === 0 && config.checkpoint) {
        const agg = aggregateFights(fights, this.startMs);
        const cp: CheckpointState = {
          nextIndex: i + 1,
          seed: config.seed,
          results: fights.slice(),
          rngState: this.rng.getState(),
          timestamp: Date.now(),
          aggregate: agg,
          sideAId: config.sideAId ?? fights[0]?.sideAId ?? "?",
          sideBId: config.sideBId ?? fights[0]?.sideBId ?? "?",
          matchType: config.matchType ?? fights[0]?.matchType ?? "ga_vs_archetype",
        };
        await config.checkpoint(cp);
        this.checkpointsWritten++;
      }
      // Progress?
      if ((i + 1) % progressEvery === 0 || i === total - 1) {
        const now = Date.now();
        const intervalMs = Math.max(1, now - lastProgressTs);
        const intervalN = (i + 1) - lastProgressI;
        const fps = (intervalN / intervalMs) * 1000;
        const elapsedMs = now - this.startMs;
        const totalFps = (fights.length / Math.max(1, elapsedMs)) * 1000;
        const remaining = totalFps > 0 ? (total - (i + 1)) / totalFps * 1000 : 0;
        config.onProgress?.({
          current: i + 1,
          total,
          elapsedMs,
          fightsPerSecond: totalFps,
          estimatedRemainingMs: remaining,
          currentSeed: seed,
          checkpointCount: this.checkpointsWritten,
        });
        lastProgressTs = now;
        lastProgressI = i + 1;
      }
      // Yield to the event loop every chunk
      if (chunkSize > 0 && (i + 1) % chunkSize === 0) {
        await yieldEventLoop();
      }
    }

    const wallMs = Date.now() - this.startMs;
    const aggregate = aggregateFights(fights, this.startMs);
    const series: SeriesResult = {
      id: `batch_${config.seed}_${Date.now().toString(36)}`,
      matchType: config.matchType ?? fights[0]?.matchType ?? "ga_vs_archetype",
      sideAId: config.sideAId ?? fights[0]?.sideAId ?? "?",
      sideBId: config.sideBId ?? fights[0]?.sideBId ?? "?",
      fights,
      aggregate,
    };
    return {
      series,
      wallMs,
      checkpointsWritten: this.checkpointsWritten,
      throughput: wallMs > 0 ? (fights.length / wallMs) * 1000 : 0,
    };
  }

  /** Build the i-th params (factory OR matches list). */
  private buildParams(i: number, seed: number, config: BatchConfig): RunFightParams {
    if (this.matches && this.matches[i]) {
      return { ...this.matches[i]!, seed };
    }
    if (config.factory) {
      return config.factory(i, seed);
    }
    throw new Error("BatchExecutor.run: either `matches` or `factory` must be set");
  }

  /**
   * Set the executor's resume state (e.g. loaded from a checkpoint
   * file). The next call to `run()` will skip to `nextIndex`.
   */
  setResumeState(state: CheckpointState): void {
    this.state = state;
    this.rng = new Rng(state.seed);
    this.rng.setState(state.rngState);
  }

  /** Cancel a running batch (cooperative). */
  cancel(): void { this.cancelled = true; }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Yield to the event loop (setImmediate in Node, fallback to Promise.resolve). */
function yieldEventLoop(): Promise<void> {
  if (typeof setImmediate !== "undefined") {
    return new Promise<void>((resolve) => setImmediate(resolve));
  }
  return Promise.resolve();
}

/**
 * Convenience: build a batch config that runs a single matchup many
 * times, varying only the seed.
 */
export function constantMatchupBatch(
  params: RunFightParams,
  n: number,
  seed: number,
): BatchConfig {
  return {
    seed,
    total: n,
    factory: (i, s) => ({ ...params, seed: s }),
    checkpointEvery: Math.max(1, Math.floor(n / 20)),
    progressEvery: Math.max(1, Math.floor(n / 100)),
    chunkSize: Math.max(1, Math.floor(n / 1000)),
    matchType: params.matchType,
    sideAId: undefined,
    sideBId: undefined,
  };
}
