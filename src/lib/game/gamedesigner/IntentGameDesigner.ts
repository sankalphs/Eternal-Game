// ============================================================================
// PROJECT ETERNAL — INTENT GAME DESIGNER
//
// The new high-level entry point for the fine-tuned Game Designer model.
// The model produces IntentOutput (intent / reasoning /
// expectedPlayerReaction / highLevelPlan / confidence). NEVER any
// weather, camera, music, hazards, boss style, difficulty, or dialogue.
//
// The Director translates the IntentOutput into DirectorPlanV3 via the
// IntentTranslator. The combat engine, physics, and rendering are
// untouched.
//
// This class replaces the old "GameDesigner.design()" as the training
// and inference target. The legacy GameDesigner remains for backward
// compatibility with the v1-v3 prompts.
// ============================================================================

import type { AIModel, InferenceRequest, InferenceResult } from "../ai/types";
import { PromptLibrary, type BuiltPrompt } from "./PromptLibrary";
import { validateIntentOutput } from "../intent/IntentOutputValidator";
import type { IntentOutput } from "../intent/IntentSchema";
import { GameDesignDatasetLogger } from "./GameDesignDatasetLogger";
import type { GameDesignContext } from "./types";
import { DeterministicMockAdapter } from "./ModelAdapters";
import { IntentContextBuilder, type IntentContextBundle } from "../intent/IntentContextBuilder";
import { ExplanationEngine } from "./ExplanationEngine";

export interface IntentGameDesignerDeps {
  model: AIModel;
  promptLibrary: PromptLibrary;
  dataset: GameDesignDatasetLogger;
  contextBuilder: IntentContextBuilder;
  explanations: ExplanationEngine;
  activePromptVersion?: string;
  intentVersion?: number;
}

export interface IntentDesignResult {
  intent: IntentOutput;
  context: IntentContextBundle;
  rawModelOutput: string;
  modelId: string;
  latencyMs: number;
  promptVersion: string;
  explanation: string;
  validated: boolean;
  warnings: string[];
  errors: string[];
  confidence: number;
  fellback: boolean;
  sampleId: string;
}

const FALLBACK_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Deterministic fallback intent. The Director will translate this into
 * a safe "engagement" plan if the model is unavailable or low confidence.
 */
function emergencyIntent(reason: string): IntentOutput {
  return {
    intent: `Engage the player with a baseline encounter (${reason})`,
    reasoning: "Model output was unusable. The Director will fall back to its safe-default encounter.",
    expectedPlayerReaction: "Player engages with a normal fight and the campaign continues.",
    highLevelPlan: "A baseline encounter that the Director will translate into a moderate, fair fight.",
    confidence: 0.2,
  };
}

/**
 * The IntentGameDesigner — a thin orchestrator over the AI middleware
 * that produces IntentOutput. No low-level gameplay values.
 */
export class IntentGameDesigner {
  deps: IntentGameDesignerDeps;
  private intentVersion: number;

  constructor(deps?: Partial<IntentGameDesignerDeps>) {
    const lib = deps?.promptLibrary ?? new PromptLibrary();
    lib.setActiveVersion(deps?.activePromptVersion ?? "v4");
    this.deps = {
      model: deps?.model ?? new DeterministicMockAdapter(),
      promptLibrary: lib,
      dataset: deps?.dataset ?? new GameDesignDatasetLogger(),
      contextBuilder: deps?.contextBuilder ?? new IntentContextBuilder(),
      explanations: deps?.explanations ?? new ExplanationEngine(),
    };
    this.intentVersion = deps?.intentVersion ?? 1;
  }

  setPromptVersion(version: string): boolean {
    return this.deps.promptLibrary.setActiveVersion(version);
  }

  setModel(model: AIModel): void {
    this.deps.model = model;
  }

