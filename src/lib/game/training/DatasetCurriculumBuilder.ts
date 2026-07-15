// ============================================================================
// PHASE 1 + PHASE 5: DATASET CURRICULUM BUILDER
//
// Two responsibilities:
//   1. Take the raw GameDesignDataset and produce a balanced
//      curriculum across the 11 required dimensions.
//   2. Partition the balanced corpus into 4 curriculum levels
//      (simple → complex) so future fine-tuning can progress
//      progressively.
//
// Reuses:
//   - GameDesignSample from the gamedesigner module
//   - DatasetRanker (PHASE 3) for tier selection
//   - DatasetBalancer (PHASE 4) for rebalancing
//   - NearDuplicateDetector (PHASE 2) for dedup
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import { DatasetRanker, type RankerResult, DEFAULT_RANKER_CONFIG } from "./DatasetRanker";
import { DatasetBalancer, type BalanceReport } from "./DatasetBalancer";
import { NearDuplicateDetector, type DuplicateReport } from "./NearDuplicateDetector";
import {
  type RankedSample,
  type SampleTier,
  type SampleBuckets,
  makeRng,
} from "./types";

export interface CurriculumConfig {
  // Tier policies — which tiers feed each curriculum level
  levels: {
    level1: SampleTier[];     // simple
    level2: SampleTier[];
    level3: SampleTier[];
    level4: SampleTier[];     // most complex
  };
  // Maximum per-level size. 0 = unlimited.
  maxPerLevel: number;
  // Whether to include "fallback" samples in any level. Default: false.
  includeFallback: boolean;
}

export const DEFAULT_CURRICULUM_CONFIG: CurriculumConfig = {
  levels: {
    level1: ["gold", "silver"],
    level2: ["gold", "silver"],
    level3: ["gold", "silver"],
    level4: ["gold", "silver"],
  },
  maxPerLevel: 0,
  includeFallback: false,
};

export interface CurriculumLevel {
  id: 1 | 2 | 3 | 4;
  label: string;
  description: string;
  sampleCount: number;
  jsonl: string;
  buckets: Record<string, Record<string, number>>;   // dim → bucket → count
  averageScore: number;
  averageConfidence: number;
  averageQuality: number;
  samples: GameDesignSample[];
}

export interface Curriculum {
  generatedAt: number;
  totalInputSamples: number;
  totalKeptSamples: number;
  duplicateReport: DuplicateReport;
  rankerResult: RankerResult;
  balanceReport: BalanceReport;
  levels: CurriculumLevel[];
  metadata: {
    seed: number;
    config: CurriculumConfig;
  };
}

export class DatasetCurriculumBuilder {
  private dedup = new NearDuplicateDetector();
  private ranker = new DatasetRanker();
  private balancer = new DatasetBalancer();
  private curriculumConfig: CurriculumConfig;

  constructor(curriculumConfig: Partial<CurriculumConfig> = {}) {
    this.curriculumConfig = {
      ...DEFAULT_CURRICULUM_CONFIG,
      ...curriculumConfig,
      levels: { ...DEFAULT_CURRICULUM_CONFIG.levels, ...(curriculumConfig.levels ?? {}) },
    };
  }

