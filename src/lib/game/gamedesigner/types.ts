// ============================================================================
// PHASE 1: GAME DESIGN CONTEXT TYPES
//
// Extends the existing AIContext with high-level design-time information:
// Player Profile, Prediction Profile, Campaign History, World History,
// Previous Director Plans, Genome Library, Narrative State, Emotional Curve,
// Boss Memory, Current Difficulty, and Arena State.
// ============================================================================

import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { PlayerEstimate } from "../prediction/PlayerAnalyzer";
import type { PlayerPrediction } from "../prediction/PredictionEngine";
import type { DerivedWorldState } from "../eventsourcing/WorldHistory";
import type { CampaignPlan, CampaignChapter } from "../campaign/CampaignPlanner";
import type { EmotionalCurve, EmotionalBeat } from "../campaign/EmotionalCurve";
import type { StoryEvent } from "../narrative/NarrativeEngine";
import type { BossMemory } from "../world/WorldState";
import type { DirectorPlanV3 } from "../director/DirectorEngineV3";
import type { IGenome } from "../evolution/types";

/**
 * Genome Library entry — one per evolved style. Mirrors the structure
 * exposed by src/lib/game/evolution/GenomeLibrary.ts without depending
 * on the runtime evolution pipeline.
 */
export interface GenomeLibraryEntry {
  style: string;            // "aggressive" | "counter" | "patient" | ...
  id: string;               // genome id
  fitness: number;          // 0..1
  narrative: string;        // short description from NarrativeTraitEngine
  generation: number;
}

export interface GenomeLibrarySnapshot {
  version: string;
  baseOpponent: string;
  entries: GenomeLibraryEntry[];
}

/**
 * Campaign History — what the player has experienced so far.
 */
export interface CampaignHistoryEntry {
  chapterIndex: number;
  opponentName: string;
  emotion: string;
  bossStyle: string;
  difficulty: string;
  playerWon: boolean;
  damageRatio: number;      // dealt / (dealt + taken)
  timestamp: number;
}

export interface CampaignHistory {
  entries: CampaignHistoryEntry[];
  currentChapterIndex: number;
  totalChapters: number;
  completedChapters: number;
  winRate: number;          // 0..1 over completed
  averageDamageRatio: number;
}

/**
 * Previous Director Plans — the last N plans used by the Director.
 * Lets the LLM see the trajectory and avoid repetition.
 */
export interface PreviousDirectorPlanSummary {
  chapterIndex: number;
  intent: string;
  weather: string;
  bossStyle: string;
  difficulty: string;
  emotion: string;
  playerWon: boolean | null;
  timestamp: number;
}

export interface PreviousDirectorPlans {
  recent: PreviousDirectorPlanSummary[];
  totalStored: number;
}

/**
 * Arena state — current physical context.
 */
export interface ArenaState {
  arenaId: string;
  stage: number;            // 0..5
  damageLevel: number;      // 0..1
  visibleCracks: number;
  activeHazardTypes: string[];
}

/**
 * Current Difficulty snapshot.
 */
export interface CurrentDifficulty {
  id: string;               // "easy" | "normal" | "hard" | ...
  aggressionMul: number;
  reactionMul: number;
  damageMul: number;
  aiAdaptive: number;       // 0..1
  aiPerfection: number;     // 0..1
}

/**
 * Emotional Curve snapshot — where we are in the arc.
 */
export interface EmotionalCurveSnapshot {
  arcId: number;            // index into EMOTIONAL_ARCS
  currentBeat: number;
  totalBeats: number;
  currentEmotion: string;
  currentIntensity: number; // 0..1
  upcomingBeats: EmotionalBeat[];   // next 3
  previousBeats: EmotionalBeat[];   // last 3
  trajectory: "rising" | "falling" | "steady" | "peaking";
}

/**
 * The full Game Design Context — what the LLM sees.
 * This is the input to the Game Designer.
 */
export interface GameDesignContext {
  version: number;

  // Player
  playerProfile: PlayerProfile;
  playerEstimate: PlayerEstimate;

  // Prediction
  playerPrediction: PlayerPrediction;

  // Campaign
  campaignPlan: CampaignPlan;
  currentChapter: CampaignChapter | null;
  campaignHistory: CampaignHistory;

  // World
  worldState: DerivedWorldState;

  // Previous Director Plans
  previousDirectorPlans: PreviousDirectorPlans;

  // Genome Library
  genomeLibrary: GenomeLibrarySnapshot;

  // Narrative
  narrativeState: StoryEvent | null;

  // Emotional arc
  emotionalCurve: EmotionalCurveSnapshot;

  // Boss memory
  bossMemory: BossMemory | null;

  // Current difficulty
  currentDifficulty: CurrentDifficulty;

  // Arena
  arenaState: ArenaState;

  // Compressed topline view (the model sees both, but the topline is what
  // it should reason about — the rest is supporting evidence).
  topline: GameDesignTopline;
}

export interface GameDesignTopline {
  recentWinStreak: number;
  recentLossStreak: number;
  dominantStrategy: string;       // "rushdown" | "turtle" | "whiff_punish" | ...
  biggestWeakness: string;        // what to exploit
  strongestTrait: string;         // what to counter
  currentMood: string;            // "overconfident" | "frustrated" | "engaged" | "bored" | ...
  worldTrajectory: "darkening" | "brightening" | "stable";
  narrativePhase: "opening" | "rising" | "climax" | "falling" | "resolution";
  recommendedPosture: "challenge" | "teach" | "reward" | "punish" | "rest";
}

export function createEmptyGenomeLibrarySnapshot(): GenomeLibrarySnapshot {
  return {
    version: "0.0.0",
    baseOpponent: "unknown",
    entries: [],
  };
}

export function createEmptyArenaState(arenaId: string): ArenaState {
  return {
    arenaId,
    stage: 0,
    damageLevel: 0,
    visibleCracks: 0,
    activeHazardTypes: [],
  };
}

export function createEmptyCampaignHistory(): CampaignHistory {
  return {
    entries: [],
    currentChapterIndex: 0,
    totalChapters: 0,
    completedChapters: 0,
    winRate: 0,
    averageDamageRatio: 0,
  };
}

export function createEmptyPreviousDirectorPlans(): PreviousDirectorPlans {
  return {
    recent: [],
    totalStored: 0,
  };
}
