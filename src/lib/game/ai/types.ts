// ============================================================================
// AI INFRASTRUCTURE — SHARED TYPES
//
// All types used across the AI pipeline. The combat engine imports NONE
// of these. Only the AI layer and the debug panel use them.
// ============================================================================

import type { PlayerProfile } from "../profiler/PlayerProfiler";
import type { PlayerEstimate } from "../prediction/PlayerAnalyzer";
import type { PlayerPrediction } from "../prediction/PredictionEngine";
import type { DerivedWorldState } from "../eventsourcing/WorldHistory";

// ---- Phase 1: Encoded Features ----
export interface EncodedFeatures {
  version: number;
  // Player behaviour (all 0..1 unless noted)
  aggression: number;
  risk: number;
  defense: number;
  spacing: number;          // 0=close, 1=mid, 2=far
  reaction: number;         // 0=slow, 1=fast
  jumpRate: number;
  rollRate: number;
  comboDepth: number;
  superTiming: number;      // 0=early, 1=late/save
  cornerPressure: number;
  // Player psychology (from PlayerEstimate)
  skill: number;
  confidence: number;
  patience: number;
  adaptability: number;
  curiosity: number;
  emotionalStability: number;
  frustrationTolerance: number;
  // Match context
  matchesPlayed: number;
  winRate: number;
}

// ---- Phase 2: Structured Context ----
export interface AIContext {
  version: number;
  features: EncodedFeatures;
  prediction: Record<string, number>;  // key predictions (flat map)
  worldState: {
    fear: number;
    darkness: number;
    corruption: number;
    hope: number;
    heroesDefeated: number;
    heroesSpared: number;
    bloodMoon: boolean;
  };
  campaign: {
    chapterIndex: number;
    totalChapters: number;
    currentEmotion: string;
    narrativePurpose: string;
  };
  bossMemory: {
    encounters: number;
    playerWins: number;
    favouriteAttack: string | null;
    lastResult: string | null;
  } | null;
  objective: string;
}

// ---- Phase 3: Prompt ----
export interface PromptSet {
  system: string;
  developer: string;
  user: string;
  outputSchema: string;      // JSON schema description for the model
  fewShot: { input: string; output: string }[];
}

// ---- Phase 4: Inference ----
export interface InferenceRequest {
  prompt: PromptSet;
  maxTokens: number;
  temperature: number;
  requestId: string;
}

export interface InferenceResult {
  text: string;
  latencyMs: number;
  modelId: string;
  fromCache: boolean;
  requestId: string;
}

// ---- Phase 5/6: Parsed + Validated Output ----
export interface AIDirectorOutput {
  weather: string;
  lighting: string;
  camera: string;
  music: string;
  crowd: string;
  hazards: string[];
  bossStyle: string;
  bossEmotion: string;
  dialogueStyle: string;
  difficulty: string;
  arenaStage: number;
  narrative: string;
  intent: string;
}

// ---- Phase 7: Confidence ----
export interface ConfidenceScored<T> {
  value: T;
  confidence: number;  // 0..1
}

export interface ConfidenceScoredOutput {
  weather: ConfidenceScored<string>;
  bossStyle: ConfidenceScored<string>;
  difficulty: ConfidenceScored<string>;
  hazards: ConfidenceScored<string[]>;
  intent: ConfidenceScored<string>;
  overall: number;  // weighted average
  fellback: boolean; // true if any field used fallback
}

// ---- Phase 8: Feedback ----
export interface FeedbackEntry {
  requestId: string;
  timestamp: number;
  prediction: Record<string, number>;
  actualBehaviour: Record<string, number>;
  predictionAccuracy: number;  // 0..1
  directorPlanUsed: boolean;   // was the AI plan used or fallback?
  playerWon: boolean;
  modelId: string;
  latencyMs: number;
}

// ---- Phase 9: Dataset Sample ----
export interface DatasetSample {
  id: string;
  timestamp: number;
  context: AIContext;
  prompt: PromptSet;
  modelOutput: string;
  parsedOutput: AIDirectorOutput | null;
  validated: boolean;
  confidence: number;
  fellback: boolean;
  actualResult: {
    playerWon: boolean;
    roundsToWin: number;
    damageDealt: number;
    damageTaken: number;
  };
  modelId: string;
}

// ---- Phase 10: Model Interface ----
export interface AIModelMetadata {
  id: string;
  label: string;
  type: "local" | "remote" | "mock";
  maxTokens: number;
  contextWindow: number;
  supportsJSON: boolean;
  version: string;
}

export interface AIModel {
  load(): Promise<void>;
  infer(request: InferenceRequest): Promise<InferenceResult>;
  unload(): Promise<void>;
  health(): Promise<boolean>;
  metadata(): AIModelMetadata;
}
