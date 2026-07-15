// ============================================================================
// PHASE 2: GAME DESIGN OUTPUT SCHEMA
//
// The GameDesigner never produces gameplay actions. It produces HIGH-LEVEL
// DESIGN INTENT. The Director converts intent → concrete DirectorPlanV3.
//
// The model outputs a GameDesignPlan that the Director then validates,
// normalises, and translates into weather, lighting, music, camera, hazards,
// boss style, difficulty, narrative event, and any curiosity experiment.
// ============================================================================

import type { WeatherId } from "../content/weather";
import type { BossStyleId } from "../content/boss_styles";
import type { DifficultyId } from "../content/difficulties";
import type { Emotion } from "../campaign/EmotionalCurve";

/**
 * The LLM is allowed to recommend abstract sensory profiles, not raw
 * modifier parameters. The Director translates them.
 */
export type CameraStyle =
  | "wide" | "close" | "cinematic" | "handheld"
  | "dynamic_zoom" | "boss_focus" | "dutch_angle" | "slow_zoom";

export type MusicStyle =
  | "peaceful" | "epic" | "dark" | "hopeless" | "victory"
  | "ancient" | "percussion" | "choir" | "silence";

export type LightingStyle =
  | "bright" | "normal" | "dim" | "dark" | "blood" | "foggy" | "eclipse";

export type CrowdStyle =
  | "cheering" | "silent" | "praying" | "running"
  | "burning_city" | "monks" | "ruined_kingdom";

/**
 * The high-level design plan output by the Game Designer.
 * Strictly design intent. No gameplay values.
 */
export interface GameDesignPlan {
  // The intent — a short label for what this fight is FOR
  intent: string;

  // Reasoning — a few sentences the model wrote to explain its choices.
  // Not gameplay values, only the WHY.
  reasoning: string;

  // Target emotional arc
  targetEmotion: Emotion;
  targetIntensity: number;        // 0..1
  targetDifficulty: DifficultyId;

  // Target learning goal — what the player should get better at, or what
  // habit they should break.
  targetLearningGoal: string;

  // Recommended genome (style id) — the evolved behaviour to apply
  recommendedGenome: BossStyleId;

  // Recommended sensory profile
  recommendedWeather: WeatherId;
  recommendedLighting: LightingStyle;
  recommendedMusic: MusicStyle;
  recommendedCamera: CameraStyle;
  recommendedCrowd: CrowdStyle;

  // Recommended hazards — symbolic, the Director will translate to modifiers
  recommendedHazards: string[];   // e.g. ["fog", "fire_rain"]

  // Recommended narrative event — the LLM picks a thematic trigger
  recommendedNarrativeEvent: string;  // e.g. "VillageBurned", "TempleCollapsed"

  // Recommended experiment — optional curiosity tweak
  recommendedExperiment: string | null;  // null | "no_music" | "low_visibility" | ...

  // Confidence — the model's self-assessed confidence in this plan
  confidence: number;            // 0..1

  // Prompt version that produced this plan
  promptVersion: string;
}

export interface GameDesignResponse {
  plan: GameDesignPlan;
  rawModelOutput: string;
  modelId: string;
  latencyMs: number;
  fromCache: boolean;
  promptVersion: string;
  explanation: string;            // separate from plan.reasoning — the human-facing one
  validated: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Allowed vocabulary for the LLM output. Used by the OutputValidator to
 * catch invalid values before they reach the Director.
 */
export const ALLOWED_DESIGN_VALUES = {
  weather: [
    "clear", "fog", "heavy_fog", "ash", "rain", "thunder",
    "snow", "dust_storm", "fireflies", "blood_moon", "cherry_blossoms",
    "solar_eclipse",
  ] as WeatherId[],
  lighting: [
    "bright", "normal", "dim", "dark", "blood", "foggy", "eclipse",
  ] as LightingStyle[],
  camera: [
    "wide", "close", "cinematic", "handheld",
    "dynamic_zoom", "boss_focus", "dutch_angle", "slow_zoom",
  ] as CameraStyle[],
  music: [
    "peaceful", "epic", "dark", "hopeless", "victory",
    "ancient", "percussion", "choir", "silence",
  ] as MusicStyle[],
  crowd: [
    "cheering", "silent", "praying", "running",
    "burning_city", "monks", "ruined_kingdom",
  ] as CrowdStyle[],
  bossStyle: [
    "aggressive", "counter", "defensive", "patient",
    "rushdown", "mind_game", "punisher", "adaptive", "zoner",
  ] as BossStyleId[],
  difficulty: [
    "easy", "normal", "hard", "brutal", "nightmare", "adaptive",
  ] as DifficultyId[],
  emotion: [
    "wonder", "confidence", "suspicion", "fear", "hopelessness",
    "determination", "victory", "curiosity", "chaos", "isolation",
    "triumph", "despair", "awe", "serene", "rage",
  ] as Emotion[],
  narrativeEvents: [
    "TempleCollapsed", "VillageBurned", "HeroSpared", "HeroDefeated",
    "PlayerDefeated", "BloodMoonAppeared", "MonksEscaped", "SealBroken",
    "ArenaDamaged", "WeatherChanged", "MythCreated", "CampaignStarted",
    "CampaignEnded",
  ],
  experiments: [
    "no_music", "low_visibility", "boss_passive", "silent_arena", "habit_breaker",
  ],
};

export const GAME_DESIGN_OUTPUT_SCHEMA = {
  type: "object",
  required: [
    "intent", "reasoning", "targetEmotion", "targetIntensity",
    "targetDifficulty", "targetLearningGoal", "recommendedGenome",
    "recommendedWeather", "recommendedLighting", "recommendedMusic",
    "recommendedCamera", "recommendedCrowd", "recommendedHazards",
    "recommendedNarrativeEvent", "confidence",
  ],
  properties: {
    intent: { type: "string" },
    reasoning: { type: "string" },
    targetEmotion: { type: "string", enum: ALLOWED_DESIGN_VALUES.emotion },
    targetIntensity: { type: "number", minimum: 0, maximum: 1 },
    targetDifficulty: { type: "string", enum: ALLOWED_DESIGN_VALUES.difficulty },
    targetLearningGoal: { type: "string" },
    recommendedGenome: { type: "string", enum: ALLOWED_DESIGN_VALUES.bossStyle },
    recommendedWeather: { type: "string", enum: ALLOWED_DESIGN_VALUES.weather },
    recommendedLighting: { type: "string", enum: ALLOWED_DESIGN_VALUES.lighting },
    recommendedMusic: { type: "string", enum: ALLOWED_DESIGN_VALUES.music },
    recommendedCamera: { type: "string", enum: ALLOWED_DESIGN_VALUES.camera },
    recommendedCrowd: { type: "string", enum: ALLOWED_DESIGN_VALUES.crowd },
    recommendedHazards: { type: "array", items: { type: "string" } },
    recommendedNarrativeEvent: { type: "string" },
    recommendedExperiment: {
      type: ["string", "null"],
      enum: [...ALLOWED_DESIGN_VALUES.experiments, null],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};
