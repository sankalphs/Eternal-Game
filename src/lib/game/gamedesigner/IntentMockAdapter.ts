// ============================================================================
// PROJECT ETERNAL — DETERMINISTIC INTENT MOCK ADAPTER
//
// A mock adapter that produces valid IntentOutput JSON deterministically
// based on the input GameDesignContext. Used for local development,
// testing, and as a baseline reference when no fine-tuned model is
// available.
//
// The mock is a faithful baseline: it does the same kind of reasoning
// the fine-tuned model is trained to do, but with a hand-coded
// decision tree. It is NOT a placeholder. The Director + IntentTranslator
// will treat its outputs the same as a real model's.
// ============================================================================

import type { AIModel, AIModelMetadata, InferenceRequest, InferenceResult } from "../ai/types";
import type { IntentOutput } from "../intent/IntentSchema";
import { categoriseIntent } from "../intent/IntentSchema";

export class DeterministicIntentMockAdapter implements AIModel {
  private loaded = false;

  async load(): Promise<void> { this.loaded = true; }
  async unload(): Promise<void> { this.loaded = false; }
  async health(): Promise<boolean> { return this.loaded; }

  metadata(): AIModelMetadata {
    return {
      id: "intent-mock",
      label: "Deterministic Intent Mock (topline-driven)",
      type: "mock",
      maxTokens: 512,
      contextWindow: 8192,
      supportsJSON: true,
      version: "1.0.0",
    };
  }

  async infer(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.loaded) await this.load();
    const start = Date.now();

    const intent = this.buildFromPrompt(request.prompt.user);
    return {
      text: JSON.stringify(intent),
      latencyMs: Date.now() - start,
      modelId: "intent-mock",
      fromCache: false,
      requestId: request.requestId,
    };
  }

  /**
   * Build a valid IntentOutput from the topline in the user prompt.
   * Mirrors what a fine-tuned model should produce, but deterministically.
   */
  private buildFromPrompt(userPrompt: string): IntentOutput {
    const topline = this.extractTopline(userPrompt);
    const mood = topline.currentMood ?? "engaged";
    const phase = topline.narrativePhase ?? "rising";
    const weakness = topline.biggestWeakness ?? "earlyRush";
    const strategy = topline.dominantStrategy ?? "rushdown";
    const posture = topline.recommendedPosture ?? "challenge";

    // Map (mood, posture) to a clear intent
    const intentText = this.deriveIntent(mood, phase, posture, strategy, weakness);
    const category = categoriseIntent(intentText);

    return {
      intent: intentText,
      reasoning: this.deriveReasoning(mood, phase, posture, strategy, weakness),
      expectedPlayerReaction: this.deriveExpectedReaction(mood, phase),
      highLevelPlan: this.derivePlan(category, strategy, posture),
      confidence: 0.6 + (category === "unknown" ? 0 : 0.15),
    };
  }

  private extractTopline(userPrompt: string): {
    currentMood?: string;
    recommendedPosture?: string;
    dominantStrategy?: string;
    biggestWeakness?: string;
    narrativePhase?: string;
    currentEmotion?: string;
  } {
    const match = userPrompt.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      const parsed = JSON.parse(match[0]);
      return parsed.topline ?? {};
    } catch {
      return {};
    }
  }

  private deriveIntent(
    mood: string,
    phase: string,
    posture: string,
    strategy: string,
    weakness: string,
  ): string {
    if (mood === "overconfident" && (posture === "punish" || phase === "climax")) {
      return "Break the overconfidence built from winning streak";
    }
    if (mood === "frustrated" && (posture === "reward" || phase === "falling")) {
      return "Reward the frustrated player with a controlled win";
    }
    if (mood === "engaged" && posture === "teach") {
      return "Teach the player a new mechanic to extend their mastery";
    }
    if (mood === "bored" && (posture === "challenge" || phase === "climax")) {
      return "Escalate the encounter to wake the bored player up";
    }
    if (mood === "cautious" && posture === "challenge") {
      return "Force the cautious player to commit to engagement";
    }
    if (mood === "tilted" && (posture === "reward" || phase === "resolution")) {
      return "Settle the tilted player with a generous encounter";
    }
    if (phase === "climax") {
      return "Escalate to the climax of the campaign arc";
    }
    if (phase === "resolution") {
      return "Conclude the campaign with a final satisfying encounter";
    }
    if (weakness && strategy) {
      return `Counter the ${weakness} habit with a ${posture} encounter`;
    }
    return `Engage the player with a ${posture} encounter in the ${phase} phase`;
  }

  private deriveReasoning(
    mood: string,
    phase: string,
    posture: string,
    strategy: string,
    weakness: string,
  ): string {
    return `Posture=${posture}, mood=${mood}, weakness=${weakness}, current strategy=${strategy}, phase=${phase}. The deterministic baseline selects the intent that best serves the player's state and the campaign trajectory.`;
  }

  private deriveExpectedReaction(mood: string, phase: string): string {
    if (mood === "overconfident") return "Player starts spacing and observing.";
    if (mood === "frustrated") return "Player re-engages with the campaign.";
    if (mood === "engaged") return "Player learns a new skill and adapts.";
    if (mood === "bored") return "Player is forced to engage and the engagement time increases.";
    if (mood === "cautious") return "Player starts committing to risk-taking plays.";
    if (mood === "tilted") return "Player's frustration drops and win rate stabilises.";
    return "Player engages with a normal fight and the campaign continues.";
  }

  private derivePlan(category: string, strategy: string, posture: string): string {
    if (category === "punish") {
      return "A patient counter encounter that punishes dash-in approaches.";
    }
    if (category === "reward") {
      return "A generous encounter at moderate difficulty. The player should feel mastery.";
    }
    if (category === "teach") {
      return "A teaching encounter with a patient genome. The player should learn.";
    }
    if (category === "challenge") {
      return "An aggressive encounter that forces commitment.";
    }
    if (category === "destabilise") {
      return "An unpredictable encounter. The player should be forced to read the boss.";
    }
    if (category === "settle") {
      return "A calm encounter. The player should breathe and re-engage.";
    }
    if (category === "conclude") {
      return "A final satisfying encounter. The player should feel the campaign matter.";
    }
    return "A baseline encounter.";
  }
}
