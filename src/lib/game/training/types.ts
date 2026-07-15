// ============================================================================
// TRAINING INFRASTRUCTURE — SHARED TYPES
//
// Shared taxonomy and types used across the training pipeline. The
// training layer reuses GameDesignSample from the gamedesigner module —
// no duplicated sample types live here.
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import type { GameDesignPlan } from "../gamedesigner/GameDesignPlan";

// ---- Buckets — the 11 dimensions required for balancing ----
export type SkillBucket = "novice" | "intermediate" | "advanced" | "expert";
export type Archetype =
  | "aggressor" | "patient" | "adaptive" | "turtle"
  | "whiff_punisher" | "zoner" | "balanced";
export type CampaignStage = "opening" | "rising" | "climax" | "falling" | "resolution";
export type AdaptationBucket = "low" | "medium" | "high" | "exceptional";

export interface SampleBuckets {
  skill: SkillBucket;
  archetype: Archetype;
  campaignStage: CampaignStage;
  difficulty: string;
  emotion: string;
  bossStyle: string;        // genome style id
  genome: string;           // library genome id (if available)
  weather: string;
  narrativeEvent: string;
  winLoss: "win" | "loss" | "unknown";
  adaptation: AdaptationBucket;
}

// ---- Ranking tiers (PHASE 3) ----
export type SampleTier = "gold" | "silver" | "bronze" | "discard";

// ---- Multi-dimensional rank (PHASE 3) ----
export interface RankedSample {
  sample: GameDesignSample;
  buckets: SampleBuckets;
  // Individual dimensions
  overallQuality: number;        // 0..1
  trainingValue: number;          // 0..1
  novelty: number;                // 0..1
  consistency: number;            // 0..1
  difficulty: number;             // 0..1 — 0=trivial, 1=hard
  narrativeQuality: number;       // 0..1
  predictionAccuracy: number;     // 0..1
  directorConfidence: number;     // 0..1
  llmConfidence: number;          // 0..1
  adaptationSuccess: number;      // 0..1
  // Final
  score: number;                  // 0..1 — composite
  tier: SampleTier;
}

// ---- Deterministic PRNG (used in every phase) ----
export function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Pure helpers (no engine deps) ----
export function skillBucket(skill: number): SkillBucket {
  if (skill < 0.25) return "novice";
  if (skill < 0.5) return "intermediate";
  if (skill < 0.75) return "advanced";
  return "expert";
}

export function archetypeOf(estimate: {
  favouriteStrategies: string[];
  riskTolerance: number;
  patience: number;
  adaptability: number;
}): Archetype {
  const strat = estimate.favouriteStrategies[0];
  if (strat === "rushdown" || estimate.riskTolerance > 0.7) return "aggressor";
  if (strat === "whiff_punish") return "whiff_punisher";
  if (strat === "turtle") return "turtle";
  if (strat === "zoner" || strat === "spacing") return "zoner";
  if (estimate.patience > 0.7) return "patient";
  if (estimate.adaptability > 0.7) return "adaptive";
  return "balanced";
}

export function campaignStageOf(
  chapterIndex: number,
  totalChapters: number,
  trajectory: string,
): CampaignStage {
  if (totalChapters <= 0) return "opening";
  const ratio = chapterIndex / Math.max(1, totalChapters);
  if (ratio < 0.15) return "opening";
  if (ratio < 0.55) {
    if (trajectory === "peaking") return "climax";
    return "rising";
  }
  if (ratio < 0.85) {
    if (trajectory === "falling") return "falling";
    return "climax";
  }
  return "resolution";
}

export function adaptationBucket(adaptability: number, winRate: number): AdaptationBucket {
  const score = adaptability * 0.6 + winRate * 0.4;
  if (score < 0.3) return "low";
  if (score < 0.55) return "medium";
  if (score < 0.8) return "high";
  return "exceptional";
}

// ---- Extract buckets from a sample (no duplication, pure) ----
export function extractBuckets(sample: GameDesignSample): SampleBuckets {
  const ctx = sample.context;
  const plan: GameDesignPlan = sample.plan;
  return {
    skill: skillBucket(ctx.playerEstimate.skill),
    archetype: archetypeOf(ctx.playerEstimate),
    campaignStage: campaignStageOf(
      ctx.currentChapter?.chapterIndex ?? ctx.emotionalCurve?.currentBeat ?? 0,
      ctx.campaignPlan?.totalChapters ?? ctx.campaignHistory?.totalChapters ?? 0,
      ctx.emotionalCurve?.trajectory ?? "steady",
    ),
    difficulty: plan.targetDifficulty,
    emotion: plan.targetEmotion,
    bossStyle: plan.recommendedGenome,
    genome: plan.recommendedGenome,
    weather: plan.recommendedWeather,
    narrativeEvent: plan.recommendedNarrativeEvent || "none",
    winLoss: sample.actualResult.playerWon
      ? "win"
      : (sample.actualResult.damageDealt > 0 || sample.actualResult.engaged)
        ? "loss"
        : "unknown",
    adaptation: adaptationBucket(
      ctx.playerEstimate.adaptability,
      ctx.campaignHistory?.winRate ?? 0.5,
    ),
  };
}
