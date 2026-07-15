// ============================================================================
// OFFLINE DISTILLATION — PUBLIC API
//
// Best-of-N distillation for the GameDesignDataset. Generates N candidate
// plans per context using the existing GameDesigner, scores each with
// the existing GameDesignQualityEngine, head-to-head tie-breaks with
// the existing ReplayEvaluator, and stores only the winner.
//
// Reuses:
//   - GameDesigner, GameDesignQualityEngine, ReplayEvaluator,
//     ExplanationEngine, PromptLibrary, GameDesignOutputValidator
//     from src/lib/game/gamedesigner
//   - GameDesignSample from src/lib/game/gamedesigner/GameDesignDatasetLogger
//
// No new sample types. No new quality dimensions. No new schemas.
// ============================================================================

export {
  OfflineDistillationPipeline,
} from "./OfflineDistillationPipeline";

export {
  CandidateGenerator,
  type CandidateGeneratorDeps,
} from "./CandidateGenerator";

export {
  DEFAULT_DISTILLATION_CONFIG,
  type DistillationConfig,
  type DistillationReport,
  type DistilledSample,
  type DistillationProvenance,
  type DistillationProgress,
  type DistillationStrategyId,
  type CandidatePlan,
  type CandidateGenerationParams,
} from "./types";
