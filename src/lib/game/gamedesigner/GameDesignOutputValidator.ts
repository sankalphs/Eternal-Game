// ============================================================================
// PHASE 2: GAME DESIGN OUTPUT VALIDATOR
//
// Validates a parsed GameDesignPlan against the schema. Returns a cleaned
// plan, list of warnings, and list of errors. The Director uses this as a
// gate — invalid plans are rejected and the Director falls back to its own
// deterministic planning.
// ============================================================================

import {
  GAME_DESIGN_OUTPUT_SCHEMA,
  ALLOWED_DESIGN_VALUES,
  type GameDesignPlan,
} from "./GameDesignPlan";

export interface ValidationResult {
  output: GameDesignPlan;
  errors: string[];
  warnings: string[];
}

export interface RawDesignOutput {
  intent?: unknown;
  reasoning?: unknown;
  targetEmotion?: unknown;
  targetIntensity?: unknown;
  targetDifficulty?: unknown;
  targetLearningGoal?: unknown;
  recommendedGenome?: unknown;
  recommendedWeather?: unknown;
  recommendedLighting?: unknown;
  recommendedMusic?: unknown;
  recommendedCamera?: unknown;
  recommendedCrowd?: unknown;
  recommendedHazards?: unknown;
  recommendedNarrativeEvent?: unknown;
  recommendedExperiment?: unknown;
  confidence?: unknown;
}

export class GameDesignOutputValidator {
  /**
   * Validate a raw parsed object against the GameDesignPlan schema.
   * Returns a cleaned plan, or null if the output is unusable.
   */
  validate(raw: unknown, promptVersion: string): ValidationResult | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const r = raw as RawDesignOutput;
    const errors: string[] = [];
    const warnings: string[] = [];

    const intent = this.string(r.intent, "intent", errors);
    const reasoning = this.string(r.reasoning, "reasoning", warnings);
    const targetEmotion = this.enum(r.targetEmotion, "targetEmotion", ALLOWED_DESIGN_VALUES.emotion, errors, "confidence");
    const targetIntensity = this.number(r.targetIntensity, "targetIntensity", 0, 1, errors, 0.5);
    const targetDifficulty = this.enum(r.targetDifficulty, "targetDifficulty", ALLOWED_DESIGN_VALUES.difficulty, errors, "normal");
    const targetLearningGoal = this.string(r.targetLearningGoal, "targetLearningGoal", warnings, "Engage the player.");
    const recommendedGenome = this.enum(r.recommendedGenome, "recommendedGenome", ALLOWED_DESIGN_VALUES.bossStyle, errors, "aggressive");
    const recommendedWeather = this.enum(r.recommendedWeather, "recommendedWeather", ALLOWED_DESIGN_VALUES.weather, errors, "clear");
    const recommendedLighting = this.enum(r.recommendedLighting, "recommendedLighting", ALLOWED_DESIGN_VALUES.lighting, errors, "normal");
    const recommendedMusic = this.enum(r.recommendedMusic, "recommendedMusic", ALLOWED_DESIGN_VALUES.music, errors, "ancient");
    const recommendedCamera = this.enum(r.recommendedCamera, "recommendedCamera", ALLOWED_DESIGN_VALUES.camera, errors, "wide");
    const recommendedCrowd = this.enum(r.recommendedCrowd, "recommendedCrowd", ALLOWED_DESIGN_VALUES.crowd, errors, "silent");
    const recommendedHazards = this.stringArray(r.recommendedHazards, "recommendedHazards", warnings);
    const recommendedNarrativeEvent = this.string(r.recommendedNarrativeEvent, "recommendedNarrativeEvent", warnings, "");
    const recommendedExperiment = this.optionalExperiment(r.recommendedExperiment, errors);
    const confidence = this.number(r.confidence, "confidence", 0, 1, errors, 0.5);

    if (errors.length > 5) {
      // Too many errors — reject entirely.
      return null;
    }

    const plan: GameDesignPlan = {
      intent: intent ?? "Engage the player.",
      reasoning: reasoning ?? "",
      targetEmotion: (targetEmotion ?? "confidence") as GameDesignPlan["targetEmotion"],
      targetIntensity: targetIntensity ?? 0.5,
      targetDifficulty: (targetDifficulty ?? "normal") as GameDesignPlan["targetDifficulty"],
      targetLearningGoal: targetLearningGoal ?? "Engage the player.",
      recommendedGenome: (recommendedGenome ?? "aggressive") as GameDesignPlan["recommendedGenome"],
      recommendedWeather: (recommendedWeather ?? "clear") as GameDesignPlan["recommendedWeather"],
      recommendedLighting: (recommendedLighting ?? "normal") as GameDesignPlan["recommendedLighting"],
      recommendedMusic: (recommendedMusic ?? "ancient") as GameDesignPlan["recommendedMusic"],
      recommendedCamera: (recommendedCamera ?? "wide") as GameDesignPlan["recommendedCamera"],
      recommendedCrowd: (recommendedCrowd ?? "silent") as GameDesignPlan["recommendedCrowd"],
      recommendedHazards: recommendedHazards ?? [],
      recommendedNarrativeEvent: recommendedNarrativeEvent ?? "",
      recommendedExperiment,
      confidence: confidence ?? 0.5,
      promptVersion,
    };

    return { output: plan, errors, warnings };
  }

  /**
   * Get the JSON schema description for embedding in the prompt.
   */
  schemaForPrompt(): string {
    return JSON.stringify(GAME_DESIGN_OUTPUT_SCHEMA, null, 2);
  }

  // --------------------------------------------------------------------------
  // Type-safe extractors
  // --------------------------------------------------------------------------

  private string(
    v: unknown,
    field: string,
    errors: string[],
    fallback?: string,
  ): string | null {
    if (typeof v === "string" && v.length > 0) return v;
    if (fallback !== undefined) {
      errors.push(`${field} missing — using fallback "${fallback}"`);
      return fallback;
    }
    errors.push(`${field} missing or wrong type`);
    return null;
  }

  private number(
    v: unknown,
    field: string,
    min: number,
    max: number,
    errors: string[],
    fallback: number,
  ): number {
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v < min || v > max) {
        errors.push(`${field} out of range [${min}, ${max}] — clamped`);
        return Math.max(min, Math.min(max, v));
      }
      return v;
    }
    errors.push(`${field} missing or not a number — using fallback ${fallback}`);
    return fallback;
  }

  private enum(
    v: unknown,
    field: string,
    allowed: readonly string[],
    errors: string[],
    fallback: string,
  ): string {
    if (typeof v === "string" && allowed.includes(v)) return v;
    errors.push(`${field} invalid value "${String(v)}" — using fallback "${fallback}"`);
    return fallback;
  }

  private stringArray(
    v: unknown,
    field: string,
    warnings: string[],
  ): string[] {
    if (Array.isArray(v)) {
      const out: string[] = [];
      for (const item of v) {
        if (typeof item === "string") out.push(item);
      }
      if (out.length !== v.length) {
        warnings.push(`${field} had non-string items — dropped`);
      }
      return out;
    }
    warnings.push(`${field} not an array — using []`);
    return [];
  }

  private optionalExperiment(
    v: unknown,
    errors: string[],
  ): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") {
      if (ALLOWED_DESIGN_VALUES.experiments.includes(v as never)) return v;
      errors.push(`recommendedExperiment "${v}" not in allowed list — dropped`);
      return null;
    }
    errors.push("recommendedExperiment wrong type — dropped");
    return null;
  }
}
