// ============================================================================
// PHASE 7: CONFIDENCE ENGINE
//
// Every AI decision gets a confidence score (0..1). If confidence falls
// below a configurable threshold, the system falls back to deterministic
// rules. The game engine never receives a low-confidence plan.
// ============================================================================

import type { AIDirectorOutput, ConfidenceScoredOutput, ConfidenceScored } from "./types";

export interface ConfidenceConfig {
  minThreshold: number;       // below this → fallback
  warningThreshold: number;   // below this → flag but still use
  // Per-field weights for the overall score
  weights: {
    weather: number;
    bossStyle: number;
    difficulty: number;
    hazards: number;
    intent: number;
  };
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  minThreshold: 0.4,
  warningThreshold: 0.6,
  weights: {
    weather: 0.1,
    bossStyle: 0.3,
    difficulty: 0.25,
    hazards: 0.15,
    intent: 0.2,
  },
};

export class ConfidenceEngine {
  private config: ConfidenceConfig;

  constructor(config?: Partial<ConfidenceConfig>) {
    this.config = { ...DEFAULT_CONFIDENCE_CONFIG, ...config };
  }

  /**
   * Score the confidence of each field in the AI output.
   * Confidence is derived from:
   * 1. Whether the field was present in the original model output
   * 2. Whether it was in the allowed values (pre-validation)
   * 3. Whether it was a fallback (from the parser/validator)
   * 4. Model metadata (some models are more reliable than others)
   */
  score(
    output: AIDirectorOutput,
    parseWarnings: string[],
    validationWarnings: string[],
    modelReliability: number,  // 0..1, from model metadata
  ): ConfidenceScoredOutput {
    // Count how many warnings affected each field
    const fieldWarningCount: Record<string, number> = {};
    for (const w of [...parseWarnings, ...validationWarnings]) {
      // Crude field detection from warning text
      for (const field of ["weather", "lighting", "camera", "music", "crowd", "hazards", "bossStyle", "dialogueStyle", "difficulty", "arenaStage", "narrative", "intent"]) {
        if (w.toLowerCase().includes(field.toLowerCase())) {
          fieldWarningCount[field] = (fieldWarningCount[field] ?? 0) + 1;
        }
      }
    }

    const scoreField = (field: string): number => {
      const warnings = fieldWarningCount[field] ?? 0;
      // Base confidence from model reliability, reduced by warnings
      const base = modelReliability;
      const penalty = warnings * 0.25;
      return Math.max(0, Math.min(1, base - penalty));
    };

    const weather = scoreField("weather");
    const bossStyle = scoreField("bossStyle");
    const difficulty = scoreField("difficulty");
    const hazards = scoreField("hazards");
    const intent = scoreField("intent");

    // Overall = weighted average
    const overall =
      weather * this.config.weights.weather +
      bossStyle * this.config.weights.bossStyle +
      difficulty * this.config.weights.difficulty +
      hazards * this.config.weights.hazards +
      intent * this.config.weights.intent;

    // Check if any field fell back
    const fellback = overall < this.config.minThreshold;

    return {
      weather: { value: output.weather, confidence: weather },
      bossStyle: { value: output.bossStyle, confidence: bossStyle },
      difficulty: { value: output.difficulty, confidence: difficulty },
      hazards: { value: output.hazards, confidence: hazards },
      intent: { value: output.intent, confidence: intent },
      overall: Math.round(overall * 100) / 100,
      fellback,
    };
  }

  /**
   * If overall confidence is below threshold, produce a fallback plan
   * using deterministic rules (the CampaignPlanner's logic).
   */
  shouldFallback(scored: ConfidenceScoredOutput): boolean {
    return scored.overall < this.config.minThreshold;
  }

  getConfig(): ConfidenceConfig {
    return this.config;
  }
}
