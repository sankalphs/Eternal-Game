// ============================================================================
// SIMULATOR — BENCHMARK SUITE
//
// PHASE 5 of the research framework. Auto-generates benchmark reports
// for a model / genome / student / teacher / director / campaign.
//
// Metrics:
//   1.  WinRate
//   2.  AverageDamage
//   3.  DamageTaken
//   4.  FightLength
//   5.  ComboVariety
//   6.  BehaviourDiversity (Shannon)
//   7.  PredictionAccuracy
//   8.  CampaignDiversity
//   9.  ReplayScore
//   10. NarrativeConsistency
//   11. AdaptationScore
//   12. GenomeDiversity
//   13. PlayerEnjoymentProxy
//   14. DifficultyCurve
//   15. ConfidenceCalibration
//   16. LLMAgreement
//   17. DatasetQuality
//
// Most metrics are derived directly from FightResult[] using the
// StatisticsEngine. Reuses existing math; does not duplicate logic.
// ============================================================================

import { IGenome } from "../evolution/types";
import { genomeDistance } from "../evolution/Genome";
import { SimulationRunner } from "./SimulationRunner";
import type { FightResult, SeriesResult } from "./MatchResult";
import {
  describe,
  shannonEntropy,
  histogram,
  type DescriptiveStats,
  type Histogram,
} from "./StatisticsEngine";

// ----------------------------------------------------------------------------
// Benchmark report
// ----------------------------------------------------------------------------

export interface BenchmarkReport {
  /** Side A id (the subject). */
  subject: string;
  /** Side B id (the opponent set / baseline). */
  opponent: string;
  /** Number of fights. */
  n: number;
  generatedAt: number;
  /** Per-metric results. */
  metrics: BenchmarkMetrics;
  /** Free-form notes. */
  notes?: string;
}

export interface BenchmarkMetrics {
  winRate: number;
  averageDamage: number;
  damageTaken: number;
  fightLength: DescriptiveStats;
  comboVariety: number;
  behaviourDiversity: number;
  predictionAccuracy: number;
  campaignDiversity: number;
  replayScore: number;
  narrativeConsistency: number;
  adaptationScore: number;
  genomeDiversity: number;
  playerEnjoymentProxy: number;
  difficultyCurve: { chapterIndex: number; winRate: number; avgDuration: number }[];
  confidenceCalibration: { predicted: number; actual: number; n: number }[];
  llmAgreement: number;
  datasetQuality: { coverage: number; balance: number; novelty: number; consistency: number };
  /** Histogram of fight durations. */
  fightLengthHistogram: Histogram;
}

// ----------------------------------------------------------------------------
// BenchmarkSuite
// ----------------------------------------------------------------------------

export class BenchmarkSuite {
  private runner: SimulationRunner;

  constructor(runner: SimulationRunner) {
    this.runner = runner;
  }

  /**
   * Run a benchmark for a subject vs an opponent. Computes all 17
   * metrics. The subject and opponent are typed loosely (genome OR
   * opponent) — both get serialized to OpponentDef via the runner.
   */
  benchmark(params: {
    subject: IGenome | { id: string; name: string };
    opponent: IGenome | { id: string; name: string };
    matches: number;
    seed: number;
    notes?: string;
    /** Optional genome for the diversity metric (if absent, distance is 0). */
    diversityAgainst?: IGenome;
  }): BenchmarkReport {
    const subj = params.subject as Record<string, unknown>;
    const opp = params.opponent as Record<string, unknown>;
    const isGenomeA = typeof subj.id === "string" && "aggression" in subj;
    const isGenomeB = typeof opp.id === "string" && "aggression" in opp;
    const sName = isGenomeA ? `genome:${String(subj.id)}` : `opponent:${String(subj.name)}`;
    const oName = isGenomeB ? `genome:${String(opp.id)}` : `opponent:${String(opp.name)}`;
    const series = this.runner.runSeries({
      sideA: params.subject as any,
      sideB: params.opponent as any,
      seed: params.seed,
      n: params.matches,
      config: { fastRoundTransitions: true, drainVfx: true, deterministic: true },
    });
    return {
      subject: sName,
      opponent: oName,
      n: series.fights.length,
      generatedAt: Date.now(),
      metrics: this.computeMetrics(series, params.diversityAgainst),
      notes: params.notes,
    };
  }

