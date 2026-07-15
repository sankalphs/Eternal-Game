// ============================================================================
// AI INFRASTRUCTURE INDEX — single import point.
//
// The game engine imports NOTHING from here. Only the component layer
// (which runs between matches) and the debug panel use these exports.
// ============================================================================

// Pipeline (the orchestrator)
export { AIPipeline, type PipelineResult } from "./AIPipeline";

// Individual modules (for testing / custom pipelines)
export { FeatureEncoder } from "./FeatureEncoder";
export { ContextBuilder } from "./ContextBuilder";
export { PromptBuilder, DEFAULT_TEMPLATE, type PromptTemplate } from "./PromptBuilder";
export { InferenceManager, type InferenceManagerConfig } from "./InferenceManager";
export { ResponseParser } from "./ResponseParser";
export { SchemaValidator, type ValidationResult } from "./SchemaValidator";
export { ConfidenceEngine, DEFAULT_CONFIDENCE_CONFIG, type ConfidenceConfig } from "./ConfidenceEngine";
export { FeedbackCollector, type FeedbackMetrics } from "./FeedbackCollector";
export { DatasetLogger } from "./DatasetLogger";

// Model adapters
export { MockAdapter, OllamaAdapter, RemoteAPIAdapter } from "./models/Adapters";

// Shared types
export type {
  AIModel, AIModelMetadata,
  EncodedFeatures, AIContext, PromptSet,
  InferenceRequest, InferenceResult,
  AIDirectorOutput, ConfidenceScored, ConfidenceScoredOutput,
  FeedbackEntry, DatasetSample,
} from "./types";

// ---- Research-grade extensions ----

// Phase 1/2: Memory Retrieval
export {
  MemoryIndex,
  DeterministicRetriever,
  EmbeddingRetriever,
  HybridRetriever,
} from "./MemoryRetriever";
export type {
  MemoryRecord,
  RetrievedMemory,
  MemoryQuery,
  MemoryRetriever as IMemoryRetriever,
} from "./research-types";

// Phase 3: Prompt Strategy
export {
  TinyModelStrategy,
  MediumModelStrategy,
  LargeModelStrategy,
  FastInferenceStrategy,
  CompressedStrategy,
  selectStrategy,
  type PromptStrategy,
} from "./PromptStrategy";

// Phase 4: Batch Scheduler
export { BatchScheduler, type BatchStats } from "./BatchScheduler";

// Phase 5: Dataset Quality
export { DatasetQualityEngine } from "./DatasetQualityEngine";
export type { DatasetQualityScore, DatasetQuality } from "./research-types";

// Phase 6: Evaluation
export { AIEvaluator, type EvaluationInput } from "./AIEvaluator";
export type { CampaignEvaluation } from "./research-types";

// Phase 7: Experiment
export { ExperimentManager } from "./ExperimentManager";
export type { Experiment, ExperimentVariant, ExperimentResult } from "./research-types";
