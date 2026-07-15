// ============================================================================
// PHASE 10: TRAINING READINESS EXPORTER
//
// Splits the GameDesignDatasetLogger's samples into train / validation / test
// JSONL files. Removes duplicates and invalid samples. Produces dataset
// statistics and a readiness report. The output is structured to drop into
// any future fine-tuning job without modification.
//
// No inference. No fine-tuning. No model code. Only data preparation.
// ============================================================================

import type { GameDesignDatasetLogger, GameDesignSample } from "./GameDesignDatasetLogger";
import type { GameDesignQuality } from "./GameDesignQualityEngine";

export interface TrainingSplit {
  train: GameDesignSample[];
  validation: GameDesignSample[];
  test: GameDesignSample[];
}

export interface ExportOptions {
  trainRatio: number;
  validationRatio: number;
  testRatio: number;
  seed: number;
  minQuality: number;        // 0..1
  requireResult: boolean;    // require that the actual result was recorded
  stratifyByVersion: boolean; // ensure each split contains samples from each prompt version
}

export interface DatasetStats {
  total: number;
  train: number;
  validation: number;
  test: number;
  duplicatesRemoved: number;
  invalidRemoved: number;
  highQuality: number;
  mediumQuality: number;
  lowQuality: number;
  byPromptVersion: Record<string, number>;
  byModel: Record<string, number>;
  byQuality: Record<GameDesignQuality, number>;
  byChapter: Record<string, number>;
  avgConfidence: number;
  avgQuality: number;
  tokenEstimate: { train: number; validation: number; test: number };
  uniqueContexts: number;
}

export interface ExportBundle {
  generatedAt: number;
  stats: DatasetStats;
  files: {
    trainJsonl: string;
    validationJsonl: string;
    testJsonl: string;
  };
  readiness: {
    readyForFineTuning: boolean;
    issues: string[];
    recommendations: string[];
  };
}

const DEFAULT_OPTIONS: ExportOptions = {
  trainRatio: 0.8,
  validationRatio: 0.1,
  testRatio: 0.1,
  seed: 42,
  minQuality: 0.5,
  requireResult: true,
  stratifyByVersion: true,
};

