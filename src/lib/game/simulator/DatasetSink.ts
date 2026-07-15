// ============================================================================
// SIMULATOR — DATASET SINK
//
// PHASE 9 of the research framework. Every simulation can optionally
// produce training / distillation / evaluation / benchmark /
// active-learning samples. Configurable sampling rates:
//
//   - 0.01 (1%)
//   - 0.05 (5%)
//   - 0.10 (10%)
//   - 1.0  (every fight)
//   - "interesting" (close fights, timeouts, long fights, max combo)
//
// The sink subscribes to the runner's datasetSink callback (set on
// the SimulationRunner). It filters by the configured rate and emits
// a `SinkSample` event. The caller wires it into a real dataset
// (evolution DatasetLogger, gamedesigner GameDesignDatasetLogger,
// active-learning engine, etc.) — the sink is transport-agnostic.
// ============================================================================

import type { FightResult } from "./MatchResult";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

export type DatasetKind = "training" | "distillation" | "evaluation" | "benchmark" | "active_learning";

export interface DatasetSinkConfig {
  /** Which kinds to collect. */
  kinds: DatasetKind[];
  /** Sampling rate (0..1) or "interesting". */
  rate: number | "interesting";
  /** Hook for emitting samples. The transport is the caller's job. */
  onSample?: (kind: DatasetKind, sample: SinkSample) => void;
  /** Hard cap on samples retained (0 = unlimited). */
  maxRetained?: number;
  /** Stable id for this sink (used in reports). */
  id?: string;
}

export const DEFAULT_SINK_CONFIG: DatasetSinkConfig = {
  kinds: ["training", "evaluation"],
  rate: 0.05,
  maxRetained: 10000,
};

// ----------------------------------------------------------------------------
// Sink sample (a "data row" derived from one fight)
// ----------------------------------------------------------------------------

export interface SinkSample {
  /** The kind. */
  kind: DatasetKind;
  /** The fight id this sample came from. */
  fightId: string;
  /** The seed. */
  seed: number;
  /** Subject genome / opponent id. */
  subjectId: string;
  /** Opponent id. */
  opponentId: string;
  /** Match type. */
  matchType: string;
  /** Winner side (0 = subject, 1 = opponent, null = draw). */
  winnerSide: 0 | 1 | null;
  /** Composite reward signal (0..1, higher = subject won decisively). */
  reward: number;
  /** Per-side stats snapshot. */
  sideA: { damageDealt: number; damageTaken: number; maxCombo: number; hpFrac: number; roundsWon: number };
  sideB: { damageDealt: number; damageTaken: number; maxCombo: number; hpFrac: number; roundsWon: number };
  /** Free-form metadata. */
  meta: Record<string, unknown>;
  /** Tag for downstream filtering. */
  tags: string[];
}

// ----------------------------------------------------------------------------
// DatasetSink
// ----------------------------------------------------------------------------

export class DatasetSink {
  readonly config: DatasetSinkConfig;
  private rngSeed: number;
  private rngState: number = 0xc0ffee;
  private retained: SinkSample[] = [];
  private totalSeen = 0;
  private totalEmitted = 0;
  private perKindCount: Record<DatasetKind, number> = {
    training: 0, distillation: 0, evaluation: 0, benchmark: 0, active_learning: 0,
  };

  constructor(config: Partial<DatasetSinkConfig> = {}, rngSeed = 12345) {
    this.config = { ...DEFAULT_SINK_CONFIG, ...config };
    this.rngSeed = rngSeed;
  }

  /** Reset all counters and retained samples. */
  reset(): void {
    this.retained = [];
    this.totalSeen = 0;
    this.totalEmitted = 0;
    this.perKindCount = {
      training: 0, distillation: 0, evaluation: 0, benchmark: 0, active_learning: 0,
    };
  }

  /** Attach the sink to a runner. */
  attach(runner: { datasetSink: ((result: FightResult) => void) | null }): void {
    runner.datasetSink = (result) => this.onFight(result);
  }

  /** Detach from a runner. */
  detach(runner: { datasetSink: ((result: FightResult) => void) | null }): void {
    runner.datasetSink = null;
  }

