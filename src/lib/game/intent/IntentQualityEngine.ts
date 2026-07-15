// ============================================================================
// PROJECT ETERNAL — INTENT QUALITY ENGINE
//
// Quality scoring for the new IntentOutput schema. The metrics are
// inspired by GameDesignQualityEngine but re-purposed for the
// intent-only output.
//
//   - playerAdaptation
//   - challenge
//   - narrativeConsistency
//   - emotionConsistency
//   - intentClarity
//   - planCoherence
//   - campaignContinuity
//   - confidenceCalibration
//   - overall
//
// Used by the MassiveDatasetGenerator to grade and filter samples.
// ============================================================================

import type { IntentTrainingSample } from "./IntentTrainingSample";
import { categoriseIntent, type IntentCategory } from "./IntentSchema";

export type IntentQuality = "gold" | "high" | "medium" | "low" | "discard";

export interface IntentQualityScore {
  playerAdaptation: number;       // 0..1 — does the intent address the player state?
  challenge: number;              // 0..1 — is the intent appropriate to skill?
  narrativeConsistency: number;   // 0..1 — does it respect the chapter/narrative?
  emotionConsistency: number;      // 0..1 — is the intent coherent with the topline?
  intentClarity: number;          // 0..1 — is the intent string clear and specific?
  planCoherence: number;          // 0..1 — is the highLevelPlan coherent with intent?
  campaignContinuity: number;     // 0..1 — does it continue the campaign without repetition?
  confidenceCalibration: number;  // 0..1 — does the reported confidence match quality?
  overall: number;                // weighted average
  quality: IntentQuality;
  category: IntentCategory;
}

export interface IntentQualityConfig {
  // Thresholds
  goldThreshold: number;
  highThreshold: number;
  mediumThreshold: number;
  // Weights
  weights: {
    playerAdaptation: number;
    challenge: number;
    narrativeConsistency: number;
    emotionConsistency: number;
    intentClarity: number;
    planCoherence: number;
    campaignContinuity: number;
    confidenceCalibration: number;
  };
}

export const DEFAULT_INTENT_QUALITY_CONFIG: IntentQualityConfig = {
  goldThreshold: 0.75,
  highThreshold: 0.55,
  mediumThreshold: 0.40,
  weights: {
    playerAdaptation: 0.20,
    challenge: 0.12,
    narrativeConsistency: 0.10,
    emotionConsistency: 0.10,
    intentClarity: 0.15,
    planCoherence: 0.13,
    campaignContinuity: 0.10,
    confidenceCalibration: 0.10,
  },
};

export class IntentQualityEngine {
  private config: IntentQualityConfig;

  constructor(config: Partial<IntentQualityConfig> = {}) {
    this.config = { ...DEFAULT_INTENT_QUALITY_CONFIG, ...config };
    if (config.weights) this.config.weights = { ...this.config.weights, ...config.weights };
  }

  score(sample: IntentTrainingSample): IntentQualityScore {
    const intent = sample.output.intent;
    const ctx = sample.input.context;
    const top = ctx.topline;
    const category = categoriseIntent(intent.intent);

    const playerAdaptation = this.scorePlayerAdaptation(ctx, intent, category);
    const challenge = this.scoreChallenge(ctx, intent, category);
    const narrativeConsistency = this.scoreNarrativeConsistency(ctx, intent);
    const emotionConsistency = this.scoreEmotionConsistency(ctx, intent, category);
    const intentClarity = this.scoreIntentClarity(intent);
    const planCoherence = this.scorePlanCoherence(intent);
    const campaignContinuity = this.scoreCampaignContinuity(ctx, intent);
    const confidenceCalibration = this.scoreConfidenceCalibration(sample);

    const w = this.config.weights;
    const overall =
      playerAdaptation * w.playerAdaptation +
      challenge * w.challenge +
      narrativeConsistency * w.narrativeConsistency +
      emotionConsistency * w.emotionConsistency +
      intentClarity * w.intentClarity +
      planCoherence * w.planCoherence +
      campaignContinuity * w.campaignContinuity +
      confidenceCalibration * w.confidenceCalibration;

    const quality: IntentQuality =
      overall >= this.config.goldThreshold ? "gold" :
      overall >= this.config.highThreshold ? "high" :
      overall >= this.config.mediumThreshold ? "medium" :
      overall >= 0.30 ? "low" : "discard";

    return {
      playerAdaptation,
      challenge,
      narrativeConsistency,
      emotionConsistency,
      intentClarity,
      planCoherence,
      campaignContinuity,
      confidenceCalibration,
      overall,
      quality,
      category,
    };
  }

