// ============================================================================
// PROJECT ETERNAL — INTENT CONTEXT BUILDER
//
// Builds the input the fine-tuned Game Designer model sees. The
// context is the EXACT same content as the legacy GameDesignContext
// (player, prediction, campaign, world, library, narrative, emotion,
// boss memory, difficulty, arena) but the OUTPUT target is now
// IntentOutput, not GameDesignPlan.
//
// Reuses the existing GameDesignContextBuilder under the hood. The
// mapping is a thin structural pass: drop the design-recommendation
// fields, keep the design-relevant evidence.
// ============================================================================

import { GameDesignContextBuilder } from "../gamedesigner/GameDesignContextBuilder";
import type { BuildContextParams } from "../gamedesigner/GameDesignContextBuilder";
import type { GameDesignContext, GameDesignTopline } from "../gamedesigner/types";

/**
 * The input the model sees. Same fields as GameDesignContext minus
 * the design-time fields that the model no longer has to fill in.
 * We keep the SAME shape for forward-compatibility with the existing
 * infrastructure, but rename for clarity.
 */
export type IntentContext = GameDesignContext;

export interface IntentContextBundle {
  context: IntentContext;
  contextHash: string;
  topLevelSummary: IntentTopLevelSummary;
}

export interface IntentTopLevelSummary {
  intentDomain: "player_adaptation" | "campaign_continuity" | "narrative_beat" | "exploration";
  posture: GameDesignTopline["recommendedPosture"];
  dominantStrategy: string;
  currentMood: string;
  worldTrajectory: GameDesignTopline["worldTrajectory"];
  narrativePhase: GameDesignTopline["narrativePhase"];
  chapterIndex: number;
  totalChapters: number;
  playerSkill: number;
  playerConfidence: number;
  playerFrustration: number;
  worldCorruption: number;
  worldHope: number;
  chapterEmotion: string;
  intentVersion: number;
}

/**
 * Build an IntentContextBundle from the same inputs the legacy
 * GameDesignContextBuilder accepts.
 */
export class IntentContextBuilder {
  private inner = new GameDesignContextBuilder();

  build(params: BuildContextParams): IntentContextBundle {
    const context = this.inner.build(params);
    const summary = summarise(context);
    const contextHash = hash32(canonicalString(context));
    return { context, contextHash, topLevelSummary: summary };
  }
}

function summarise(ctx: IntentContext): IntentTopLevelSummary {
  const top = ctx.topline;
  const chapter = ctx.currentChapter;
  const wp = ctx.worldState;
  return {
    intentDomain: deriveIntentDomain(top, chapter?.chapterIndex ?? 0),
    posture: top.recommendedPosture,
    dominantStrategy: top.dominantStrategy,
    currentMood: top.currentMood,
    worldTrajectory: top.worldTrajectory,
    narrativePhase: top.narrativePhase,
    chapterIndex: chapter?.chapterIndex ?? 0,
    totalChapters: ctx.campaignPlan?.totalChapters ?? 0,
    playerSkill: ctx.playerEstimate.skill,
    playerConfidence: ctx.playerEstimate.confidence,
    playerFrustration: 1 - ctx.playerEstimate.emotionalStability,
    worldCorruption: wp.corruptionLevel,
    worldHope: wp.hopeLevel,
    chapterEmotion: chapter?.emotion ?? "neutral",
    intentVersion: 1,
  };
}

function deriveIntentDomain(
  top: GameDesignTopline,
  chapterIndex: number,
): IntentTopLevelSummary["intentDomain"] {
  if (top.narrativePhase === "climax" || top.narrativePhase === "resolution") {
    return "narrative_beat";
  }
  if (top.currentMood === "frustrated" || top.currentMood === "tilted") {
    return "campaign_continuity";
  }
  if (top.recommendedPosture === "reward" || top.recommendedPosture === "rest") {
    return "campaign_continuity";
  }
  if (chapterIndex === 0) {
    return "exploration";
  }
  return "player_adaptation";
}

function canonicalString(ctx: IntentContext): string {
  // Hash-stable subset — drop noisy time fields
  return JSON.stringify({
    topline: ctx.topline,
    emotionalCurve: ctx.emotionalCurve ? {
      currentEmotion: ctx.emotionalCurve.currentEmotion,
      currentIntensity: ctx.emotionalCurve.currentIntensity,
      trajectory: ctx.emotionalCurve.trajectory,
    } : null,
    currentChapter: ctx.currentChapter ? {
      chapterIndex: ctx.currentChapter.chapterIndex,
      emotion: ctx.currentChapter.emotion,
    } : null,
    worldState: ctx.worldState ? {
      corruptionLevel: ctx.worldState.corruptionLevel,
      hopeLevel: ctx.worldState.hopeLevel,
      bloodMoonActive: ctx.worldState.bloodMoonActive,
    } : null,
    playerEstimate: ctx.playerEstimate ? {
      skill: ctx.playerEstimate.skill,
      confidence: ctx.playerEstimate.confidence,
      patience: ctx.playerEstimate.patience,
    } : null,
  });
}

function hash32(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