  /**
   * Design a single fight's INTENT. Returns the IntentOutput + metadata.
   */
  async designIntent(
    context: GameDesignContext,
    requestId?: string,
  ): Promise<IntentDesignResult> {
    // 1. Build the canonical intent context bundle
    const ctxBundle: IntentContextBundle = {
      context,
      contextHash: "",
      topLevelSummary: {
        intentDomain: "player_adaptation",
        posture: context.topline.recommendedPosture,
        dominantStrategy: context.topline.dominantStrategy,
        currentMood: context.topline.currentMood,
        worldTrajectory: context.topline.worldTrajectory,
        narrativePhase: context.topline.narrativePhase,
        chapterIndex: context.currentChapter?.chapterIndex ?? 0,
        totalChapters: context.campaignPlan?.totalChapters ?? 0,
        playerSkill: context.playerEstimate.skill,
        playerConfidence: context.playerEstimate.confidence,
        playerFrustration: 1 - context.playerEstimate.emotionalStability,
        worldCorruption: context.worldState.corruptionLevel,
        worldHope: context.worldState.hopeLevel,
        chapterEmotion: context.currentChapter?.emotion ?? "neutral",
        intentVersion: this.intentVersion,
      },
    };

    // 2. Build the prompt
    const prompt = this.deps.promptLibrary.buildPrompt(context, "v4");

    // 3. Run inference
    const inference = await this.runInference(prompt, requestId);

    // 4. Parse + validate
    let intent: IntentOutput;
    let warnings: string[] = [];
    let errors: string[] = [];
    let validated = false;
    let fellback = false;

    const parsed = safeParse(inference.text);
    if (!parsed) {
      intent = emergencyIntent("parse-failure");
      errors.push("Model output could not be parsed as JSON");
    } else {
      const result = validateIntentOutput(parsed);
      intent = result.output;
      warnings = result.warnings;
      errors = result.errors;
      validated = result.errors.length === 0;
    }

    if (intent.confidence < FALLBACK_CONFIDENCE_THRESHOLD) {
      intent = emergencyIntent("low-confidence");
      fellback = true;
      warnings.push("Confidence below threshold — fell back to safe default");
    }

    // 5. Log the sample (for the legacy dataset logger compatibility)
    const sampleId = this.deps.dataset.log({
      context,
      plan: this.intentToLegacyPlan(intent),
      explanation: this.deps.explanations.explain(
        this.intentToLegacyPlan(intent),
        context,
      ).text,
      modelId: inference.modelId,
      promptVersion: prompt.version,
      rawModelOutput: inference.text,
      validated,
      warnings,
      errors,
      confidence: intent.confidence,
      fellback,
    });

    return {
      intent,
      context: ctxBundle,
      rawModelOutput: inference.text,
      modelId: inference.modelId,
      latencyMs: inference.latencyMs,
      promptVersion: prompt.version,
      explanation: `Intent: ${intent.intent}\nReasoning: ${intent.reasoning}\nExpected: ${intent.expectedPlayerReaction}\nPlan: ${intent.highLevelPlan}`,
      validated,
      warnings,
      errors,
      confidence: intent.confidence,
      fellback,
      sampleId,
    };
  }

  // --------------------------------------------------------------------------
  //  Internals
  // --------------------------------------------------------------------------

  private async runInference(
    prompt: BuiltPrompt,
    requestId?: string,
  ): Promise<InferenceResult> {
    const req: InferenceRequest = {
      prompt: {
        system: prompt.system,
        developer: prompt.developer,
        user: prompt.user,
        outputSchema: prompt.outputSchema,
        fewShot: prompt.fewShot,
      },
      maxTokens: 512,        // tiny output, intent is short
      temperature: 0.4,      // creativity with stability
      requestId: requestId ?? `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    return this.deps.model.infer(req);
  }

  /**
   * Convert the new IntentOutput to the legacy GameDesignPlan shape so
   * the existing dataset logger, explanation engine, and quality engine
   * continue to work without changes. The Director ignores the legacy
   * fields; the IntentTranslator does the real translation.
   */
  private intentToLegacyPlan(intent: IntentOutput) {
    return {
      intent: intent.intent,
      reasoning: intent.reasoning,
      targetEmotion: "focus" as const,
      targetIntensity: 0.5,
      targetDifficulty: "normal" as const,
      targetLearningGoal: intent.expectedPlayerReaction,
      recommendedGenome: "adaptive" as const,
      recommendedWeather: "clear" as const,
      recommendedLighting: "normal" as const,
      recommendedMusic: "ancient" as const,
      recommendedCamera: "wide" as const,
      recommendedCrowd: "silent" as const,
      recommendedHazards: [] as string[],
      recommendedNarrativeEvent: "WeatherChanged" as const,
      recommendedExperiment: null,
      confidence: intent.confidence,
      promptVersion: "v4",
    } as unknown as import("./GameDesignPlan").GameDesignPlan;
  }
}

function safeParse(text: string): unknown | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}
