// ============================================================================
// ACTIVE LEARNING ENGINE — PUBLIC API
//
// Closes the learning loop:
//
//   Play -> Dataset -> Model makes decision -> Replay Evaluator
//     -> Confidence -> Disagreement Detector -> If uncertain
//     -> Send ONLY these cases to the teacher model -> Distill -> Retrain
//
// The student only asks the teacher for examples where it is uncertain
// or performs poorly. That means after the initial training, you don't
// need to regenerate 100,000 samples every time. You might only need a
// few hundred high-value examples per iteration.
//
// This module sits on top of the existing offline distillation pipeline:
//   - GameDesignSample from gamedesigner/GameDesignDatasetLogger
//   - ReplayEvaluator from gamedesigner/ReplayEvaluator
//   - OfflineDistillationPipeline from distillation/OfflineDistillationPipeline
//
// Reuses everything; no new sample types, no new schemas, no new quality
// dimensions.
// ============================================================================

// Orchestrator (the entry point)
export {
  ActiveLearningEngine,
  type ActiveLearningEngineDeps,
  type ActiveLearningRoundOptions,
  type ActiveLearningPhase,
} from "./ActiveLearningEngine";

// Signal scoring
export {
  DisagreementDetector,
  type DisagreementDetectorDeps,
} from "./DisagreementDetector";

// Selection strategies
export {
  UncertaintySampler,
} from "./UncertaintySampler";

// Shared types
export {
  DEFAULT_ACTIVE_LEARNING_CONFIG,
  DEFAULT_TEACHER_BUDGET,
  emptyReasonBreakdown,
  type ActiveLearningConfig,
  type ActiveLearningReport,
  type DisagreementReason,
  type SamplingStrategy,
  type ScoredSample,
  type TeacherBudget,
} from "./types";