  gradeBatch(samples: IntentTrainingSample[]): Map<string, IntentQualityScore> {
    const out = new Map<string, IntentQualityScore>();
    for (const s of samples) {
      out.set(s.id, this.score(s));
    }
    return out;
  }

  getConfig(): IntentQualityConfig {
    return this.config;
  }

  // --------------------------------------------------------------------------
  //  Private scorers
  // --------------------------------------------------------------------------

  private scorePlayerAdaptation(ctx: IntentTrainingSample["input"]["context"], intent: IntentTrainingSample["output"]["intent"], category: IntentCategory): number {
    const mood = ctx.topline.currentMood;
    const s = intent.intent.toLowerCase();
    let score = 0.4;

    if (mood === "overconfident" && (category === "punish" || s.includes("break") || s.includes("punish"))) score += 0.5;
    if (mood === "frustrated" && (category === "reward" || s.includes("reward") || s.includes("rebuild"))) score += 0.5;
    if (mood === "bored" && (category === "challenge" || category === "escalate")) score += 0.5;
    if (mood === "engaged" && (category === "teach" || category === "teach_offense" || category === "teach_defense")) score += 0.5;
    if (mood === "cautious" && (category === "challenge" || category === "destabilise")) score += 0.4;
    if (mood === "tilted" && (category === "reward" || category === "de_escalate" || category === "settle")) score += 0.4;

    // The reasoning field should reference the player's state
    if (intent.reasoning.toLowerCase().includes(mood)) score += 0.1;
    if (intent.reasoning.toLowerCase().includes(ctx.topline.dominantStrategy)) score += 0.05;

    return Math.max(0, Math.min(1, score));
  }

  private scoreChallenge(ctx: IntentTrainingSample["input"]["context"], intent: IntentTrainingSample["output"]["intent"], category: IntentCategory): number {
    const skill = ctx.playerEstimate.skill;
    const frustration = 1 - ctx.playerEstimate.emotionalStability;
    const s = intent.intent.toLowerCase();

    let score = 0.5;

    // High skill player → challenging intent
    if (skill > 0.7 && (category === "challenge" || category === "escalate" || category === "destabilise")) score += 0.3;
    if (skill < 0.4 && (category === "teach" || category === "reward")) score += 0.3;

    // Frustrated player → reward, not punish
    if (frustration > 0.7 && category === "punish") score -= 0.4;
    if (frustration > 0.7 && category === "reward") score += 0.3;

    // Reward intent for a player on a win streak is mismatched
    const recentWins = ctx.topline.recentWinStreak;
    if (recentWins > 2 && category === "reward") score -= 0.3;
    if (recentWins < 0 && recentWins > -2 === false && (recentWins as number) <= -2 && category === "escalate") score -= 0.3;

    return Math.max(0, Math.min(1, score));
  }

  private scoreNarrativeConsistency(ctx: IntentTrainingSample["input"]["context"], intent: IntentTrainingSample["output"]["intent"]): number {
    const phase = ctx.topline.narrativePhase;
    const s = intent.intent.toLowerCase();

    if (phase === "climax" && (s.includes("escalat") || s.includes("climax") || s.includes("conclud"))) return 0.9;
    if (phase === "resolution" && (s.includes("conclud") || s.includes("close") || s.includes("final"))) return 0.9;
    if (phase === "opening" && (s.includes("introduc") || s.includes("first") || s.includes("discover"))) return 0.9;
    if (phase === "rising" && (s.includes("challeng") || s.includes("teach") || s.includes("escalat"))) return 0.9;
    if (phase === "falling" && (s.includes("reward") || s.includes("settle") || s.includes("de-escalat"))) return 0.9;
    if (phase === "climax" && s.includes("reward")) return 0.3;
    if (phase === "opening" && s.includes("conclud")) return 0.3;

    return 0.6;
  }

