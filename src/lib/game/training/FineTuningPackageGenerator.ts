// ============================================================================
// PHASE 10: FINE-TUNING PACKAGE GENERATOR
//
// One command: generateTrainingBundle(samples)
//
// Produces:
//   - train.jsonl
//   - validation.jsonl
//   - test.jsonl
//   - benchmark_easy.jsonl
//   - benchmark_medium.jsonl
//   - benchmark_hard.jsonl
//   - benchmark_generalization.jsonl
//   - benchmark_rare.jsonl
//   - curriculum_level_1..4.jsonl
//   - metadata.json
//   - training_report.json
//   - readiness_report.json
//   - dataset_statistics.json
//
// No inference. No fine-tuning. No model code. Only data.
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import type { GameDesignDatasetLogger } from "../gamedesigner/GameDesignDatasetLogger";
import { DatasetCurriculumBuilder, type Curriculum, DEFAULT_CURRICULUM_CONFIG } from "./DatasetCurriculumBuilder";
import { DatasetRanker, DEFAULT_RANKER_CONFIG } from "./DatasetRanker";
import { DatasetBalancer, DEFAULT_BALANCE_CONFIG } from "./DatasetBalancer";
import { NearDuplicateDetector } from "./NearDuplicateDetector";
import { DatasetAnalyticsDashboard } from "./DatasetAnalyticsDashboard";
import { DatasetValidator, DEFAULT_VALIDATION_CONFIG } from "./DatasetValidator";
import { BenchmarkBuilder, DEFAULT_BENCHMARK_CONFIG, type BenchmarkBundle } from "./BenchmarkBuilder";
import { TrainingReadinessScorer, type ReadinessReport } from "./TrainingReadinessScorer";
import { makeRng } from "./types";

export interface BundleConfig {
  // Random seed
  seed: number;
  // Train/val/test ratios
  ratios: { train: number; validation: number; test: number };
  // Whether to use the existing TrainingReadinessExporter to also produce
  // a parallel v1 split (for backward compatibility with earlier consumers).
  emitLegacySplit: boolean;
  // Benchmark config
  benchmark: Partial<typeof DEFAULT_BENCHMARK_CONFIG>;
  // Curriculum config
  curriculum: Partial<typeof DEFAULT_CURRICULUM_CONFIG>;
  // Ranker / balancer / validator configs
  ranker: Partial<typeof DEFAULT_RANKER_CONFIG>;
  balancer: Partial<typeof DEFAULT_BALANCE_CONFIG>;
  validator: Partial<typeof DEFAULT_VALIDATION_CONFIG>;
  // Recommended epochs (for cost estimate)
  recommendedEpochs: number;
}

export const DEFAULT_BUNDLE_CONFIG: BundleConfig = {
  seed: 1337,
  ratios: { train: 0.8, validation: 0.1, test: 0.1 },
  emitLegacySplit: false,
  benchmark: {},
  curriculum: {},
  ranker: {},
  balancer: {},
  validator: {},
  recommendedEpochs: 3,
};

export interface TrainingBundle {
  generatedAt: number;
  // The raw files
  files: {
    trainJsonl: string;
    validationJsonl: string;
    testJsonl: string;
    benchmark: {
      easy: string;
      medium: string;
      hard: string;
      generalization: string;
      rare: string;
    };
    curriculum: {
      level1: string;
      level2: string;
      level3: string;
      level4: string;
    };
    metadataJson: string;
    trainingReportJson: string;
    readinessReportJson: string;
    datasetStatisticsJson: string;
  };
  // The structured reports
  curriculum: Curriculum;
  benchmark: BenchmarkBundle;
  validation: ReturnType<DatasetValidator["validateSamples"]>;
  readiness: ReadinessReport;
  config: BundleConfig;
}

export class FineTuningPackageGenerator {
  private config: BundleConfig;
  private curriculumBuilder: DatasetCurriculumBuilder;
  private benchmarkBuilder: BenchmarkBuilder;
  private validator = new DatasetValidator();
  private scorer = new TrainingReadinessScorer();
  private dashboard = new DatasetAnalyticsDashboard();
  private dedup = new NearDuplicateDetector();
  private ranker = new DatasetRanker();
  private balancer = new DatasetBalancer();

  constructor(config: Partial<BundleConfig> = {}) {
    this.config = { ...DEFAULT_BUNDLE_CONFIG, ...config };
    this.curriculumBuilder = new DatasetCurriculumBuilder(this.config.curriculum);
    this.benchmarkBuilder = new BenchmarkBuilder(this.config.benchmark);
  }

