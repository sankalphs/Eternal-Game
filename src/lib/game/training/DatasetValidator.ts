// ============================================================================
// PHASE 7: DATASET VALIDATION
//
// Pre-export gate. Verifies every sample is well-formed and rejects
// anything that would degrade a future fine-tune. Operates on raw
// JSONL strings OR on GameDesignSample arrays.
//
// Checks:
//   - No missing fields
//   - No invalid schema
//   - No invalid enums
//   - No empty explanations
//   - No low confidence samples
//   - No failed validation samples
//   - No malformed JSON
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import { ALLOWED_DESIGN_VALUES, GAME_DESIGN_OUTPUT_SCHEMA, type GameDesignPlan } from "../gamedesigner/GameDesignPlan";

export interface ValidationConfig {
  minConfidence: number;
  minQuality: number;
  requireExplanation: boolean;
  minExplanationLength: number;
  requireActualResult: boolean;
  requirePromptVersion: boolean;
  requireModelId: boolean;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  minConfidence: 0.4,
  minQuality: 0.4,
  requireExplanation: true,
  minExplanationLength: 20,
  requireActualResult: true,
  requirePromptVersion: true,
  requireModelId: true,
};

export interface ValidationIssue {
  sampleId: string | null;
  lineNumber: number | null;
  field: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationReport {
  generatedAt: number;
  totalChecked: number;
  passed: number;
  failed: number;
  warningCount: number;
  issues: ValidationIssue[];
  byCode: Record<string, number>;
  bySeverity: { errors: number; warnings: number };
  ok: boolean;
  summary: string;
  jsonReport: string;
}

export class DatasetValidator {
  private config: ValidationConfig;

  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  }

