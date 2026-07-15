// ============================================================================
// TRAINING LAYER — PUBLIC API
//
// The final infrastructure layer. Produces high-quality, balanced,
// validated, deduplicated training bundles for future fine-tuning.
// Reuses every earlier layer — no duplicate sample types, no duplicate
// quality engines, no duplicate validators.
//
// Pipeline:
//   GameDesignDataset (gamedesigner/)
//     → NearDuplicateDetector (dedup)
//     → DatasetRanker (rank + tier)
//     → DatasetBalancer (rebalance across 11 dimensions)
//     → DatasetValidator (schema + enum gate)
//     → DatasetAnalyticsDashboard (stats + charts)
//     → BenchmarkBuilder (5 eval suites, held out)
//     → DatasetCurriculumBuilder (4 progressive levels)
//     → TrainingReadinessScorer (0..100 + recommendations)
//     → FineTuningPackageGenerator (the final JSONL bundle)
//
// This is the last module. No new AI systems are added beyond this point.
// ============================================================================

// Shared types and bucketing
export {
  type SampleBuckets,
  type SkillBucket,
  type Archetype,
  type CampaignStage,
  type AdaptationBucket,
  type RankedSample,
  type SampleTier,
  makeRng,
  skillBucket,
  archetypeOf,
  campaignStageOf,
  adaptationBucket,
  extractBuckets,
} from "./types";

// PHASE 2
export {
  NearDuplicateDetector,
  JaccardSetSimilarity,
  CosineSimilarityEngine,
  MinHashSketch,
  type DuplicateReport,
  type NearDuplicateDetectorOptions,
  type SimilarityEngine,
} from "./NearDuplicateDetector";

// PHASE 3
export {
  DatasetRanker,
  DEFAULT_RANKER_CONFIG,
  type RankerConfig,
  type RankerResult,
} from "./DatasetRanker";

// PHASE 4
export {
  DatasetBalancer,
  DEFAULT_BALANCE_CONFIG,
  stratifiedSample,
  type BalanceConfig,
  type BalanceDimension,
  type BalanceReport,
} from "./DatasetBalancer";

// PHASE 1 + 5
export {
  DatasetCurriculumBuilder,
  DEFAULT_CURRICULUM_CONFIG,
  levelLabel,
  levelDescription,
  type CurriculumConfig,
  type Curriculum,
  type CurriculumLevel,
} from "./DatasetCurriculumBuilder";

// PHASE 6
export {
  DatasetAnalyticsDashboard,
  type DatasetAnalyticsReport,
  type DistributionStat,
  type ChartSpec,
} from "./DatasetAnalyticsDashboard";

// PHASE 7
export {
  DatasetValidator,
  DEFAULT_VALIDATION_CONFIG,
  type ValidationConfig,
  type ValidationReport,
  type ValidationIssue,
} from "./DatasetValidator";

// PHASE 8
export {
  BenchmarkBuilder,
  DEFAULT_BENCHMARK_CONFIG,
  type BenchmarkConfig,
  type BenchmarkBundle,
  type BenchmarkSuite,
} from "./BenchmarkBuilder";

// PHASE 9
export {
  TrainingReadinessScorer,
  type ReadinessInputs,
  type ReadinessMetrics,
  type ReadinessReport,
  type TrainingCostEstimate,
} from "./TrainingReadinessScorer";

// PHASE 10
export {
  FineTuningPackageGenerator,
  DEFAULT_BUNDLE_CONFIG,
  type BundleConfig,
  type TrainingBundle,
} from "./FineTuningPackageGenerator";

// PHASE 11 — Active Learning Engine
// Closes the loop: play -> model -> replay -> confidence -> disagreement
// -> if uncertain -> teacher -> distill -> retrain. Reuses every layer
// above; no new sample types, no new schemas.
export {
  ActiveLearningEngine,
  DisagreementDetector,
  UncertaintySampler,
  DEFAULT_ACTIVE_LEARNING_CONFIG,
  DEFAULT_TEACHER_BUDGET,
  emptyReasonBreakdown,
  type ActiveLearningEngineDeps,
  type ActiveLearningRoundOptions,
  type ActiveLearningPhase,
  type ActiveLearningConfig,
  type ActiveLearningReport,
  type DisagreementReason,
  type DisagreementDetectorDeps,
  type SamplingStrategy,
  type ScoredSample,
  type TeacherBudget,
} from "../active";
