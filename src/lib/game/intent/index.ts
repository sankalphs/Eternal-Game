// ============================================================================
// PROJECT ETERNAL — INTENT LAYER
//
// The new high-level design layer. The LLM no longer outputs low-level
// gameplay values (weather, camera, music, hazards, etc.). It outputs
// ONLY:
//
//   { intent, reasoning, expectedPlayerReaction, highLevelPlan, confidence }
//
// The deterministic IntentTranslator (IntentTranslator.ts) converts
// this into DirectorPlanV3 overrides. The Director (V3) applies the
// overrides and produces the final plan. The combat engine, physics,
// and rendering remain untouched.
//
// This module is the source of truth for the new training target.
// ============================================================================

export {
  INTENT_OUTPUT_SCHEMA,
  INTENT_CATEGORIES,
  categoriseIntent,
  type IntentOutput,
  type IntentCategory,
} from "./IntentSchema";

export {
  IntentTranslator,
  type IntentTranslatorInput,
  type IntentTranslation,
} from "./IntentTranslator";

export {
  validateIntentOutput,
  type IntentValidationResult,
  type RawIntentOutput,
} from "./IntentOutputValidator";

export {
  IntentContextBuilder,
  type IntentContext,
  type IntentContextBundle,
  type IntentTopLevelSummary,
} from "./IntentContextBuilder";

// Training data
export {
  type IntentTrainingInput,
  type IntentTrainingOutput,
  type IntentTrainingSample,
  type SampleOrigin,
  type SampleGrade,
  IntentTrainingSampleBuilder,
} from "./IntentTrainingSample";

export {
  IntentQualityEngine,
  type IntentQuality,
  type IntentQualityScore,
  type IntentQualityConfig,
  DEFAULT_INTENT_QUALITY_CONFIG,
} from "./IntentQualityEngine";

export {
  MassiveDatasetGenerator,
  DEFAULT_DATASET_CONFIG,
  type DatasetGenerationConfig,
  type DatasetGenerationReport,
} from "./MassiveDatasetGenerator";

export {
  MassiveDatasetExporter,
  DEFAULT_EXPORT_CONFIG,
  type ExportConfig,
  type ExportedDataset,
  type DatasetStats,
} from "./MassiveDatasetExporter";

export {
  DatasetBuildOrchestrator,
  type BuildOrchestratorConfig,
  type BuildOrchestratorResult,
} from "./DatasetBuildOrchestrator";

// Versioning
export {
  VersionManifestBuilder,
  serializeManifest,
  deserializeManifest,
  uuid4,
  type VersionManifest,
  type DatasetVersion,
  type GenomeVersion,
  type TeacherVersion,
  type PromptVersion,
  type ModelVersion,
  type TrainingConfigVersion,
  type DistillationVersion,
  type ExperimentVersion,
} from "./VersionManifest";