  /** Manually feed a fight. */
  onFight(result: FightResult): void {
    this.totalSeen++;
    if (!this.shouldKeep(result)) return;
    for (const kind of this.config.kinds) {
      const sample = this.toSample(result, kind);
      this.perKindCount[kind]++;
      this.totalEmitted++;
      this.config.onSample?.(kind, sample);
      if (this.config.maxRetained && this.retained.length < this.config.maxRetained) {
        this.retained.push(sample);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  getRetained(): SinkSample[] { return [...this.retained]; }
  getCounts(): { totalSeen: number; totalEmitted: number; perKind: Record<DatasetKind, number> } {
    return { totalSeen: this.totalSeen, totalEmitted: this.totalEmitted, perKind: { ...this.perKindCount } };
  }

  // --------------------------------------------------------------------------
  // Sampling logic
  // --------------------------------------------------------------------------

  private shouldKeep(result: FightResult): boolean {
    const r = this.config.rate;
    if (r === "interesting") return this.isInteresting(result);
    if (typeof r === "number") {
      if (r >= 1.0) return true;
      if (r <= 0) return false;
      return this.draw() < r;
    }
    return false;
  }

  private isInteresting(result: FightResult): boolean {
    // Close fight (HP diff < 20%), timeout, or max combo >= 4
    const a = result.sideA.hpFrac;
    const b = result.sideB.hpFrac;
    if (Math.abs(a - b) < 0.2) return true;
    if (result.timedOut) return true;
    if (result.sideA.maxCombo >= 4 || result.sideB.maxCombo >= 4) return true;
    if (result.rounds.length >= 3) return true; // went the distance
    return false;
  }

  private toSample(result: FightResult, kind: DatasetKind): SinkSample {
    // Reward signal: damage dealt minus damage taken (normalized to 0..1)
    const a = result.sideA;
    const b = result.sideB;
    const reward = clamp01(
      ((a.damageDealt - a.damageTaken) / 100 + 1) * 0.5,
    );
    const tags: string[] = [kind];
    if (result.timedOut) tags.push("timeout");
    if (Math.abs(a.hpFrac - b.hpFrac) < 0.2) tags.push("close");
    return {
      kind,
      fightId: result.id,
      seed: result.seed,
      subjectId: result.sideAId,
      opponentId: result.sideBId,
      matchType: result.matchType,
      winnerSide: result.winnerSide,
      reward,
      sideA: { damageDealt: a.damageDealt, damageTaken: a.damageTaken, maxCombo: a.maxCombo, hpFrac: a.hpFrac, roundsWon: a.roundsWon },
      sideB: { damageDealt: b.damageDealt, damageTaken: b.damageTaken, maxCombo: b.maxCombo, hpFrac: b.hpFrac, roundsWon: b.roundsWon },
      meta: { ...result.meta },
      tags,
    };
  }

  // --------------------------------------------------------------------------
  // Random
  // --------------------------------------------------------------------------

  private draw(): number {
    // xorshift32
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 0x100000000;
  }
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// ----------------------------------------------------------------------------
// Convenience: pre-configured sinks
// ----------------------------------------------------------------------------

/** 1% rate, training + evaluation. */
export function createOnePercentSink(onSample?: DatasetSinkConfig["onSample"]): DatasetSink {
  return new DatasetSink({ kinds: ["training", "evaluation"], rate: 0.01, onSample });
}

/** 5% rate, training only. */
export function createFivePercentSink(onSample?: DatasetSinkConfig["onSample"]): DatasetSink {
  return new DatasetSink({ kinds: ["training"], rate: 0.05, onSample });
}

/** 10% rate, all kinds. */
export function createTenPercentSink(onSample?: DatasetSinkConfig["onSample"]): DatasetSink {
  return new DatasetSink({ kinds: ["training", "distillation", "evaluation", "benchmark"], rate: 0.10, onSample });
}

/** 100% — every fight is a sample. */
export function createFullSink(onSample?: DatasetSinkConfig["onSample"]): DatasetSink {
  return new DatasetSink({ kinds: ["training", "evaluation", "benchmark", "active_learning"], rate: 1.0, onSample });
}

/** Only interesting fights. */
export function createInterestingSink(onSample?: DatasetSinkConfig["onSample"]): DatasetSink {
  return new DatasetSink({ kinds: ["training", "active_learning"], rate: "interesting", onSample });
}
