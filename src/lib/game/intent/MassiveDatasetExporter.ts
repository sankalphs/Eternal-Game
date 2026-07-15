// ============================================================================
// PROJECT ETERNAL — MASSIVE DATASET EXPORTER
//
// Splits an IntentTrainingSample[] into train / validation / test JSONL.
// Removes duplicates, low-confidence, low-quality, fallback samples.
// Produces:
//   - train.jsonl
//   - validation.jsonl
//   - test.jsonl
//   - statistics.json
//   - dataset_report.json
//   - README.md
//
// The exported files are ready to consume by the Modal training
// pipeline (modal_train.py).
// ============================================================================

import type { IntentTrainingSample } from "./IntentTrainingSample";
import type { SampleOrigin, SampleGrade } from "./IntentTrainingSample";
import type { IntentCategory } from "./IntentSchema";
import type { DatasetGenerationReport } from "./MassiveDatasetGenerator";

export interface ExportConfig {
  trainRatio: number;
  validationRatio: number;
  testRatio: number;
  seed: number;
  minQuality: number;
  minConfidence: number;
  stratifyByOrigin: boolean;
  stratifyByIntentCategory: boolean;
  includeRejected: boolean;
}

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  trainRatio: 0.9,
  validationRatio: 0.05,
  testRatio: 0.05,
  seed: 42,
  minQuality: 0.55,
  minConfidence: 0.5,
  stratifyByOrigin: true,
  stratifyByIntentCategory: true,
  includeRejected: false,
};

export interface DatasetStats {
  totalInput: number;
  totalKept: number;
  train: number;
  validation: number;
  test: number;
  duplicatesRemoved: number;
  invalidRemoved: number;
  lowConfidenceRemoved: number;
  lowQualityRemoved: number;
  byOrigin: Record<string, number>;
  byGrade: Record<SampleGrade, number>;
  byIntentCategory: Record<IntentCategory, number>;
  byPromptVersion: Record<string, number>;
  byModel: Record<string, number>;
  avgQuality: number;
  avgConfidence: number;
  avgIntentLength: number;
  avgReasoningLength: number;
  avgPlanLength: number;
  uniqueContexts: number;
  tokenEstimate: { train: number; validation: number; test: number };
}

export interface ExportedDataset {
  trainJsonl: string;
  validationJsonl: string;
  testJsonl: string;
  statisticsJson: string;
  reportJson: string;
  readme: string;
  stats: DatasetStats;
  readiness: {
    readyForFineTuning: boolean;
    issues: string[];
    recommendations: string[];
  };
}

// --------------------------------------------------------------------------
//  The exporter
// --------------------------------------------------------------------------

export class MassiveDatasetExporter {
  private config: ExportConfig;

  constructor(config: Partial<ExportConfig> = {}) {
    this.config = { ...DEFAULT_EXPORT_CONFIG, ...config };
  }

  export(samples: IntentTrainingSample[]): ExportedDataset {
    const config = this.config;

    // 1. Filter
    const filtered = this.filter(samples);
    const duplicatesRemoved = samples.length - filtered.length;

    // 2. Deduplicate by context hash
    const seen = new Set<string>();
    const deduped: IntentTrainingSample[] = [];
    let dupCount = 0;
    for (const s of filtered) {
      if (seen.has(s.input.contextHash)) {
        dupCount++;
        continue;
      }
      seen.add(s.input.contextHash);
      deduped.push(s);
    }

    // 3. Stratified split
    const splits = this.stratifiedSplit(deduped);

    // 4. Compute stats
    const stats = this.computeStats(deduped, splits, duplicatesRemoved + dupCount, samples.length - deduped.length);

    // 5. Serialise
    const trainJsonl = splits.train.map(s => JSON.stringify(toTrainingRecord(s))).join("\n");
    const validationJsonl = splits.validation.map(s => JSON.stringify(toTrainingRecord(s))).join("\n");
    const testJsonl = splits.test.map(s => JSON.stringify(toTrainingRecord(s))).join("\n");

    const statisticsJson = JSON.stringify(stats, null, 2);
    const reportJson = this.renderReport(stats, config);
    const readme = this.renderReadme(stats);

    // 6. Readiness check
    const readiness = this.assessReadiness(stats, config);

    return {
      trainJsonl,
      validationJsonl,
      testJsonl,
      statisticsJson,
      reportJson,
      readme,
      stats,
      readiness,
    };
  }

