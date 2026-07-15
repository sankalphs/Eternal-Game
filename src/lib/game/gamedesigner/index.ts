// ============================================================================
// GAME DESIGNER LAYER — PUBLIC API
//
// New layer for Project Eternal. The LLM Game Designer sits above the
// existing AI middleware. It produces high-level design intent, not
// gameplay values. The Director (V4) translates the intent into a
// DirectorPlanV3. The combat engine is untouched.
//
// Pipeline:
//   Player
//     → Telemetry
//     → PlayerAnalyzer
//     → PredictionEngine
//     → CampaignPlanner
//     → WorldHistory
//     → GenomeLibrary
//     → [LLM Game Designer]   ← THIS LAYER
//     → Director (V4)
//     → Combat Engine
//
// This module does NOT modify the engine, renderer, or any combat code.
// ============================================================================

// Types & schema
export type {
  GameDesignContext,
  GameDesignTopline,
  GenomeLibrarySnapshot,
  GenomeLibraryEntry,
  CampaignHistory,
  CampaignHistoryEntry,
  PreviousDirectorPlans,
  PreviousDirectorPlanSummary,
  ArenaState,
  CurrentDifficulty,
  EmotionalCurveSnapshot,
} from "./types";
export {
  createEmptyGenomeLibrarySnapshot,
  createEmptyArenaState,
  createEmptyCampaignHistory,
  createEmptyPreviousDirectorPlans,
} from "./types";

// Plan & response
export {
  ALLOWED_DESIGN_VALUES,
  GAME_DESIGN_OUTPUT_SCHEMA,
  type GameDesignPlan,
  type GameDesignResponse,
  type CameraStyle,
  type MusicStyle,
  type LightingStyle,
  type CrowdStyle,
} from "./GameDesignPlan";

// Output validation
export {
  GameDesignOutputValidator,
  type ValidationResult,
  type RawDesignOutput,
} from "./GameDesignOutputValidator";

// Context builder
export {
  GameDesignContextBuilder,
  type BuildContextParams,
} from "./GameDesignContextBuilder";

// Prompt versioning
export {
  PromptLibrary,
  PromptVersionTracker,
  type PromptVersion,
  type BuiltPrompt,
} from "./PromptLibrary";

// Explanation engine
export { ExplanationEngine, type ExplanationResult } from "./ExplanationEngine";

// Quality engine
export {
  GameDesignQualityEngine,
  type GameDesignQualityScore,
  type GameDesignQuality,
} from "./GameDesignQualityEngine";

// Dataset logger
export {
  GameDesignDatasetLogger,
  type GameDesignSample,
  type GameDesignActualResult,
} from "./GameDesignDatasetLogger";

// Replay / offline evaluation
export {
  ReplayEvaluator,
  type ReplayResult,
  type ReplayReport,
  type PlanComparison,
} from "./ReplayEvaluator";

// Training readiness
export {
  TrainingReadinessExporter,
  type TrainingSplit,
  type ExportOptions,
  type ExportBundle,
  type DatasetStats,
} from "./TrainingReadinessExporter";

// Model adapters
export {
  GemmaAdapter,
  QwenAdapter,
  PhiAdapter,
  LlamaAdapter,
  MistralAdapter,
  TinyLlamaAdapter,
  ONNXAdapterStub,
  GGUFAdapterStub,
  RemoteAPIAdapter,
  DeterministicMockAdapter,
  DeterministicIntentMockAdapter,
  MockPlanGenerator,
  createModelAdapter,
  type GameDesignerModelId,
} from "./ModelAdapters";

// Designer
export {
  GameDesigner,
  type GameDesignerDeps,
  type DesignResult,
} from "./GameDesigner";

// NEW — Intent-only Game Designer (Project Eternal research target)
export {
  IntentGameDesigner,
  type IntentGameDesignerDeps,
  type IntentDesignResult,
} from "./IntentGameDesigner";

// Intent layer (translates intent → DirectorPlanV3)
export {
  INTENT_OUTPUT_SCHEMA,
  INTENT_CATEGORIES,
  categoriseIntent,
  type IntentOutput,
  type IntentCategory,
} from "../intent/IntentSchema";
export {
  IntentTranslator,
  type IntentTranslatorInput,
  type IntentTranslation,
} from "../intent/IntentTranslator";
export {
  validateIntentOutput,
  type IntentValidationResult,
  type RawIntentOutput,
} from "../intent/IntentOutputValidator";
export {
  IntentContextBuilder,
  type IntentContext,
  type IntentContextBundle,
  type IntentTopLevelSummary,
} from "../intent/IntentContextBuilder";

// Pipeline (top-level)
export { GameDesignerPipeline } from "./GameDesignerPipeline";

// Director V4 integration (the new director that asks the GameDesigner)
export {
  DirectorEngineV4,
  type DirectorV4Deps,
  type DirectorPlanV4,
} from "../director/DirectorEngineV4";

// Director V5 integration (intent-only — Project Eternal research target)
export {
  DirectorEngineV5,
  type DirectorV5Deps,
  type DirectorPlanV5,
} from "../director/DirectorEngineV5";