  /**
   * Construct the bundle. The bundle is pure data — strings of JSONL
   * and JSON. The caller can write them to disk or upload them to a
   * fine-tuning service.
   *
   * Accepts either a raw array of samples, or a GameDesignDatasetLogger
   * (which is reused for stats / export).
   */
  generate(input: GameDesignSample[] | GameDesignDatasetLogger): TrainingBundle {
    const samples = Array.isArray(input) ? input : input.getSamples();
    const seed = this.config.seed;

    // ---- 1. Curriculum (dedup + rank + balance + partition) ----
    const curriculum = this.curriculumBuilder.build(samples, seed);

    // ---- 2. Benchmark (uses the full set, reserves ids) ----
    const benchmark = this.benchmarkBuilder.build(samples);

    // ---- 3. Train / val / test split on the curriculum-pool samples
    //         EXCLUDING benchmark-reserved ids ----
    const reserved = benchmark.reservedIds;
    const trainingPool = curriculum.rankerResult.ranked
      .filter(r => !reserved.has(r.sample.id))
      .filter(r => r.tier === "gold" || r.tier === "silver")
      .map(r => r.sample);

    const { train, validation, test } = this.split(trainingPool, this.config.ratios, seed);
    const trainJsonl = train.map(s => JSON.stringify(toTrainingPair(s))).join("\n");
    const validationJsonl = validation.map(s => JSON.stringify(toTrainingPair(s))).join("\n");
    const testJsonl = test.map(s => JSON.stringify(toTrainingPair(s))).join("\n");

    // ---- 4. Validation report (on the union of splits) ----
    const validationReport = this.validator.validateSamples([...train, ...validation, ...test]);

    // ---- 5. Analytics dashboard ----
    const analytics = this.dashboard.build(samples, {
      uniqueSamples: trainingPool,
      nearDuplicates: curriculum.duplicateReport.nearDuplicates,
    });

    // ---- 6. Readiness score ----
    const readiness = this.scorer.score({
      samples,
      curriculum,
      benchmark,
      validation: validationReport,
      balanceReport: curriculum.balanceReport,
      duplicateReport: curriculum.duplicateReport,
      recommendedEpochs: this.config.recommendedEpochs,
    });

    // ---- 7. Curriculum JSONL files ----
    const level1 = curriculum.levels[0]?.jsonl ?? "";
    const level2 = curriculum.levels[1]?.jsonl ?? "";
    const level3 = curriculum.levels[2]?.jsonl ?? "";
    const level4 = curriculum.levels[3]?.jsonl ?? "";

    // ---- 8. Metadata ----
    const metadata = {
      generatedAt: Date.now(),
      generatorVersion: "1.0.0",
      config: this.config,
      inputSampleCount: samples.length,
      keptSampleCount: curriculum.totalKeptSamples,
      trainingSampleCount: trainingPool.length,
      benchmarkSampleCount: benchmark.holdoutSize,
      reservedBenchmarkIds: benchmark.reservedIds.size,
      promptVersions: [...new Set(samples.map(s => s.promptVersion))],
      modelIds: [...new Set(samples.map(s => s.modelId))],
    };

    const trainingReport = {
      generatedAt: Date.now(),
      curriculum,
      benchmark: {
        generatedAt: benchmark.generatedAt,
        holdoutSize: benchmark.holdoutSize,
        suites: benchmark.suites.map(s => ({
          id: s.id, label: s.label, sampleCount: s.sampleCount, selectionCriteria: s.selectionCriteria,
        })),
      },
      validation: validationReport,
      analytics: {
        totals: analytics.totals,
        metrics: analytics.metrics,
      },
    };

    return {
      generatedAt: Date.now(),
      files: {
        trainJsonl,
        validationJsonl,
        testJsonl,
        benchmark: {
          easy: benchmark.suites[0].jsonl,
          medium: benchmark.suites[1].jsonl,
          hard: benchmark.suites[2].jsonl,
          generalization: benchmark.suites[3].jsonl,
          rare: benchmark.suites[4].jsonl,
        },
        curriculum: {
          level1, level2, level3, level4,
        },
        metadataJson: JSON.stringify(metadata, null, 2),
        trainingReportJson: JSON.stringify(trainingReport, null, 2),
        readinessReportJson: readiness.jsonReport,
        datasetStatisticsJson: analytics.jsonReport,
      },
      curriculum,
      benchmark,
      validation: validationReport,
      readiness,
      config: this.config,
    };
  }

  /**
   * Deterministic stratified split. Each bucket (emotion × difficulty)
   * contributes proportionally to the train/val/test ratios.
   */
  private split(samples: GameDesignSample[], ratios: { train: number; validation: number; test: number }, seed: number) {
    const rng = makeRng(seed);
    const buckets = new Map<string, GameDesignSample[]>();
    for (const s of samples) {
      const k = `${s.plan.targetEmotion}|${s.plan.targetDifficulty}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(s);
    }
    const train: GameDesignSample[] = [];
    const validation: GameDesignSample[] = [];
    const test: GameDesignSample[] = [];
    for (const arr of buckets.values()) {
      // Shuffle deterministically
      const copy = arr.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      const t = Math.floor(copy.length * ratios.train);
      const v = t + Math.floor(copy.length * ratios.validation);
      train.push(...copy.slice(0, t));
      validation.push(...copy.slice(t, v));
      test.push(...copy.slice(v));
    }
    return { train, validation, test };
  }
}

// ---- Pure helpers ----
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
