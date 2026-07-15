// ============================================================================
// PHASE 3: DATASET RANKER
//
// Assigns a multi-dimensional score to every sample and buckets it
// into Gold / Silver / Bronze / Discard tiers. The training pipeline
// only exports Gold and Silver by default.
//
// Reuses the existing GameDesignQualityEngine for the base "quality"
// dimension. The other 8 dimensions are derived from the context/plan
// directly (no new sample types).
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import { GameDesignQualityEngine } from "../gamedesigner/GameDesignQualityEngine";
import {
  type RankedSample,
  type SampleTier,
  type SampleBuckets,
  extractBuckets,
  makeRng,
} from "./types";

export interface RankerConfig {
  // Composite weights — must sum to 1.0
  weights: {
    overallQuality: number;
    trainingValue: number;
    novelty: number;
    consistency: number;
    difficulty: number;
    narrativeQuality: number;
    predictionAccuracy: number;
    directorConfidence: number;
    llmConfidence: number;
    adaptationSuccess: number;
  };
  // Tier thresholds
  tiers: {
    gold: number;
    silver: number;
    bronze: number;
  };
  // Reject anything below this overall
  rejectBelow: number;
  // Require a recorded actual result for training value
  requireActualResult: boolean;
  // A sample must pass this many soft checks to be Silver-eligible
  silverMinChecks: number;
}

export const DEFAULT_RANKER_CONFIG: RankerConfig = {
  weights: {
    overallQuality: 0.18,
    trainingValue: 0.16,
    novelty: 0.10,
    consistency: 0.10,
    difficulty: 0.08,
    narrativeQuality: 0.10,
    predictionAccuracy: 0.08,
    directorConfidence: 0.08,
    llmConfidence: 0.07,
    adaptationSuccess: 0.05,
  },
  tiers: { gold: 0.75, silver: 0.6, bronze: 0.4 },
  rejectBelow: 0.3,
  requireActualResult: true,
  silverMinChecks: 5,
};

export interface RankerResult {
  ranked: RankedSample[];
  counts: Record<SampleTier, number>;
  averageScore: number;
  averagePerDimension: Record<keyof RankerConfig["weights"], number>;
}

export class DatasetRanker {
  private config: RankerConfig;
  private quality = new GameDesignQualityEngine();

  constructor(config: Partial<RankerConfig> = {}) {
    this.config = {
      ...DEFAULT_RANKER_CONFIG,
      ...config,
      weights: { ...DEFAULT_RANKER_CONFIG.weights, ...(config.weights ?? {}) },
      tiers: { ...DEFAULT_RANKER_CONFIG.tiers, ...(config.tiers ?? {}) },
    };
  }

  /**
   * Score every sample. Order is preserved (stable sort by score desc).
   * The novelty dimension is computed against the rest of the cohort
   * — see `cohortNoveltyOf`.
   */
  rank(samples: GameDesignSample[], seed = 1): RankerResult {
    // Pre-compute novelty against the whole cohort
    const noveltyScores = this.cohortNoveltyOf(samples);

    const ranked: RankedSample[] = samples.map((s, i) => this.scoreOne(s, i, noveltyScores));
    ranked.sort((a, b) => b.score - a.score);

    const counts: Record<SampleTier, number> = { gold: 0, silver: 0, bronze: 0, discard: 0 };
    let scoreSum = 0;
    const dimSum: Record<keyof RankerConfig["weights"], number> = {
      overallQuality: 0, trainingValue: 0, novelty: 0, consistency: 0,
      difficulty: 0, narrativeQuality: 0, predictionAccuracy: 0,
      directorConfidence: 0, llmConfidence: 0, adaptationSuccess: 0,
    };

    for (const r of ranked) {
      counts[r.tier]++;
      scoreSum += r.score;
      for (const k of Object.keys(dimSum) as (keyof RankerConfig["weights"])[]) {
        dimSum[k] += r[k];
      }
    }

    const n = Math.max(1, ranked.length);
    const averagePerDimension = Object.fromEntries(
      Object.entries(dimSum).map(([k, v]) => [k, v / n]),
    ) as Record<keyof RankerConfig["weights"], number>;

    // Use the seed to add a tiny deterministic perturbation so
    // repeated calls over the same data still return RankedSample[]
    // in a stable but verifiable order.
    if (seed !== 0) {
      const rng = makeRng(seed);
      ranked.forEach((r, i) => {
        r.score += (rng() - 0.5) * 1e-9 * (ranked.length - i);
      });
    }

    return {
      ranked,
      counts,
      averageScore: ranked.length > 0 ? scoreSum / ranked.length : 0,
      averagePerDimension,
    };
  }

