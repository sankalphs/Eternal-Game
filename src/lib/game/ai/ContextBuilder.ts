// ============================================================================
// PHASE 2: CONTEXT BUILDER
//
// Collects all information the AI needs and compresses it into a compact
// structured context. Never passes unnecessary information. Supports context
// compression for models with small context windows.
// ============================================================================

import type { EncodedFeatures, AIContext } from "./types";
import type { PlayerPrediction } from "../prediction/PredictionEngine";
import type { DerivedWorldState } from "../eventsourcing/WorldHistory";
import type { BossMemory } from "../world/WorldState";
import type { CampaignChapter } from "../campaign/CampaignPlanner";

export class ContextBuilder {
  /**
   * Build a compact AI context from all available game state.
   * Only includes fields the AI needs — no raw engine objects.
   */
  build(params: {
    features: EncodedFeatures;
    prediction: PlayerPrediction;
    worldState: DerivedWorldState;
    bossMemory: BossMemory | null;
    chapter: CampaignChapter | null;
    chapterIndex: number;
    totalChapters: number;
    objective: string;
  }): AIContext {
    const { features, prediction, worldState, bossMemory, chapter, chapterIndex, totalChapters, objective } = params;

    // Extract only the most relevant predictions (flat map, no nesting)
    const relevantPredictions: Record<string, number> = {
      kickSpam: prediction.kickSpam,
      earlyRush: prediction.earlyRush,
      panicRoll: prediction.panicRoll,
      superSave: prediction.superSave,
      blockTurtle: prediction.blockTurtle,
      whiffPunish: prediction.whiffPunish,
      hazardAvoid: prediction.hazardAvoid,
      adaptationRate: prediction.adaptationRate,
      prefersClose: prediction.prefersCloseRange,
      prefersFar: prediction.prefersFarRange,
    };

    return {
      version: 1,
      features,
      prediction: relevantPredictions,
      worldState: {
        fear: round(worldState.worldFear),
        darkness: round(worldState.darknessLevel),
        corruption: round(worldState.corruptionLevel),
        hope: round(worldState.hopeLevel),
        heroesDefeated: worldState.heroesDefeated,
        heroesSpared: worldState.heroesSpared,
        bloodMoon: worldState.bloodMoonActive,
      },
      campaign: {
        chapterIndex,
        totalChapters,
        currentEmotion: chapter?.emotion ?? "confidence",
        narrativePurpose: chapter?.narrativePurpose ?? "Advance the campaign.",
      },
      bossMemory: bossMemory ? {
        encounters: bossMemory.encounters,
        playerWins: bossMemory.playerWins,
        favouriteAttack: bossMemory.playerFavouriteAttack,
        lastResult: bossMemory.lastFightResult,
      } : null,
      objective,
    };
  }

  /**
   * Compress context for models with small context windows.
   * Removes low-impact fields and rounds aggressively.
   */
  compress(ctx: AIContext, maxTokens: number): AIContext {
    // Rough estimate: ~1 token per 4 chars of JSON. If under limit, no compression.
    const estimated = JSON.stringify(ctx).length / 4;
    if (estimated <= maxTokens * 0.6) return ctx; // leave room for prompt + output

    // Aggressive compression: remove bossMemory, trim prediction to top 5
    const topPredictions = Object.entries(ctx.prediction)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .reduce((acc, [k, v]) => { acc[k] = Math.round(v * 10) / 10; return acc; }, {} as Record<string, number>);

    return {
      ...ctx,
      prediction: topPredictions,
      bossMemory: null, // drop boss memory under compression
      features: {
        ...ctx.features,
        // Drop least impactful features
        jumpRate: 0,
        rollRate: 0,
        superTiming: 0,
        cornerPressure: 0,
      },
    };
  }

  /**
   * Serialize to compact JSON string (for prompt embedding).
   */
  serialize(ctx: AIContext): string {
    return JSON.stringify(ctx);
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
