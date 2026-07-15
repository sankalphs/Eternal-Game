// ============================================================================
// CANDIDATE GENERATOR
//
// Generates N candidate plans for a single context using a chosen
// diversity strategy. Reuses the existing GameDesigner (which itself
// reuses the model, prompt library, validator, and explanations).
//
// Strategies:
//   - temperature: vary the sampling temperature
//   - seed: vary the random seed
//   - prompt: vary the prompt version
//   - model: vary the model
//   - mixed: combine the above
//
// The original plan can optionally be included as one of the candidates
// (it is treated as temperature=0, seed=fixed, prompt=original).
// ============================================================================

import type { GameDesignContext } from "../gamedesigner/types";
import type { GameDesignPlan } from "../gamedesigner/GameDesignPlan";
import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import { GameDesignQualityEngine } from "../gamedesigner/GameDesignQualityEngine";
import type { GameDesigner } from "../gamedesigner/GameDesigner";
import type { PromptLibrary } from "../gamedesigner/PromptLibrary";
import type {
  CandidatePlan,
  CandidateGenerationParams,
  DistillationConfig,
  DistillationStrategyId,
} from "./types";
import { DEFAULT_DISTILLATION_CONFIG } from "./types";

export interface CandidateGeneratorDeps {
  designer: GameDesigner;
  promptLibrary: PromptLibrary;
  qualityEngine: GameDesignQualityEngine;
}

export class CandidateGenerator {
  private deps: CandidateGeneratorDeps;
  private quality: GameDesignQualityEngine;

  constructor(deps: CandidateGeneratorDeps) {
    this.deps = deps;
    this.quality = deps.qualityEngine;
  }

