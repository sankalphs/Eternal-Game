// ============================================================================
// PHASE 8: BENCHMARK BUILDER
//
// Selects benchmark samples that are NEVER mixed into training data.
// Five suites are produced:
//   - benchmark_easy            (low complexity, simple player profiles)
//   - benchmark_medium          (standard campaigns)
//   - benchmark_hard            (brutal difficulty, expert players)
//   - benchmark_generalization  (mixed / held-out from training buckets)
//   - benchmark_rare            (rare behaviours, low-frequency buckets)
//
// Benchmark samples are removed from the training pool by the
// BundleGenerator to guarantee a clean eval/test split.
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import { extractBuckets, makeRng } from "./types";

export interface BenchmarkSuite {
  id: "easy" | "medium" | "hard" | "generalization" | "rare";
  label: string;
  description: string;
  samples: GameDesignSample[];
  jsonl: string;
  sampleCount: number;
  selectionCriteria: string[];
}

export interface BenchmarkConfig {
  // Number of samples per suite (0 = all matching)
  perSuite: number;
  // Hold-out set size (the suites are sampled from this hold-out)
  holdoutSize: number;
  seed: number;
  // The "rare" suite looks at buckets with < this share of the dataset
  rareShare: number;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  perSuite: 100,
  holdoutSize: 600,
  seed: 4242,
  rareShare: 0.05,
};

export interface BenchmarkBundle {
  generatedAt: number;
  config: BenchmarkConfig;
  holdoutSize: number;
  suites: BenchmarkSuite[];
  // The sample ids that are reserved for benchmarking (must not appear in training)
  reservedIds: Set<string>;
}

export class BenchmarkBuilder {
  private config: BenchmarkConfig;

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_BENCHMARK_CONFIG, ...config };
  }

  /**
   * Build all five benchmark suites and the set of reserved ids.
   */
  build(samples: GameDesignSample[]): BenchmarkBundle {
    const rng = makeRng(this.config.seed);
    // 1. Take a deterministic hold-out
    const shuffled = samples.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const holdout = shuffled.slice(0, Math.min(this.config.holdoutSize, shuffled.length));

    // 2. Pre-compute distributions on the holdout
    const dist = new Map<string, number>();
    for (const s of holdout) {
      const b = extractBuckets(s);
      for (const v of Object.values(b)) {
        const k = String(v);
        dist.set(k, (dist.get(k) ?? 0) + 1);
      }
    }
    const total = Math.max(1, holdout.length);

    // 3. Build each suite
    const easy = this.suite(holdout, "easy", s => isEasy(s), [
      "skill in {novice, intermediate}",
      "difficulty in {easy, normal}",
      "campaignStage = opening or rising",
      "adaptation in {low, medium}",
    ]);
    const medium = this.suite(holdout, "medium", s => isMedium(s), [
      "skill in {intermediate, advanced}",
      "difficulty in {normal, hard}",
      "campaignStage = rising or climax",
      "adaptation in {medium, high}",
    ]);
    const hard = this.suite(holdout, "hard", s => isHard(s), [
      "skill = expert",
      "difficulty in {brutal, nightmare}",
      "campaignStage = climax or resolution",
      "adaptation in {high, exceptional}",
    ]);
    const generalization = this.suite(holdout, "generalization", s => isGeneralization(s), [
      "difficulty = adaptive",
      "skill = advanced",
      "campaignStage = falling",
    ]);
    const rare = this.suite(holdout, "rare", s => isRare(s, dist, total, this.config.rareShare), [
      `bucket appears in < ${this.config.rareShare * 100}% of dataset`,
    ]);

    const reserved = new Set<string>();
    for (const s of [easy, medium, hard, generalization, rare]) {
      for (const sample of s.samples) reserved.add(sample.id);
    }

    return {
      generatedAt: Date.now(),
      config: this.config,
      holdoutSize: holdout.length,
      suites: [easy, medium, hard, generalization, rare],
      reservedIds: reserved,
    };
  }

  private suite(
    pool: GameDesignSample[],
    id: BenchmarkSuite["id"],
    predicate: (s: GameDesignSample) => boolean,
    criteria: string[],
  ): BenchmarkSuite {
    const matches = pool.filter(predicate);
    const picked = this.config.perSuite > 0 ? matches.slice(0, this.config.perSuite) : matches;
    return {
      id,
      label: this.labelOf(id),
      description: this.descOf(id),
      samples: picked,
      sampleCount: picked.length,
      jsonl: picked.map(s => JSON.stringify(toTrainingPair(s))).join("\n"),
      selectionCriteria: criteria,
    };
  }

  private labelOf(id: BenchmarkSuite["id"]): string {
    return {
      easy: "Easy Encounter Benchmark",
      medium: "Medium Encounter Benchmark",
      hard: "Hard Encounter Benchmark",
      generalization: "Generalization Benchmark",
      rare: "Rare Behaviour Benchmark",
    }[id];
  }

  private descOf(id: BenchmarkSuite["id"]): string {
    return {
      easy: "Low-skill players, easy/normal difficulty, opening campaign stages.",
      medium: "Standard encounters, mixed skill, balanced difficulty.",
      hard: "Expert players, brutal/nightmare difficulty, climax or resolution stages.",
      generalization: "Adaptive difficulty, advanced players, falling campaign stages.",
      rare: "Samples from under-represented buckets — model must generalize beyond common cases.",
    }[id];
  }
}

// ---- Pure predicates ----
function isEasy(s: GameDesignSample): boolean {
  const b = extractBuckets(s);
  const skillOk = b.skill === "novice" || b.skill === "intermediate";
  const diffOk = b.difficulty === "easy" || b.difficulty === "normal";
  const stageOk = b.campaignStage === "opening" || b.campaignStage === "rising";
  const adaptOk = b.adaptation === "low" || b.adaptation === "medium";
  return skillOk && diffOk && stageOk && adaptOk;
}

function isMedium(s: GameDesignSample): boolean {
  const b = extractBuckets(s);
  const skillOk = b.skill === "intermediate" || b.skill === "advanced";
  const diffOk = b.difficulty === "normal" || b.difficulty === "hard";
  const stageOk = b.campaignStage === "rising" || b.campaignStage === "climax";
  const adaptOk = b.adaptation === "medium" || b.adaptation === "high";
  return skillOk && diffOk && stageOk && adaptOk;
}

function isHard(s: GameDesignSample): boolean {
  const b = extractBuckets(s);
  const skillOk = b.skill === "expert";
  const diffOk = b.difficulty === "brutal" || b.difficulty === "nightmare";
  const stageOk = b.campaignStage === "climax" || b.campaignStage === "resolution";
  const adaptOk = b.adaptation === "high" || b.adaptation === "exceptional";
  return skillOk && diffOk && stageOk && adaptOk;
}

function isGeneralization(s: GameDesignSample): boolean {
  const b = extractBuckets(s);
  return b.difficulty === "adaptive"
    && b.skill === "advanced"
    && b.campaignStage === "falling";
}

function isRare(s: GameDesignSample, dist: Map<string, number>, total: number, rareShare: number): boolean {
  const b = extractBuckets(s);
  // A sample is "rare" if ANY of its buckets is under-represented.
  for (const v of Object.values(b)) {
    const k = String(v);
    const share = (dist.get(k) ?? 0) / total;
    if (share < rareShare) return true;
  }
  return false;
}

function toTrainingPair(sample: GameDesignSample): { input: string; output: string; metadata: Record<string, unknown> } {
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