  /**
   * Validate a JSONL string (one JSON object per line). The schema
   * expected is the training-pair shape produced by
   * GameDesignDatasetLogger.toTrainingPair.
   */
  validateJsonl(jsonl: string): ValidationReport {
    const issues: ValidationIssue[] = [];
    const lines = jsonl.split("\n").filter(l => l.trim().length > 0);
    let passed = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        issues.push(this.issue(null, i + 1, "line", "MALFORMED_JSON", `Line ${i + 1} is not valid JSON: ${(e as Error).message}`, "error"));
        continue;
      }
      const recordIssues = this.validateTrainingPair(parsed as { input: string; output: string; metadata?: Record<string, unknown> });
      for (const iss of recordIssues) {
        iss.lineNumber = i + 1;
        issues.push(iss);
      }
      const errors = recordIssues.filter(x => x.severity === "error");
      if (errors.length === 0) passed++;
    }
    return this.buildReport(lines.length, passed, issues);
  }

  /**
   * Validate a list of GameDesignSamples.
   */
  validateSamples(samples: GameDesignSample[]): ValidationReport {
    const issues: ValidationIssue[] = [];
    let passed = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const sampleIssues = this.validateSample(s);
      for (const iss of sampleIssues) {
        issues.push(iss);
      }
      const errors = sampleIssues.filter(x => x.severity === "error");
      if (errors.length === 0) passed++;
    }
    return this.buildReport(samples.length, passed, issues);
  }

  // --------------------------------------------------------------------------
  // Sample-level validation
  // --------------------------------------------------------------------------

  private validateSample(s: GameDesignSample): ValidationIssue[] {
    const out: ValidationIssue[] = [];
    const ctx = s.context ?? null;
    const plan: GameDesignPlan | null = s.plan ?? null;

    if (!ctx) out.push(this.issue(s.id, null, "context", "MISSING_FIELD", "context is missing", "error"));
    if (!plan) out.push(this.issue(s.id, null, "plan", "MISSING_FIELD", "plan is missing", "error"));
    if (!s.id) out.push(this.issue(null, null, "id", "MISSING_FIELD", "sample id missing", "error"));
    if (!s.timestamp) out.push(this.issue(s.id, null, "timestamp", "MISSING_FIELD", "timestamp missing", "error"));
    if (this.config.requireModelId && !s.modelId) {
      out.push(this.issue(s.id, null, "modelId", "MISSING_FIELD", "modelId missing", "error"));
    }
    if (this.config.requirePromptVersion && !s.promptVersion) {
      out.push(this.issue(s.id, null, "promptVersion", "MISSING_FIELD", "promptVersion missing", "error"));
    }

    if (s.validated === false) {
      out.push(this.issue(s.id, null, "validated", "FAILED_VALIDATION", "sample marked as not validated", "error"));
    }
    if (s.fellback) {
      out.push(this.issue(s.id, null, "fellback", "FELLBACK", "sample used the fallback path", "error"));
    }
    if ((s.errors?.length ?? 0) > 0) {
      out.push(this.issue(s.id, null, "errors", "HAS_ERRORS", `sample has ${s.errors.length} error(s)`, "error"));
    }
    if (plan) {
      if (typeof plan.confidence !== "number") {
        out.push(this.issue(s.id, null, "plan.confidence", "INVALID_TYPE", "plan.confidence not a number", "error"));
      } else if (plan.confidence < this.config.minConfidence) {
        out.push(this.issue(s.id, null, "plan.confidence", "LOW_CONFIDENCE",
          `confidence ${plan.confidence.toFixed(2)} < ${this.config.minConfidence}`, "error"));
      }

      // Enum checks
      if (plan.recommendedWeather && !ALLOWED_DESIGN_VALUES.weather.includes(plan.recommendedWeather as never)) {
        out.push(this.issue(s.id, null, "plan.recommendedWeather", "INVALID_ENUM",
          `weather "${plan.recommendedWeather}" not in allowed set`, "error"));
      }
      if (plan.recommendedLighting && !ALLOWED_DESIGN_VALUES.lighting.includes(plan.recommendedLighting as never)) {
        out.push(this.issue(s.id, null, "plan.recommendedLighting", "INVALID_ENUM",
          `lighting "${plan.recommendedLighting}" not in allowed set`, "error"));
      }
      if (plan.recommendedMusic && !ALLOWED_DESIGN_VALUES.music.includes(plan.recommendedMusic as never)) {
        out.push(this.issue(s.id, null, "plan.recommendedMusic", "INVALID_ENUM",
          `music "${plan.recommendedMusic}" not in allowed set`, "error"));
      }
      if (plan.recommendedCamera && !ALLOWED_DESIGN_VALUES.camera.includes(plan.recommendedCamera as never)) {
        out.push(this.issue(s.id, null, "plan.recommendedCamera", "INVALID_ENUM",
          `camera "${plan.recommendedCamera}" not in allowed set`, "error"));
      }
      if (plan.recommendedCrowd && !ALLOWED_DESIGN_VALUES.crowd.includes(plan.recommendedCrowd as never)) {
        out.push(this.issue(s.id, null, "plan.recommendedCrowd", "INVALID_ENUM",
          `crowd "${plan.recommendedCrowd}" not in allowed set`, "error"));
      }
      if (plan.recommendedGenome && !ALLOWED_DESIGN_VALUES.bossStyle.includes(plan.recommendedGenome as never)) {
        out.push(this.issue(s.id, null, "plan.recommendedGenome", "INVALID_ENUM",
          `genome "${plan.recommendedGenome}" not in allowed set`, "error"));
      }
      if (plan.targetDifficulty && !ALLOWED_DESIGN_VALUES.difficulty.includes(plan.targetDifficulty as never)) {
        out.push(this.issue(s.id, null, "plan.targetDifficulty", "INVALID_ENUM",
          `difficulty "${plan.targetDifficulty}" not in allowed set`, "error"));
      }
      if (plan.targetEmotion && !ALLOWED_DESIGN_VALUES.emotion.includes(plan.targetEmotion as never)) {
        out.push(this.issue(s.id, null, "plan.targetEmotion", "INVALID_ENUM",
          `emotion "${plan.targetEmotion}" not in allowed set`, "error"));
      }
    }

    if (this.config.requireExplanation) {
      if (!s.explanation || s.explanation.length === 0) {
        out.push(this.issue(s.id, null, "explanation", "EMPTY_EXPLANATION", "explanation is empty", "error"));
      } else if (s.explanation.length < this.config.minExplanationLength) {
        out.push(this.issue(s.id, null, "explanation", "SHORT_EXPLANATION",
          `explanation length ${s.explanation.length} < ${this.config.minExplanationLength}`, "warning"));
      }
    }

    if (s.quality) {
      if (s.quality.overall < this.config.minQuality) {
        out.push(this.issue(s.id, null, "quality.overall", "LOW_QUALITY",
          `quality ${s.quality.overall.toFixed(2)} < ${this.config.minQuality}`, "warning"));
      }
    } else if (this.config.minQuality > 0) {
      out.push(this.issue(s.id, null, "quality", "MISSING_QUALITY", "quality score missing", "warning"));
    }

    if (this.config.requireActualResult) {
      if (!s.actualResult.engaged && s.actualResult.damageDealt === 0 && !s.actualResult.playerWon) {
        out.push(this.issue(s.id, null, "actualResult", "MISSING_RESULT", "no actual fight result recorded", "warning"));
      }
    }

    return out;
  }

  /**
   * Validate a parsed training-pair shape (used by validateJsonl).
   */
  private validateTrainingPair(pair: { input: string; output: string; metadata?: Record<string, unknown> }): ValidationIssue[] {
    const out: ValidationIssue[] = [];
    if (!pair || typeof pair !== "object") {
      out.push(this.issue(null, null, "pair", "MALFORMED_JSON", "record is not an object", "error"));
      return out;
    }
    if (typeof pair.input !== "string") {
      out.push(this.issue(null, null, "input", "INVALID_TYPE", "input must be a JSON string", "error"));
    } else {
      try {
        const ctx = JSON.parse(pair.input);
        if (!ctx || typeof ctx !== "object" || !("playerEstimate" in ctx) || !("plan" in (ctx as Record<string, unknown>))) {
          out.push(this.issue(null, null, "input", "MISSING_FIELDS", "input missing required context fields", "error"));
        }
      } catch {
        out.push(this.issue(null, null, "input", "MALFORMED_JSON", "input is not valid JSON", "error"));
      }
    }
    if (typeof pair.output !== "string") {
      out.push(this.issue(null, null, "output", "INVALID_TYPE", "output must be a JSON string", "error"));
    } else {
      try {
        const plan = JSON.parse(pair.output);
        const required: (keyof GameDesignPlan)[] = [
          "intent", "reasoning", "targetEmotion", "targetDifficulty",
          "targetLearningGoal", "recommendedGenome", "recommendedWeather",
          "recommendedLighting", "recommendedMusic", "recommendedCamera",
          "recommendedCrowd", "recommendedHazards", "recommendedNarrativeEvent",
          "confidence",
        ];
        for (const f of required) {
          if (!(f in plan)) {
            out.push(this.issue(null, null, `output.${f}`, "MISSING_FIELD", `output missing field "${f}"`, "error"));
          }
        }
      } catch {
        out.push(this.issue(null, null, "output", "MALFORMED_JSON", "output is not valid JSON", "error"));
      }
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Reporting
  // --------------------------------------------------------------------------

  private buildReport(total: number, passed: number, issues: ValidationIssue[]): ValidationReport {
    const errors = issues.filter(i => i.severity === "error");
    const warnings = issues.filter(i => i.severity === "warning");
    const byCode: Record<string, number> = {};
    for (const i of issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
    const ok = errors.length === 0;
    const summary = ok
      ? `Validation passed. ${total} records checked, ${warnings.length} warning(s).`
      : `Validation failed. ${errors.length} error(s) across ${total} records.`;
    return {
      generatedAt: Date.now(),
      totalChecked: total,
      passed,
      failed: total - passed,
      warningCount: warnings.length,
      issues,
      byCode,
      bySeverity: { errors: errors.length, warnings: warnings.length },
      ok,
      summary,
      jsonReport: JSON.stringify({
        generatedAt: Date.now(),
        totalChecked: total,
        passed,
        failed: total - passed,
        warningCount: warnings.length,
        byCode,
        bySeverity: { errors: errors.length, warnings: warnings.length },
        ok,
      }, null, 2),
    };
  }

  private issue(sampleId: string | null, lineNumber: number | null, field: string, code: string, message: string, severity: "error" | "warning"): ValidationIssue {
    return { sampleId, lineNumber, field, code, message, severity };
  }
}