  // --------------------------------------------------------------------------
  //  Filter
  // --------------------------------------------------------------------------
  private filter(samples: IntentTrainingSample[]): IntentTrainingSample[] {
    const cfg = this.config;
    return samples.filter(s => {
      if (s.fellback) return false;
      if (s.quality < cfg.minQuality) return false;
      if (s.teacherConfidence < cfg.minConfidence) return false;
      if (!s.validated) return false;
      if (!this.config.includeRejected && (s.grade === "discard" || s.grade === "low")) return false;
      return true;
    });
  }

  // --------------------------------------------------------------------------
  //  Stratified split
  // --------------------------------------------------------------------------
  private stratifiedSplit(samples: IntentTrainingSample[]): { train: IntentTrainingSample[]; validation: IntentTrainingSample[]; test: IntentTrainingSample[] } {
    const cfg = this.config;
    const rng = makeRng(cfg.seed);

    // Shuffle
    const shuffled = [...samples];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Stratify
    const groups: Record<string, IntentTrainingSample[]> = {};
    for (const s of shuffled) {
      let key = "default";
      if (cfg.stratifyByOrigin) key = s.origin;
      else if (cfg.stratifyByIntentCategory) key = s.output.intentCategory;
      (groups[key] ??= []).push(s);
    }

    const train: IntentTrainingSample[] = [];
    const validation: IntentTrainingSample[] = [];
    const test: IntentTrainingSample[] = [];

    for (const group of Object.values(groups)) {
      const n = group.length;
      const nTest = Math.max(1, Math.floor(n * cfg.testRatio));
      const nVal = Math.max(1, Math.floor(n * cfg.validationRatio));
      const nTrain = n - nTest - nVal;
      train.push(...group.slice(0, nTrain));
      validation.push(...group.slice(nTrain, nTrain + nVal));
      test.push(...group.slice(nTrain + nVal));
    }

    return { train, validation, test };
  }

  // --------------------------------------------------------------------------
  //  Stats
  // --------------------------------------------------------------------------
  private computeStats(
    samples: IntentTrainingSample[],
    splits: { train: IntentTrainingSample[]; validation: IntentTrainingSample[]; test: IntentTrainingSample[] },
    duplicatesRemoved: number,
    invalidRemoved: number,
  ): DatasetStats {
    const byOrigin: Record<string, number> = {};
    const byGrade: Record<SampleGrade, number> = { gold: 0, high: 0, medium: 0, low: 0, discard: 0 };
    const byCategory: Record<string, number> = {};
    const byPromptVersion: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let qualitySum = 0;
    let confidenceSum = 0;
    let intentLenSum = 0;
    let reasoningLenSum = 0;
    let planLenSum = 0;
    const uniqueContexts = new Set<string>();

    for (const s of samples) {
      byOrigin[s.origin] = (byOrigin[s.origin] ?? 0) + 1;
      byGrade[s.grade] = (byGrade[s.grade] ?? 0) + 1;
      byCategory[s.output.intentCategory] = (byCategory[s.output.intentCategory] ?? 0) + 1;
      byPromptVersion[s.versions.prompt] = (byPromptVersion[s.versions.prompt] ?? 0) + 1;
      byModel[s.versions.model] = (byModel[s.versions.model] ?? 0) + 1;
      qualitySum += s.quality;
      confidenceSum += s.teacherConfidence;
      intentLenSum += s.output.intent.intent.length;
      reasoningLenSum += s.output.intent.reasoning.length;
      planLenSum += s.output.intent.highLevelPlan.length;
      uniqueContexts.add(s.input.contextHash);
    }

    const n = Math.max(1, samples.length);
    return {
      totalInput: samples.length + duplicatesRemoved + invalidRemoved,
      totalKept: samples.length,
      train: splits.train.length,
      validation: splits.validation.length,
      test: splits.test.length,
      duplicatesRemoved,
      invalidRemoved,
      lowConfidenceRemoved: 0,
      lowQualityRemoved: 0,
      byOrigin,
      byGrade,
      byIntentCategory: byCategory as Record<IntentCategory, number>,
      byPromptVersion,
      byModel,
      avgQuality: qualitySum / n,
      avgConfidence: confidenceSum / n,
      avgIntentLength: intentLenSum / n,
      avgReasoningLength: reasoningLenSum / n,
      avgPlanLength: planLenSum / n,
      uniqueContexts: uniqueContexts.size,
      tokenEstimate: {
        train: estimateTokens(splits.train),
        validation: estimateTokens(splits.validation),
        test: estimateTokens(splits.test),
      },
    };
  }