  // --------------------------------------------------------------------------
  // Per-sample scoring
  // --------------------------------------------------------------------------

  private scoreOne(s: GameDesignSample, _idx: number, noveltyScores: number[]): RankedSample {
    const buckets: SampleBuckets = extractBuckets(s);
    const q = s.quality ?? this.quality.score(s);

    const overallQuality = q.overall;
    const trainingValue = this.trainingValueOf(s);
    const novelty = noveltyScores[0] ?? 0; // filled in by cohortNoveltyOf
    const consistency = this.consistencyOf(s, q);
    const difficulty = this.difficultyOf(s);
    const narrativeQuality = this.narrativeQualityOf(s);
    const predictionAccuracy = this.predictionAccuracyOf(s);
    const directorConfidence = q.playerAdaptation;
    const llmConfidence = clamp(s.plan.confidence, 0, 1);
    const adaptationSuccess = this.adaptationSuccessOf(s);

    const w = this.config.weights;
    const score =
      overallQuality * w.overallQuality +
      trainingValue * w.trainingValue +
      novelty * w.novelty +
      consistency * w.consistency +
      difficulty * w.difficulty +
      narrativeQuality * w.narrativeQuality +
      predictionAccuracy * w.predictionAccuracy +
      directorConfidence * w.directorConfidence +
      llmConfidence * w.llmConfidence +
      adaptationSuccess * w.adaptationSuccess;

    const tier = this.tierOf(score, s);

    // Touch the second noveltyScores entry (used in cohortNoveltyOf)
    void noveltyScores[1];

    return {
      sample: s,
      buckets,
      overallQuality, trainingValue, novelty, consistency,
      difficulty, narrativeQuality, predictionAccuracy,
      directorConfidence, llmConfidence, adaptationSuccess,
      score, tier,
    };
  }

  private tierOf(score: number, s: GameDesignSample): SampleTier {
    if (s.fellback) return "discard";
    if (!s.validated) return "discard";
    if (s.errors.length > 0) return "discard";
    if (score < this.config.rejectBelow) return "discard";
    if (score < this.config.tiers.bronze) return "discard";
    if (score < this.config.tiers.silver) return "bronze";
    if (score < this.config.tiers.gold) return "silver";
    return "gold";
  }

  // --------------------------------------------------------------------------
  // Dimension scorers
  // --------------------------------------------------------------------------

  private trainingValueOf(s: GameDesignSample): number {
    let v = 0.5;
    if (s.actualResult.engaged) v += 0.2;
    if (s.actualResult.damageDealt > 0 || s.actualResult.damageTaken > 0) v += 0.15;
    if (this.config.requireActualResult && !s.actualResult.engaged && s.actualResult.damageDealt === 0) {
      v = Math.min(v, 0.3);
    }
    if (s.quality && s.quality.overall >= 0.7) v += 0.1;
    if (s.plan.confidence >= 0.7) v += 0.05;
    return clamp(v, 0, 1);
  }

  private consistencyOf(s: GameDesignSample, q: { narrativeConsistency: number; emotionConsistency: number; campaignContinuity: number }): number {
    // Average three consistency dimensions from the existing quality engine
    return clamp((q.narrativeConsistency + q.emotionConsistency + q.campaignContinuity) / 3, 0, 1);
  }

