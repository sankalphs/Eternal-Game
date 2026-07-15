// ============================================================================
// Director system index — V3 campaign-first pipeline.
//
// Full pipeline: Player → Telemetry → PlayerAnalyzer → PredictionEngine →
//   CampaignPlanner → NarrativeEngine → DirectorV3 → GameEngine
//
// The combat engine imports NOTHING from here. This module is completely
// independent of physics, renderer, combat FSM, animation, and audio.
// ============================================================================
export { DirectorEngineV3, type DirectorPlanV3, type DirectorIntent, type DirectorV3Deps } from "./DirectorEngineV3";
export { DirectorEngineV2, type DirectorPlanV2 } from "./DirectorEngineV2";
export { DirectorEngine, type DirectorPlan } from "./DirectorEngine";

// Prediction
export {
  PlayerAnalyzer,
  createInitialEstimate,
  type PlayerEstimate,
} from "../prediction/PlayerAnalyzer";
export { PredictionEngine, type PlayerPrediction } from "../prediction/PredictionEngine";

// Campaign
export {
  CampaignPlanner,
  type CampaignPlan,
  type CampaignChapter,
  type CuriosityExperiment,
  type CampaignPlannerDeps,
} from "../campaign/CampaignPlanner";
export {
  selectEmotionalArc,
  getCurrentEmotion,
  advanceEmotion,
  EMOTIONAL_ARCS,
  EMOTION_PROFILES,
  type EmotionalCurve,
  type EmotionalBeat,
  type Emotion,
  type EmotionProfile,
} from "../campaign/EmotionalCurve";

// Event sourcing
export { WorldHistory, type WorldEvent, type DerivedWorldState } from "../eventsourcing/WorldHistory";

// Psychology (kept from V2 — still useful as secondary analysis)
export { PsychologyEngine, type PsychologyProfile, type ArchetypeScore } from "../psychology/PsychologyEngine";

// Narrative
export { NarrativeEngine, type StoryEvent } from "../narrative/NarrativeEngine";

// World (legacy WorldState — kept for boss memories)
export {
  createInitialWorldState,
  updateBossMemory,
  type BossMemory,
} from "../world/WorldState";
export { getArenaStage, getArenaEvolution, type ArenaStage } from "../world/ArenaEvolution";

// Profiler
export { TelemetryCollector, emptyProfile, type PlayerProfile } from "../profiler/PlayerProfiler";

// Persistence
export { persistence, type PersistedState } from "../persistence/Persistence";