  /**
   * Build a complete curriculum. Returns the four levels, the per-phase
   * reports, and the JSONL for each level.
   */
  build(samples: GameDesignSample[], seed = 42): Curriculum {
    // ---- 1. Deduplication ----
    const { kept, report: duplicateReport } = this.dedup.detect(samples);

    // ---- 2. Rank every kept sample ----
    const rankerResult = this.ranker.rank(kept, seed);

    // ---- 3. Rebalance (drop redundant samples from over-represented buckets) ----
    const { samples: balanced, report: balanceReport } = this.balancer.rebalance(rankerResult.ranked);

    // Re-rank after rebalancing (the rankings are still valid but we want
    // a fresh average for reporting).
    const finalRanked = this.ranker.rank(balanced, seed);
    const rankedMap = new Map<string, RankedSample>(finalRanked.ranked.map(r => [r.sample.id, r]));

    // ---- 4. Partition into curriculum levels ----
    const levels = this.partitionByLevel(finalRanked.ranked, this.curriculumConfig, seed);

    return {
      generatedAt: Date.now(),
      totalInputSamples: samples.length,
      totalKeptSamples: balanced.length,
      duplicateReport,
      rankerResult: finalRanked,
      balanceReport,
      levels,
      metadata: {
        seed,
        config: this.curriculumConfig,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Private — curriculum partitioning
  // --------------------------------------------------------------------------

  private partitionByLevel(
    ranked: RankedSample[],
    config: CurriculumConfig,
    seed: number,
  ): CurriculumLevel[] {
    const rng = makeRng(seed);
    const out: CurriculumLevel[] = [];

    for (const lvl of [1, 2, 3, 4] as const) {
      const tierKey = `level${lvl}` as keyof CurriculumConfig["levels"];
      const allowedTiers = new Set<SampleTier>(config.levels[tierKey]);
      const candidates = ranked
        .filter(r => allowedTiers.has(r.tier))
        .filter(r => config.includeFallback ? true : !r.sample.fellback)
        .filter(r => r.sample.validated);
      // Shuffle for variety, then sort by score desc.
      const shuffled = candidates.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      shuffled.sort((a, b) => b.score - a.score);
      const limited = config.maxPerLevel > 0 ? shuffled.slice(0, config.maxPerLevel) : shuffled;
      const samples = limited.map(r => r.sample);
      const jsonl = samples.map(s => JSON.stringify(this.toTrainingPair(s))).join("\n");
      const buckets: Record<string, Record<string, number>> = {};
      for (const r of limited) {
        for (const [k, v] of Object.entries(r.buckets)) {
          const key = k as keyof SampleBuckets;
          if (!buckets[key]) buckets[key] = {};
          const label = String(v);
          buckets[key][label] = (buckets[key][label] ?? 0) + 1;
        }
      }
      const avgScore = avg(limited.map(r => r.score));
      const avgConf = avg(limited.map(r => r.sample.plan.confidence));
      const avgQuality = avg(limited.map(r => r.sample.quality?.overall ?? 0));
      out.push({
        id: lvl,
        label: levelLabel(lvl),
        description: levelDescription(lvl),
        sampleCount: samples.length,
        jsonl,
        buckets,
        averageScore: avgScore,
        averageConfidence: avgConf,
        averageQuality: avgQuality,
        samples,
      });
    }
    return out;
  }

  private toTrainingPair(sample: GameDesignSample): { input: string; output: string; metadata: Record<string, unknown> } {
    return {
      input: JSON.stringify(sample.context),
      output: JSON.stringify(sample.plan),
      metadata: {
        id: sample.id,
        timestamp: sample.timestamp,
        modelId: sample.modelId,
        promptVersion: sample.promptVersion,
        confidence: sample.plan.confidence,
        quality: sample.quality,
        actualResult: sample.actualResult,
        explanation: sample.explanation,
      },
    };
  }
}

// ---- Pure helpers (exported for tests) ----
export function levelLabel(lvl: 1 | 2 | 3 | 4): string {
  switch (lvl) {
    case 1: return "Level 1 — Foundations";
    case 2: return "Level 2 — Standard";
    case 3: return "Level 3 — Adaptive";
    case 4: return "Level 4 — Mastery";
  }
}

export function levelDescription(lvl: 1 | 2 | 3 | 4): string {
  switch (lvl) {
    case 1: return "Simple campaigns, simple player behaviour, high confidence. Foundation skills.";
    case 2: return "Standard campaigns, mixed player profiles, balanced difficulty. Core competency.";
    case 3: return "Adaptive scenarios, varied emotions, complex chapters. Flexibility.";
    case 4: return "Complex campaigns, rare behaviours, long-term adaptations, low-confidence cases. Mastery.";
  }
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
