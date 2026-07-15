// ============================================================================
// PHASE 8: EXPLANATION ENGINE
//
// Every GameDesignPlan must be accompanied by a concise human-readable
// explanation. The engine prefers the LLM's own `reasoning` field; if that
// is missing, weak, or low-quality, it synthesises a templated explanation
// from the context.
//
// All explanations are persisted on the GameDesignSample for the dataset.
// ============================================================================

import type { GameDesignPlan } from "./GameDesignPlan";
import type { GameDesignContext, GameDesignTopline } from "./types";

export interface ExplanationResult {
  text: string;
  source: "model" | "synthesised" | "fallback";
  quality: "high" | "medium" | "low";
}

export class ExplanationEngine {
  /**
   * Produce an explanation for a plan.
   * Prefers the model's own reasoning; otherwise synthesises from context.
   */
  explain(plan: GameDesignPlan, context: GameDesignContext): ExplanationResult {
    const modelReasoning = plan.reasoning?.trim() ?? "";

    if (modelReasoning.length >= 40 && this.qualityOf(modelReasoning) !== "low") {
      return {
        text: this.formatFromModel(plan, modelReasoning, context),
        source: "model",
        quality: this.qualityOf(modelReasoning),
      };
    }

    if (modelReasoning.length > 0) {
      // Augment weak model reasoning with template.
      return {
        text: this.formatHybrid(plan, modelReasoning, context),
        source: "synthesised",
        quality: "medium",
      };
    }

    return {
      text: this.synthesise(plan, context),
      source: "synthesised",
      quality: "medium",
    };
  }

  /**
   * Heuristic quality scoring of a free-text reasoning string.
   */
  qualityOf(text: string): "high" | "medium" | "low" {
    const len = text.length;
    if (len < 30) return "low";
    const hasCause = /(because|after|since|with|through|counter|reward|punish|teach)/i.test(text);
    const hasEvidence = /(player|streak|mood|weakness|emotion|world|chapter|trait|prediction)/i.test(text);
    if (len >= 100 && hasCause && hasEvidence) return "high";
    if (hasCause || hasEvidence) return "medium";
    return "low";
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private formatFromModel(plan: GameDesignPlan, reasoning: string, ctx: GameDesignContext): string {
    const opening = this.openingSentence(plan, ctx);
    return `${opening} ${reasoning} A ${plan.recommendedGenome} genome with ${plan.recommendedWeather} and ${plan.recommendedLighting} lighting creates the right uncertainty without inflating raw difficulty.`;
  }

  private formatHybrid(plan: GameDesignPlan, reasoning: string, ctx: GameDesignContext): string {
    const synth = this.synthesise(plan, ctx);
    return `${synth} ${reasoning}`;
  }

  private synthesise(plan: GameDesignPlan, ctx: GameDesignContext): string {
    const opening = this.openingSentence(plan, ctx);
    const genomeLine = `A ${plan.recommendedGenome} genome with ${plan.recommendedWeather} and ${plan.recommendedLighting} lighting creates the right uncertainty without inflating raw difficulty.`;
    return `${opening} ${genomeLine}`;
  }

  private openingSentence(plan: GameDesignPlan, ctx: GameDesignContext): string {
    const t = ctx.topline;
    const mood = t?.currentMood ?? "focused";
    const streak = Math.max(t?.recentWinStreak ?? 0, t?.recentLossStreak ?? 0);
    const streakType = (t?.recentWinStreak ?? 0) > 0 ? "victories" : "defeats";
    const emotion = plan.targetEmotion;
    const weakness = t?.biggestWeakness ?? "habit";
    const posture = t?.recommendedPosture ?? "engage";

    if (streak >= 3) {
      return `The player has become ${mood} after ${streak} consecutive ${streakType}.`;
    }
    if (posture === "punish") {
      return `The player is leaning on ${weakness} and needs to be shown the cost.`;
    }
    if (posture === "reward") {
      return `The player has earned a moment of breathing room.`;
    }
    if (posture === "teach") {
      return `The player is engaged and ready to learn something new.`;
    }
    if (posture === "rest") {
      return `The world can pause for a heartbeat.`;
    }
    return `The current emotional trajectory calls for ${emotion}.`;
  }
}