  /**
   * Generate candidates for a single context.
   * The original sample (if provided) is scored once as the "baseline".
   */
  async generate(params: {
    context: GameDesignContext;
    original?: GameDesignSample;
    config?: Partial<DistillationConfig>;
  }): Promise<{ candidates: CandidatePlan[]; baseline: CandidatePlan | null; strategy: DistillationStrategyId; generationParams: CandidateGenerationParams[] }> {
    const cfg: DistillationConfig = { ...DEFAULT_DISTILLATION_CONFIG, ...(params.config ?? {}) };
    const strategy = this.chooseStrategy(cfg);

    // 1. Compute the generation parameters for each candidate
    const generationParams = this.buildGenerationParams(strategy, cfg);

    // 2. Save the active prompt version so we can restore it later
    const originalPromptVersion = this.deps.promptLibrary.getActiveVersion();
    const originalModelId = this.deps.designer.deps.model.metadata().id;

    try {
      // 3. Generate the baseline (if includeOriginal)
      let baseline: CandidatePlan | null = null;
      if (params.original && cfg.includeOriginal) {
        baseline = this.scoreAsCandidate(
          params.original.plan,
          params.original,
          {
            index: -1,
            temperature: 0,
            seed: 0,
            promptVersion: params.original.promptVersion,
            modelId: params.original.modelId,
          },
          0,
        );
      }

      // 4. Generate each candidate
      const candidates: CandidatePlan[] = [];
      for (const gp of generationParams) {
        // Switch prompt version if needed
        if (gp.promptVersion !== this.deps.promptLibrary.getActiveVersion()) {
          this.deps.promptLibrary.setActiveVersion(gp.promptVersion);
        }

        const start = Date.now();
        let plan: GameDesignPlan;
        let validated = true;
        let fellback = false;
        let errors: string[] = [];
        let warnings: string[] = [];

        try {
          const design = await this.runWithParams(params.context, cfg, gp);
          plan = design.plan;
          validated = design.validated;
          fellback = design.fellback;
          errors = [...design.errors];
          warnings = [...design.warnings];
        } catch (e) {
          // Treat the failure as an emergency fallback so the pipeline
          // continues to score the rest of the batch.
          plan = emergencyFallbackPlan(gp.promptVersion);
          validated = false;
          fellback = true;
          errors = [`generation failed: ${(e as Error).message}`];
        }

        const latencyMs = Date.now() - start;
        const candidate: CandidatePlan = this.scoreAsCandidate(
          plan,
          params.original,
          gp,
          latencyMs,
        );
        candidate.validated = validated;
        candidate.fellback = fellback;
        candidate.errors = errors;
        candidate.warnings = warnings;
        candidates.push(candidate);
      }

      return { candidates, baseline, strategy, generationParams };
    } finally {
      // Always restore the original prompt version
      this.deps.promptLibrary.setActiveVersion(originalPromptVersion);
      // Model is set via the designer's setModel, but we don't have a
      // clean way to restore the previous one without a token. The
      // caller should reset the model if needed. (Default behavior is
      // the pipeline uses one model throughout.)
      void originalModelId;
    }
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * Build a `CandidatePlan` from a raw plan. Scoring reuses the existing
   * GameDesignQualityEngine — no duplication.
   */
  private scoreAsCandidate(
    plan: GameDesignPlan,
    original: GameDesignSample | undefined,
    gp: CandidateGenerationParams,
    latencyMs: number,
  ): CandidatePlan {
    // Build a synthetic sample for the quality engine. We need a context;
    // the original provides one. If the original is missing (shouldn't
    // happen), we use a minimal stub.
    const synthetic = original
      ? { ...original, plan, promptVersion: gp.promptVersion, modelId: gp.modelId, confidence: plan.confidence }
      : { plan, promptVersion: gp.promptVersion, modelId: gp.modelId } as unknown as GameDesignSample;
    const score = this.quality.score(synthetic);
    return {
      index: gp.index,
      plan,
      score,
      overall: score.overall,
      llmConfidence: plan.confidence,
      generation: {
        temperature: gp.temperature,
        seed: gp.seed,
        promptVersion: gp.promptVersion,
        modelId: gp.modelId,
      },
      latencyMs,
      validated: true,
      fellback: false,
      errors: [],
      warnings: [],
    };
  }

  /**
   * Run the designer once, with the per-candidate temperature / seed
   * stamped into the request. The designer's `design` method already
   * supports a custom requestId; we use the seed as the requestId so
   * downstream caches are stable.
   */
  private async runWithParams(
    context: GameDesignContext,
    _cfg: DistillationConfig,
    gp: CandidateGenerationParams,
  ): Promise<{
    plan: GameDesignPlan;
    validated: boolean;
    fellback: boolean;
    errors: string[];
    warnings: string[];
  }> {
    // We can't pass temperature to design() directly — it's a fixed
    // value on the designer's prompt build. Instead, we re-implement
    // the inference path here, honoring the per-candidate temperature.
    // This keeps the public GameDesigner API stable and lets us swap
    // models per-candidate.
    const prompt = this.deps.promptLibrary.buildPrompt(context, gp.promptVersion);
    const inference = await this.deps.designer.deps.model.infer({
      prompt: {
        system: prompt.system,
        developer: prompt.developer,
        user: prompt.user,
        outputSchema: prompt.outputSchema,
        fewShot: prompt.fewShot,
      },
      maxTokens: 1024,
      temperature: gp.temperature,
      requestId: `distill_${gp.index}_${gp.seed}`,
    });
    const text = inference.text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        plan: emergencyFallbackPlan(gp.promptVersion),
        validated: false,
        fellback: true,
        errors: ["no JSON in model output"],
        warnings: [],
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      return {
        plan: emergencyFallbackPlan(gp.promptVersion),
        validated: false,
        fellback: true,
        errors: [`JSON parse error: ${(e as Error).message}`],
        warnings: [],
      };
    }
    const result = this.deps.designer.deps.validator.validate(parsed, gp.promptVersion);
    if (!result) {
      return {
        plan: emergencyFallbackPlan(gp.promptVersion),
        validated: false,
        fellback: true,
        errors: ["schema validation failed"],
        warnings: [],
      };
    }
    return {
      plan: result.output,
      validated: result.errors.length === 0,
      fellback: false,
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  /**
   * Choose the diversity strategy based on what the user provided.
   */
  private chooseStrategy(cfg: DistillationConfig): DistillationStrategyId {
    if (cfg.promptVersions && cfg.promptVersions.length > 1) return "prompt";
    if (cfg.temperatures && cfg.temperatures.length > 1 && cfg.seeds && cfg.seeds.length > 1) return "mixed";
    if (cfg.temperatures && cfg.temperatures.length > 1) return "temperature";
    if (cfg.seeds && cfg.seeds.length > 1) return "seed";
    return "temperature";
  }

  /**
   * Build the per-candidate generation parameters. The schedules are
   * truncated or extended to match numCandidates.
   */
  private buildGenerationParams(strategy: DistillationStrategyId, cfg: DistillationConfig): CandidateGenerationParams[] {
    const activePrompt = this.deps.promptLibrary.getActiveVersion();
    const activeModel = this.deps.designer.deps.model.metadata().id;
    const out: CandidateGenerationParams[] = [];
    for (let i = 0; i < cfg.numCandidates; i++) {
      const temperature = cfg.temperatures
        ? cfg.temperatures[i % cfg.temperatures.length]
        : DEFAULT_DISTILLATION_CONFIG.temperatures![i % DEFAULT_DISTILLATION_CONFIG.temperatures!.length];
      const seed = cfg.seeds
        ? cfg.seeds[i % cfg.seeds.length]
        : cfg.seed + i;
      const promptVersion = cfg.promptVersions
        ? cfg.promptVersions[i % cfg.promptVersions.length]
        : activePrompt;
      out.push({
        index: i,
        temperature,
        seed,
        promptVersion,
        modelId: activeModel,
      });
    }
    return out;
  }
}

// ---- Pure helpers (exported for tests) ----
function emergencyFallbackPlan(promptVersion: string): GameDesignPlan {
  return {
    intent: "Engage the player with a baseline encounter.",
    reasoning: "Distillation candidate failed to parse. Safe default.",
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