  private scoreEmotionConsistency(ctx: IntentTrainingSample["input"]["context"], intent: IntentTrainingSample["output"]["intent"], category: IntentCategory): number {
    const em = ctx.emotionalCurve?.currentEmotion ?? "neutral";
    const s = intent.intent.toLowerCase();

    if (em === "fear" && (category === "settle" || category === "reward")) return 0.9;
    if (em === "rage" && (category === "destabilise" || category === "escalate")) return 0.8;
    if (em === "hope" && (category === "challenge" || category === "teach")) return 0.8;
    if (em === "hopelessness" && category === "reward") return 0.9;
    if (em === "wonder" && (category === "teach" || category === "experiment")) return 0.8;

    return 0.6;
  }

  private scoreIntentClarity(intent: IntentTrainingSample["output"]["intent"]): number {
    const s = intent.intent.trim();
    let score = 0.5;

    // Length sweet spot: 20-100 chars
    if (s.length >= 20 && s.length <= 100) score += 0.25;
    if (s.length < 10) score -= 0.3;
    if (s.length > 150) score -= 0.2;

    // Starts with a verb
    if (/^(break|reward|punish|teach|introduce|escalate|destabilise|settle|conclude|deliver|rebuild|test|force|create|challenge|reduce|reinforce|open|close|tighten|loosen|reward|surprise|reset|restore|expose|shock|return|recall)/i.test(s)) {
      score += 0.15;
    }
    if (s.includes("  ")) score -= 0.1;
    if (/[?!]$/.test(s)) score -= 0.05;

    // The category must be non-unknown
    if (categoriseIntent(s) !== "unknown") score += 0.15;

    return Math.max(0, Math.min(1, score));
  }

  private scorePlanCoherence(intent: IntentTrainingSample["output"]["intent"]): number {
    // Plan should mention an abstract shape, not a low-level value
    const plan = intent.highLevelPlan.toLowerCase();
    let score = 0.5;

    // Penalise low-level values in the plan
    const lowLevelTerms = ["weather", "camera", "music", "lighting", "hazard", "boss style", "difficulty", "rain", "fog", "wide shot", "close-up", "epic music", "dark music", "hard difficulty", "easy difficulty"];
    for (const t of lowLevelTerms) {
      if (plan.includes(t)) score -= 0.2;
    }

    // Plan should mention at least one abstract concept
    const abstractTerms = ["patient", "aggressive", "spacing", "teach", "reward", "punish", "tempo", "rhythm", "tension", "pressure", "spacing", "read", "adapt", "counter", "windows", "frames", "approach", "commit", "patience", "approach", "encounter"];
    let hasAbstract = false;
    for (const t of abstractTerms) {
      if (plan.includes(t)) { hasAbstract = true; break; }
    }
    if (hasAbstract) score += 0.2;

    // Plan should have 2+ sentences
    const sentenceCount = (intent.highLevelPlan.match(/[.!?]+/g) || []).length;
    if (sentenceCount >= 2) score += 0.15;

    // Reasoning should be longer than intent
    if (intent.reasoning.length > intent.intent.length) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  private scoreCampaignContinuity(ctx: IntentTrainingSample["input"]["context"], intent: IntentTrainingSample["output"]["intent"]): number {
    const recent = ctx.previousDirectorPlans?.recent ?? [];
    if (recent.length === 0) return 0.7;
    // Penalize if the intent literally repeats recent intent strings
    const sameIntents = recent.filter(p => p.intent === intent.intent).length;
    if (sameIntents === 0) return 0.9;
    if (sameIntents === 1) return 0.6;
    if (sameIntents === 2) return 0.3;
    return 0.1;
  }

  private scoreConfidenceCalibration(sample: IntentTrainingSample): number {
    const reported = sample.output.intent.confidence;
    const quality = sample.quality;
    // Reported confidence should be near actual quality
    const delta = Math.abs(reported - quality);
    return Math.max(0, 1 - delta * 2);
  }
}
