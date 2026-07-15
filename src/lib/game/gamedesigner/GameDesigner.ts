// ============================================================================
// PHASE 3: GAME DESIGNER
//
// The LLM Game Designer — the highest level of the AI hierarchy. It receives
// the GameDesignContext (player profile, prediction, campaign, world, library,
// emotional curve, etc.) and outputs a high-level GameDesignPlan. It never
// outputs gameplay actions. The Director converts the plan into a
// DirectorPlanV3.
//
// The GameDesigner wraps the existing AI infrastructure:
//   - PromptLibrary (PHASE 7) for prompt versioning
//   - GameDesignOutputValidator (PHASE 2) for output validation
//   - ExplanationEngine (PHASE 8) for human-readable explanations
//   - GameDesignDatasetLogger (PHASE 4) for training data
//   - ModelAdapters (PHASE 6) for the underlying model
// ============================================================================

import type { InferenceResult } from "../ai/types";
import { PromptLibrary, type BuiltPrompt } from "./PromptLibrary";
import type { GameDesignPlan, GameDesignResponse } from "./GameDesignPlan";
import { GameDesignOutputValidator } from "./GameDesignOutputValidator";
import { ExplanationEngine } from "./ExplanationEngine";
import { GameDesignDatasetLogger } from "./GameDesignDatasetLogger";
import { DeterministicMockAdapter } from "./ModelAdapters";
import type { GameDesignContext } from "./types";
import type { AIModel, InferenceRequest } from "../ai/types";

export interface GameDesignerDeps {
  model: AIModel;
  promptLibrary: PromptLibrary;
  validator: GameDesignOutputValidator;
  explanations: ExplanationEngine;
  dataset: GameDesignDatasetLogger;
  activePromptVersion?: string;
}

export interface DesignResult extends GameDesignResponse {
  sampleId: string;
  fellback: boolean;
}

const FALLBACK_CONFIDENCE_THRESHOLD = 0.4;

/**
 * The GameDesigner — a thin, deterministic orchestrator over the existing
 * AI middleware. It does NOT touch the combat engine, the renderer, or any
 * gameplay code.
 */
export class GameDesigner {
  deps: GameDesignerDeps;

  constructor(deps?: Partial<GameDesignerDeps>) {
    this.deps = {
      model: deps?.model ?? new DeterministicMockAdapter(),
      promptLibrary: deps?.promptLibrary ?? new PromptLibrary(),
      validator: deps?.validator ?? new GameDesignOutputValidator(),
      explanations: deps?.explanations ?? new ExplanationEngine(),
      dataset: deps?.dataset ?? new GameDesignDatasetLogger(),
    };
    if (deps?.activePromptVersion) {
      this.deps.promptLibrary.setActiveVersion(deps.activePromptVersion);
    }
  }

  /**
   * Swap the active prompt version at runtime.
   */
  setPromptVersion(version: string): boolean {
    return this.deps.promptLibrary.setActiveVersion(version);
  }

  /**
   * Swap the underlying model.
   */
  setModel(model: AIModel): void {
    this.deps.model = model;
  }

  /**
   * Design a single fight. Returns the GameDesignPlan + side metadata.
   * This is the high-level entry point used by the Director.
   */
  async design(context: GameDesignContext, requestId?: string): Promise<DesignResult> {
    const prompt = this.deps.promptLibrary.buildPrompt(context);
    const inference = await this.runInference(prompt, requestId);

    let plan: GameDesignPlan;
    let warnings: string[] = [];
    let errors: string[] = [];
    let validated = false;

    const parsed = this.parse(inference.text);
    if (!parsed) {
      plan = this.emergencyFallback(prompt.version);
      errors.push("Model output could not be parsed as JSON");
    } else {
      const result = this.deps.validator.validate(parsed, prompt.version);
      if (!result) {
        plan = this.emergencyFallback(prompt.version);
        errors.push("Model output failed schema validation");
      } else {
        plan = result.output;
        warnings = result.warnings;
        errors = result.errors;
        validated = result.errors.length === 0;
      }
    }

    // If confidence is too low, mark the response as fellback and substitute
    // a safe default plan. The Director will receive the plan; whether the
    // Director uses it is its own decision.
    let fellback = false;
    if (plan.confidence < FALLBACK_CONFIDENCE_THRESHOLD) {
      plan = this.emergencyFallback(prompt.version);
      fellback = true;
      warnings.push("Confidence below threshold — fell back to safe default");
    }

    const explanation = this.deps.explanations.explain(plan, context);

    const sampleId = this.deps.dataset.log({
      context,
      plan,
      explanation: explanation.text,
      modelId: inference.modelId,
      promptVersion: prompt.version,
      rawModelOutput: inference.text,
      validated,
      warnings,
      errors,
      confidence: plan.confidence,
      fellback,
    });

    return {
      plan,
      rawModelOutput: inference.text,
      modelId: inference.modelId,
      latencyMs: inference.latencyMs,
      fromCache: inference.fromCache,
      promptVersion: prompt.version,
      explanation: explanation.text,
      validated,
      warnings,
      errors,
      sampleId,
      fellback,
    };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async runInference(prompt: BuiltPrompt, requestId?: string): Promise<InferenceResult> {
    const req: InferenceRequest = {
      prompt: {
        system: prompt.system,
        developer: prompt.developer,
        user: prompt.user,
        outputSchema: prompt.outputSchema,
        fewShot: prompt.fewShot,
      },
      maxTokens: 1024,
      temperature: 0.7,
      requestId: requestId ?? `gd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    return this.deps.model.infer(req);
  }

  private parse(text: string): unknown | null {
    // The model may return the JSON inside a code fence — strip it.
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fence ? fence[1] : text;
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  private emergencyFallback(promptVersion: string): GameDesignPlan {
    return {
      intent: "Engage the player with a baseline encounter.",
      reasoning: "Model output was unusable. Returning a safe default.",
      targetEmotion: "confidence",
      targetIntensity: 0.5,
      targetDifficulty: "normal",
      targetLearningGoal: "Engage the player.",
      recommendedGenome: "aggressive",
      recommendedWeather: "clear",
      recommendedLighting: "normal",
      recommendedMusic: "ancient",
      recommendedCamera: "wide",
      recommendedCrowd: "silent",
      recommendedHazards: [],
      recommendedNarrativeEvent: "WeatherChanged",
      recommendedExperiment: null,
      confidence: 0.2,
      promptVersion,
    };
  }
}