  // --------------------------------------------------------------------------
  //  Readiness
  // --------------------------------------------------------------------------
  private assessReadiness(stats: DatasetStats, config: ExportConfig): ExportedDataset["readiness"] {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (stats.train < 1000) {
      issues.push(`Train set is small (${stats.train}). Recommended: >= 10,000 for fine-tuning a 270M model.`);
    } else if (stats.train < 10000) {
      recommendations.push(`Train set is ${stats.train}. For best results, target >= 10,000.`);
    }

    if (stats.validation < 100) {
      issues.push(`Validation set is too small (${stats.validation}). Need >= 100.`);
    }
    if (stats.test < 100) {
      issues.push(`Test set is too small (${stats.test}). Need >= 100.`);
    }

    if (stats.avgQuality < 0.7) {
      recommendations.push(`Average quality is ${stats.avgQuality.toFixed(2)}. Consider filtering to >= 0.75.`);
    }

    if (Object.keys(stats.byOrigin).length < 5) {
      recommendations.push(`Only ${Object.keys(stats.byOrigin).length} origin types. Use the full 11-pipeline generator for diversity.`);
    }

    return {
      readyForFineTuning: issues.length === 0,
      issues,
      recommendations,
    };
  }

  // --------------------------------------------------------------------------
  //  Reports
  // --------------------------------------------------------------------------
  private renderReport(stats: DatasetStats, config: ExportConfig): string {
    return JSON.stringify({
      generatedAt: Date.now(),
      config,
      stats,
    }, null, 2);
  }

  private renderReadme(stats: DatasetStats): string {
    return [
      "# Project Eternal — Intent Training Dataset",
      "",
      `Total samples: ${stats.totalKept}`,
      `Train: ${stats.train}`,
      `Validation: ${stats.validation}`,
      `Test: ${stats.test}`,
      "",
      "## Splits",
      "",
      "- `train.jsonl` — training samples (input → output)",
      "- `validation.jsonl` — held-out validation samples",
      "- `test.jsonl` — held-out test samples",
      "",
      "## Format",
      "",
      "Each line is a JSON object with the structure:",
      "",
      "```",
      "{",
      "  \"input\": {",
      "    \"context\": { ... GameDesignContext ... },",
      "    \"promptText\": \"<full prompt>\",",
      "    \"userText\": \"<user message>\",",
      "    \"systemText\": \"<system + developer>\",",
      "    \"contextHash\": \"<hash>\"",
      "  },",
      "  \"output\": {",
      "    \"intent\": {",
      "      \"intent\": \"<short label>\",",
      "      \"reasoning\": \"<1-5 sentences>\",",
      "      \"expectedPlayerReaction\": \"<what player will do>\",",
      "      \"highLevelPlan\": \"<1-3 sentence abstract plan>\",",
      "      \"confidence\": <0..1>",
      "    },",
      "    \"targetText\": \"<canonical JSON>\",",
      "    \"intentCategory\": \"<category>\",",
      "    \"groundTruthConfidence\": <0..1>",
      "  }",
      "}",
      "```",
      "",
      "## Statistics",
      "",
      `- Average quality: ${stats.avgQuality.toFixed(3)}`,
      `- Average confidence: ${stats.avgConfidence.toFixed(3)}`,
      `- Average intent length: ${stats.avgIntentLength.toFixed(0)} chars`,
      `- Average reasoning length: ${stats.avgReasoningLength.toFixed(0)} chars`,
      `- Average plan length: ${stats.avgPlanLength.toFixed(0)} chars`,
      `- Unique contexts: ${stats.uniqueContexts}`,
      "",
      "## Origin distribution",
      "",
      ...Object.entries(stats.byOrigin).map(([k, v]) => `- ${k}: ${v}`),
      "",
      "## Grade distribution",
      "",
      ...Object.entries(stats.byGrade).map(([k, v]) => `- ${k}: ${v}`),
    ].join("\n");
  }
}

// --------------------------------------------------------------------------
//  Helpers
// --------------------------------------------------------------------------

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

function estimateTokens(samples: IntentTrainingSample[]): number {
  // Rough estimate: ~4 chars per token
  let chars = 0;
  for (const s of samples) {
    chars += s.input.promptText.length + s.output.targetText.length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Convert a sample to the flat (input, output) record the training
 * pipeline expects. Drops all metadata that isn't useful for the
 * supervised signal.
 */
function toTrainingRecord(s: IntentTrainingSample) {
  return {
    input: {
      context: s.input.context,
      promptText: s.input.promptText,
      userText: s.input.userText,
      systemText: s.input.systemText,
      contextHash: s.input.contextHash,
    },
    output: {
      intent: s.output.intent,
      targetText: s.output.targetText,
      intentCategory: s.output.intentCategory,
      groundTruthConfidence: s.output.groundTruthConfidence,
    },
    meta: {
      id: s.id,
      origin: s.origin,
      grade: s.grade,
      quality: s.quality,
      confidence: s.teacherConfidence,
      tags: s.tags,
      versions: s.versions,
    },
  };
}