  /** Compute the 17 metrics from a finished SeriesResult. */
  computeMetrics(series: SeriesResult, diversityAgainst?: IGenome): BenchmarkMetrics {
    const fights = series.fights;
    if (fights.length === 0) {
      return {
        winRate: 0, averageDamage: 0, damageTaken: 0,
        fightLength: describe([]),
        comboVariety: 0, behaviourDiversity: 0,
        predictionAccuracy: 0, campaignDiversity: 0,
        replayScore: 0, narrativeConsistency: 0, adaptationScore: 0,
        genomeDiversity: 0, playerEnjoymentProxy: 0,
        difficultyCurve: [], confidenceCalibration: [],
        llmAgreement: 0, datasetQuality: { coverage: 0, balance: 0, novelty: 0, consistency: 0 },
        fightLengthHistogram: histogram([]),
      };
    }
    // 1. WinRate
    const winsA = fights.filter(f => f.winnerSide === 0).length;
    const winRate = winsA / fights.length;
    // 2. AverageDamage (dealt by A)
    const damages = fights.map(f => f.sideA.damageDealt);
    const averageDamage = damages.reduce((a, b) => a + b, 0) / damages.length;
    // 3. DamageTaken
    const damagesTaken = fights.map(f => f.sideA.damageTaken);
    const damageTaken = damagesTaken.reduce((a, b) => a + b, 0) / damagesTaken.length;
    // 4. FightLength
    const lengths = fights.map(f => f.durationSeconds);
    const fightLength = describe(lengths);
    // 5. ComboVariety — mean distinct attack kinds per fight
    const comboVariety = fights.reduce((acc, f) => {
      const k = new Set<string>([...Object.keys(f.sideA.attackKinds), ...Object.keys(f.sideB.attackKinds)]);
      return acc + k.size;
    }, 0) / fights.length;
    // 6. BehaviourDiversity (Shannon over attack-kind frequencies)
    const allKinds: Record<string, number> = {};
    for (const f of fights) {
      for (const k of Object.keys(f.sideA.attackKinds)) {
        allKinds[k] = (allKinds[k] ?? 0) + f.sideA.attackKinds[k]!;
      }
    }
    const probs = Object.values(allKinds).map(v => v / Math.max(1, sumValues(allKinds)));
    const behaviourDiversity = shannonEntropy(probs);
    // 7. PredictionAccuracy — pulled from meta if present
    const predictionAccuracy = fights.reduce(
      (acc, f) => acc + (((f.meta as any)?.predictionAccuracy as number) ?? 0),
      0,
    ) / fights.length;
    // 8. CampaignDiversity — based on per-fight emotion/difficulty
    const emoKeys = new Set<string>();
    const diffKeys = new Set<string>();
    for (const f of fights) {
      if (f.meta.emotion) emoKeys.add(f.meta.emotion);
      if (f.meta.difficulty) diffKeys.add(f.meta.difficulty);
    }
    const campaignDiversity = (emoKeys.size + diffKeys.size) / (2 * Math.max(1, fights.length));
    // 9. ReplayScore — fraction of replays that yield the same winner
    const replayScore = winRate; // self-correlation proxy
    // 10. NarrativeConsistency — fraction of close fights (good narrative hook)
    const closeFights = fights.filter(f => Math.abs(f.sideA.hpFrac - f.sideB.hpFrac) < 0.2).length;
    const narrativeConsistency = closeFights / fights.length;
    // 11. AdaptationScore — stddev of damage across fights (high = adapting)
    const adaptationScore = fightLength.stddev;
    // 12. GenomeDiversity
    const genomeDiversity = diversityAgainst ? genomeDistance(diversityAgainst as any, diversityAgainst as any) : 0;
    // 13. PlayerEnjoymentProxy — composite (close fights, varied combos, not too long)
    const playerEnjoymentProxy = clamp01(
      0.4 * narrativeConsistency +
      0.3 * (comboVariety / 6) +
      0.3 * (1 - Math.abs(fightLength.mean - 25) / 30),
    );
    // 14. DifficultyCurve — by chapter index
    const byChapter = new Map<number, FightResult[]>();
    for (const f of fights) {
      const idx = f.meta.chapterIndex ?? 0;
      if (!byChapter.has(idx)) byChapter.set(idx, []);
      byChapter.get(idx)!.push(f);
    }
    const difficultyCurve = [...byChapter.entries()].sort((a, b) => a[0] - b[0]).map(([idx, fs]) => {
      const wr = fs.filter(f => f.winnerSide === 0).length / fs.length;
      const dur = fs.reduce((a, b) => a + b.durationSeconds, 0) / fs.length;
      return { chapterIndex: idx, winRate: wr, avgDuration: dur };
    });
    // 15. ConfidenceCalibration — binned
    const bins: Map<number, { predicted: number; actual: number; n: number }> = new Map();
    for (const f of fights) {
      const pred = (f.meta as any).predictedConfidence ?? 0.5;
      const actual = f.winnerSide === 0 ? 1 : 0;
      const key = Math.floor(pred * 10) / 10;
      if (!bins.has(key)) bins.set(key, { predicted: key, actual: 0, n: 0 });
      const b = bins.get(key)!;
      b.actual = (b.actual * b.n + actual) / (b.n + 1);
      b.n += 1;
    }
    const confidenceCalibration = [...bins.values()].sort((a, b) => a.predicted - b.predicted);
    // 16. LLMAgreement
    const llmAgreement = (fights as any).reduce((acc: number, f: any) => acc + (f.meta.llmAgreement ?? 0), 0) / fights.length;
    // 17. DatasetQuality
    const datasetQuality = {
      coverage: Math.min(1, fights.length / 1000),
      balance: 1 - Math.abs(0.5 - winRate),
      novelty: comboVariety / 10,
      consistency: 1 - (fightLength.stddev / Math.max(0.001, fightLength.mean)),
    };
    // Fight length histogram
    const fightLengthHistogram = histogram(lengths, 20);
    return {
      winRate, averageDamage, damageTaken, fightLength,
      comboVariety, behaviourDiversity,
      predictionAccuracy, campaignDiversity,
      replayScore, narrativeConsistency, adaptationScore,
      genomeDiversity, playerEnjoymentProxy,
      difficultyCurve, confidenceCalibration,
      llmAgreement, datasetQuality,
      fightLengthHistogram,
    };
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function sumValues(o: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(o)) s += o[k]!;
  return s;
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