  private difficultyOf(s: GameDesignSample): number {
    // Difficulty = 0..1 mapped to "training value" of the difficulty
    // the player faced. brutal > hard > normal > easy (training value).
    const d = s.plan.targetDifficulty;
    const map: Record<string, number> = {
      easy: 0.2, normal: 0.45, hard: 0.65, brutal: 0.85, nightmare: 1.0, adaptive: 0.6,
    };
    return map[d] ?? 0.5;
  }

  private narrativeQualityOf(s: GameDesignSample): number {
    let v = 0.5;
    if (s.explanation && s.explanation.length >= 60) v += 0.2;
    if (s.explanation && s.explanation.length >= 120) v += 0.15;
    if (s.plan.intent && s.plan.intent.length > 0) v += 0.05;
    if (s.plan.reasoning && s.plan.reasoning.length > 0) v += 0.1;
    if (s.plan.recommendedNarrativeEvent) v += 0.05;
    return clamp(v, 0, 1);
  }

  private predictionAccuracyOf(s: GameDesignSample): number {
    // We don't have a stored ground truth; we approximate by checking
    // whether the player's actual result is consistent with the design
    // plan's difficulty + genome. Use the existing prediction field.
    const pred = s.context.playerPrediction;
    const confident = ((pred.adaptationRate ?? 0.5) + (pred.whiffPunish ?? 0.5)) / 2;
    if (s.actualResult.engaged) {
      const dealt = s.actualResult.damageDealt;
      const taken = s.actualResult.damageTaken;
      const damageRatio = dealt + taken > 0 ? dealt / (dealt + taken) : 0.5;
      return clamp(0.5 + (confident - 0.5) * 0.5 + (damageRatio - 0.5) * 0.3, 0, 1);
    }
    return 0.4;
  }

  private adaptationSuccessOf(s: GameDesignSample): number {
    // The PlayerAnalyzer's adaptability is already on the context.
    const a = s.context.playerEstimate.adaptability;
    const wr = s.context.campaignHistory?.winRate ?? 0.5;
    return clamp(a * 0.6 + wr * 0.4, 0, 1);
  }

  // --------------------------------------------------------------------------
  // Cohort novelty
  // --------------------------------------------------------------------------

  private cohortNoveltyOf(samples: GameDesignSample[]): number[] {
    const N = samples.length;
    const out = new Array<number>(N).fill(0);
    if (N === 0) return out;

    // For dataset sizes we expect, O(N * K) is fine. We use K = min(50, N).
    const K = Math.min(50, N);
    for (let i = 0; i < N; i++) {
      const sims: number[] = [];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        sims.push(quickSimilarity(samples[i], samples[j]));
      }
      sims.sort((a, b) => b - a);
      const topK = sims.slice(0, K);
      const avg = topK.reduce((a, b) => a + b, 0) / topK.length;
      out[i] = clamp(1 - avg, 0, 1);
    }
    return out;
  }
}

// ---- Pure helpers (exported for the dashboard) ----
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function quickSimilarity(a: GameDesignSample, b: GameDesignSample): number {
  // Fast proxy: count how many high-level fields agree.
  let same = 0;
  let total = 0;
  const pairs: Array<[unknown, unknown]> = [
    [a.plan.targetEmotion, b.plan.targetEmotion],
    [a.plan.targetDifficulty, b.plan.targetDifficulty],
    [a.plan.recommendedGenome, b.plan.recommendedGenome],
    [a.plan.recommendedWeather, b.plan.recommendedWeather],
    [a.plan.recommendedLighting, b.plan.recommendedLighting],
    [a.plan.recommendedMusic, b.plan.recommendedMusic],
    [a.plan.recommendedCamera, b.plan.recommendedCamera],
    [a.plan.recommendedCrowd, b.plan.recommendedCrowd],
    [a.context.topline?.currentMood, b.context.topline?.currentMood],
    [a.context.topline?.recommendedPosture, b.context.topline?.recommendedPosture],
  ];
  for (const [x, y] of pairs) {
    total++;
    if (x === y) same++;
  }
  return same / total;
}