/**
 * Mulberry32 — small, deterministic PRNG. Used for reproducible splits.
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TrainingReadinessExporter {
  private logger: GameDesignDatasetLogger;
  private qualityEngine = (logger: GameDesignDatasetLogger) =>
    (logger as unknown as { qualityEngine: { score: (s: GameDesignSample) => { quality: GameDesignQuality; overall: number } } }).qualityEngine;

  constructor(logger: GameDesignDatasetLogger) {
    this.logger = logger;
  }

  /**
   * Run the full pipeline: dedup, prune, split, export.
   */
  exportBundle(opts: Partial<ExportOptions> = {}): ExportBundle {
    const options: ExportOptions = { ...DEFAULT_OPTIONS, ...opts };

    // 1. Take a snapshot (do not mutate the logger's data in place)
    const workingSamples: GameDesignSample[] = this.logger.getSamples().map(s => ({ ...s }));
    const initialTotal = workingSamples.length;

    // 2. Deduplicate by contextHash
    const seen = new Set<string>();
    const deduped: GameDesignSample[] = [];
    let duplicatesRemoved = 0;
    for (const s of workingSamples) {
      if (seen.has(s.contextHash)) {
        duplicatesRemoved++;
        continue;
      }
      seen.add(s.contextHash);
      deduped.push(s);
    }

    // 3. Prune invalid / low-quality
    const filtered: GameDesignSample[] = [];
    let invalidRemoved = 0;
    for (const s of deduped) {
      if (!s.validated) { invalidRemoved++; continue; }
      if (s.fellback) { invalidRemoved++; continue; }
      if (s.quality && s.quality.overall < options.minQuality) { invalidRemoved++; continue; }
      if (options.requireResult && (!s.actualResult.engaged && s.actualResult.damageDealt === 0)) {
        invalidRemoved++;
        continue;
      }
      filtered.push(s);
    }

    // 4. Shuffle deterministically
    const rng = makeRng(options.seed);
    const shuffled = [...filtered];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // 5. Split (with optional stratification by prompt version)
    const split = options.stratifyByVersion
      ? this.stratifiedSplit(shuffled, options, rng)
      : this.simpleSplit(shuffled, options);

    // 6. Build per-split JSONL
    const trainJsonl = this.toJsonl(split.train);
    const validationJsonl = this.toJsonl(split.validation);
    const testJsonl = this.toJsonl(split.test);

    // 7. Stats
    const stats = this.buildStats(filtered, split, duplicatesRemoved, invalidRemoved, initialTotal);

    // 8. Readiness assessment
    const readiness = this.assessReadiness(stats);

    return {
      generatedAt: Date.now(),
      stats,
      files: { trainJsonl, validationJsonl, testJsonl },
      readiness,
    };
  }

  /**
   * Get the readiness report without writing files.
   */
  assessReadinessReport(): { ready: boolean; issues: string[]; recommendations: string[]; stats: DatasetStats } {
    const dummy = this.exportBundle({});
    return {
      ready: dummy.readiness.readyForFineTuning,
      issues: dummy.readiness.issues,
      recommendations: dummy.readiness.recommendations,
      stats: dummy.stats,
    };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private simpleSplit(samples: GameDesignSample[], opts: ExportOptions): TrainingSplit {
    const total = samples.length;
    const trainEnd = Math.floor(total * opts.trainRatio);
    const valEnd = trainEnd + Math.floor(total * opts.validationRatio);
    return {
      train: samples.slice(0, trainEnd),
      validation: samples.slice(trainEnd, valEnd),
      test: samples.slice(valEnd),
    };
  }

  private stratifiedSplit(samples: GameDesignSample[], opts: ExportOptions, _rng: () => number): TrainingSplit {
    // Group by prompt version
    const groups = new Map<string, GameDesignSample[]>();
    for (const s of samples) {
      const v = s.promptVersion || "unknown";
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(s);
    }
    const train: GameDesignSample[] = [];
    const val: GameDesignSample[] = [];
    const test: GameDesignSample[] = [];
    for (const arr of groups.values()) {
      // Each group is already shuffled in the parent shuffle (deterministic per group iteration).
      // Re-shuffle the group with the same rng seed offset for determinism.
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(_rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const t = Math.floor(shuffled.length * opts.trainRatio);
      const v = t + Math.floor(shuffled.length * opts.validationRatio);
      train.push(...shuffled.slice(0, t));
      val.push(...shuffled.slice(t, v));
      test.push(...shuffled.slice(v));
    }
    return { train, validation: val, test };
  }

  private toJsonl(samples: GameDesignSample[]): string {
    return samples
      .map(s => JSON.stringify(this.logger.toTrainingPair(s)))
      .join("\n");
  }

  private buildStats(
    filtered: GameDesignSample[],
    split: TrainingSplit,
    duplicatesRemoved: number,
    invalidRemoved: number,
    initialTotal: number,
  ): DatasetStats {
    const all = [...split.train, ...split.validation, ...split.test];
    const byVersion: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byQuality: Record<GameDesignQuality, number> = { high: 0, medium: 0, low: 0 };
    const byChapter: Record<string, number> = {};
    let qualitySum = 0;
    let confSum = 0;
    let uniqueContexts = new Set<string>();
    let highQ = 0, medQ = 0, lowQ = 0;

    for (const s of all) {
      byVersion[s.promptVersion] = (byVersion[s.promptVersion] ?? 0) + 1;
      byModel[s.modelId] = (byModel[s.modelId] ?? 0) + 1;
      if (s.quality) {
        byQuality[s.quality.quality]++;
        qualitySum += s.quality.overall;
        if (s.quality.quality === "high") highQ++;
        else if (s.quality.quality === "medium") medQ++;
        else lowQ++;
      }
      confSum += s.confidence;
      uniqueContexts.add(s.contextHash);
      const c = s.context.currentChapter?.chapterIndex?.toString() ?? "none";
      byChapter[c] = (byChapter[c] ?? 0) + 1;
    }

    const tokenEstimate = (arr: GameDesignSample[]) => {
      let sum = 0;
      for (const s of arr) {
        sum += JSON.stringify(s.context).length / 4;
        sum += JSON.stringify(s.plan).length / 4;
      }
      return Math.round(sum);
    };

    return {
      total: initialTotal,
      train: split.train.length,
      validation: split.validation.length,
      test: split.test.length,
      duplicatesRemoved,
      invalidRemoved,
      highQuality: highQ,
      mediumQuality: medQ,
      lowQuality: lowQ,
      byPromptVersion: byVersion,
      byModel,
      byQuality,
      byChapter,
      avgConfidence: all.length > 0 ? confSum / all.length : 0,
      avgQuality: all.length > 0 ? qualitySum / all.length : 0,
      tokenEstimate: {
        train: tokenEstimate(split.train),
        validation: tokenEstimate(split.validation),
        test: tokenEstimate(split.test),
      },
      uniqueContexts: uniqueContexts.size,
    };
  }

  private assessReadiness(stats: DatasetStats): { readyForFineTuning: boolean; issues: string[]; recommendations: string[] } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (stats.train < 50) {
      issues.push(`Train set is small (${stats.train} samples). Fine-tuning needs at least 50.`);
    } else if (stats.train < 200) {
      recommendations.push(`Train set is below the recommended 200 samples. Continue collecting.`);
    }

    if (stats.validation < 10) {
      issues.push(`Validation set is too small (${stats.validation} samples). Need at least 10.`);
    }
    if (stats.test < 10) {
      issues.push(`Test set is too small (${stats.test} samples). Need at least 10.`);
    }

    if (Object.keys(stats.byPromptVersion).length > 1) {
      const versions = Object.keys(stats.byPromptVersion);
      recommendations.push(`Multiple prompt versions present (${versions.join(", ")}). Consider stratifying or filtering to one version.`);
    }

    if (stats.byQuality.high / Math.max(1, stats.train + stats.validation + stats.test) < 0.4) {
      recommendations.push(`Less than 40% of samples are high-quality. Consider improving data collection.`);
    }

    if (stats.duplicatesRemoved > 0) {
      recommendations.push(`Removed ${stats.duplicatesRemoved} duplicate samples.`);
    }
    if (stats.invalidRemoved > 0) {
      recommendations.push(`Removed ${stats.invalidRemoved} invalid samples.`);
    }

    const ready = issues.length === 0;
    return { readyForFineTuning: ready, issues, recommendations };
  }
}
