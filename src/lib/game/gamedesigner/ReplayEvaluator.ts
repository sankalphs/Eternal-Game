// ============================================================================
// PHASE 9: REPLAY EVALUATION
//
// Run historical (context, plan) pairs through a different (or the same)
// GameDesigner instance. Compare the old plan, the new plan, and the
// quality scores. Produce a structured evaluation report.
//
// This is the offline evaluation system. It does NOT need a running
// combat engine — it only needs stored GameDesignSamples.
// ============================================================================

import type { GameDesigner } from "./GameDesigner";
import { GameDesignQualityEngine, type GameDesignQualityScore } from "./GameDesignQualityEngine";
import type { GameDesignSample } from "./GameDesignDatasetLogger";
import type { GameDesignPlan } from "./GameDesignPlan";

export interface PlanComparison {
  sameEmotion: boolean;
  sameGenome: boolean;
  sameWeather: boolean;
  sameDifficulty: boolean;
  sameLighting: boolean;
  sameMusic: boolean;
  sameCamera: boolean;
  sameCrowd: boolean;
  sameHazards: boolean;
  sameNarrativeEvent: boolean;
  sameExperiment: boolean;
  fieldAgreement: number;    // 0..1 — fraction of fields that agree
  emotionDelta: number;      // 0..1 — distance in the emotion ordering
}

export interface ReplayResult {
  sampleId: string;
  oldPlan: GameDesignPlan;
  newPlan: GameDesignPlan;
  oldScore: GameDesignQualityScore;
  newScore: GameDesignQualityScore;
  comparison: PlanComparison;
  oldConfidence: number;
  newConfidence: number;
  improvement: number;       // newScore.overall - oldScore.overall (-1..1)
  agreement: number;         // fieldAgreement
  promptVersion: string;
  newModelId: string;
  latencyMs: number;
  fellback: boolean;
}

export interface ReplayReport {
  generatedAt: number;
  sourceModelId: string;
  newModelId: string;
  newPromptVersion: string;
  totalSamples: number;
  replayedSamples: number;
  meanImprovement: number;        // -1..1
  meanAgreement: number;          // 0..1
  agreementByField: Record<string, number>;
  improvementByVersion: Record<string, number>;
  improvementByOldQuality: { high: number; medium: number; low: number };
  improvementByChapter: Record<string, number>;
  results: ReplayResult[];
  summaryText: string;
}

const EMOTION_ORDER = [
  "wonder", "confidence", "suspicion", "curiosity", "determination",
  "fear", "rage", "hopelessness", "despair", "chaos", "isolation",
  "serene", "awe", "victory", "triumph",
];

export class ReplayEvaluator {
  private qualityEngine = new GameDesignQualityEngine();

  /**
   * Run `designer` over each sample's stored context. Compare old vs new.
   */
  async replay(params: {
    samples: GameDesignSample[];
    designer: GameDesigner;
    sourceModelId: string;
    newModelId: string;
  }): Promise<ReplayReport> {
    const { samples, designer, sourceModelId, newModelId } = params;
    const newPromptVersion = (designer.deps.promptLibrary as unknown as { getActiveVersion(): string }).getActiveVersion();
    const results: ReplayResult[] = [];
    let sumImprovement = 0;
    let sumAgreement = 0;
    const fieldCounts: Record<string, { agree: number; total: number }> = {};
    const byVersion: Record<string, number[]> = {};
    const byQuality: { high: number[]; medium: number[]; low: number[] } = { high: [], medium: [], low: [] };
    const byChapter: Record<string, number[]> = {};

    for (const sample of samples) {
      const design = await designer.design(sample.context, `replay_${sample.id}`);
      const oldScore = sample.quality ?? this.qualityEngine.score(sample);
      const newScore = this.qualityEngine.score({
        ...sample,
        plan: design.plan,
        confidence: design.plan.confidence,
        modelId: design.modelId,
        promptVersion: design.promptVersion,
        validated: design.validated,
        errors: design.errors,
        warnings: design.warnings,
        fellback: design.fellback,
      });

      const comparison = this.compare(sample.plan, design.plan);
      const improvement = newScore.overall - oldScore.overall;
      const agreement = comparison.fieldAgreement;

      results.push({
        sampleId: sample.id,
        oldPlan: sample.plan,
        newPlan: design.plan,
        oldScore,
        newScore,
        comparison,
        oldConfidence: sample.plan.confidence,
        newConfidence: design.plan.confidence,
        improvement,
        agreement,
        promptVersion: newPromptVersion,
        newModelId: design.modelId,
        latencyMs: design.latencyMs,
        fellback: design.fellback,
      });

      sumImprovement += improvement;
      sumAgreement += agreement;

      // Per-field agreement
      const fields: (keyof PlanComparison)[] = [
        "sameEmotion", "sameGenome", "sameWeather", "sameDifficulty",
        "sameLighting", "sameMusic", "sameCamera", "sameCrowd",
        "sameHazards", "sameNarrativeEvent", "sameExperiment",
      ];
      for (const f of fields) {
        const key = f as string;
        if (!fieldCounts[key]) fieldCounts[key] = { agree: 0, total: 0 };
        fieldCounts[key].total++;
        if (comparison[f]) fieldCounts[key].agree++;
      }

      // Group metrics
      if (!byVersion[sample.promptVersion]) byVersion[sample.promptVersion] = [];
      byVersion[sample.promptVersion].push(improvement);
      byQuality[oldScore.quality].push(improvement);
      const chapKey = sample.context.currentChapter?.chapterIndex?.toString() ?? "none";
      if (!byChapter[chapKey]) byChapter[chapKey] = [];
      byChapter[chapKey].push(improvement);
    }

    const meanImprovement = results.length > 0 ? sumImprovement / results.length : 0;
    const meanAgreement = results.length > 0 ? sumAgreement / results.length : 0;

    const agreementByField: Record<string, number> = {};
    for (const [k, v] of Object.entries(fieldCounts)) {
      agreementByField[k] = v.total > 0 ? v.agree / v.total : 0;
    }

    const avg = (xs: number[]) => xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const improvementByVersion: Record<string, number> = {};
    for (const [k, vs] of Object.entries(byVersion)) improvementByVersion[k] = avg(vs);
    const improvementByOldQuality = { high: avg(byQuality.high), medium: avg(byQuality.medium), low: avg(byQuality.low) };
    const improvementByChapter: Record<string, number> = {};
    for (const [k, vs] of Object.entries(byChapter)) improvementByChapter[k] = avg(vs);

    return {
      generatedAt: Date.now(),
      sourceModelId,
      newModelId,
      newPromptVersion,
      totalSamples: samples.length,
      replayedSamples: results.length,
      meanImprovement,
      meanAgreement,
      agreementByField,
      improvementByVersion,
      improvementByOldQuality,
      improvementByChapter,
      results,
      summaryText: this.formatSummary({
        generatedAt: Date.now(),
        sourceModelId, newModelId, newPromptVersion,
        totalSamples: samples.length, replayedSamples: results.length,
        meanImprovement, meanAgreement, agreementByField,
        improvementByVersion, improvementByOldQuality, improvementByChapter,
        results, summaryText: "",
      }),
    };
  }

  // --------------------------------------------------------------------------
  // Public — head-to-head plan comparison (used by distillation tie-breaks)
  // --------------------------------------------------------------------------

  /**
   * Compare two GameDesignPlans field-by-field. Returns a PlanComparison
   * with per-field booleans + fieldAgreement + emotionDelta.
   *
   * Public for use by the distillation pipeline's tie-breaker. This is
   * the same logic that the full replay() uses internally.
   */
  comparePlans(oldP: GameDesignPlan, newP: GameDesignPlan): PlanComparison {
    return this.compare(oldP, newP);
  }

  /**
   * Synchronous single-sample replay. Used by the offline distillation
   * pipeline for tie-breaks (full async replay is overkill for a
   * single pair). Compares the two samples' plans and returns the
   * PlanComparison. Does NOT run any LLM inference.
   */
  replaySync(a: { plan: GameDesignPlan; quality?: { overall: number } | null }, b: { plan: GameDesignPlan; quality?: { overall: number } | null }): PlanComparison {
    return this.compare(a.plan, b.plan);
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private compare(oldP: GameDesignPlan, newP: GameDesignPlan): PlanComparison {
    const hazardSet = (h: string[]) => h.slice().sort().join(",");
    const sameEmotion = oldP.targetEmotion === newP.targetEmotion;
    const sameGenome = oldP.recommendedGenome === newP.recommendedGenome;
    const sameWeather = oldP.recommendedWeather === newP.recommendedWeather;
    const sameDifficulty = oldP.targetDifficulty === newP.targetDifficulty;
    const sameLighting = oldP.recommendedLighting === newP.recommendedLighting;
    const sameMusic = oldP.recommendedMusic === newP.recommendedMusic;
    const sameCamera = oldP.recommendedCamera === newP.recommendedCamera;
    const sameCrowd = oldP.recommendedCrowd === newP.recommendedCrowd;
    const sameHazards = hazardSet(oldP.recommendedHazards) === hazardSet(newP.recommendedHazards);
    const sameNarrativeEvent = oldP.recommendedNarrativeEvent === newP.recommendedNarrativeEvent;
    const sameExperiment = (oldP.recommendedExperiment ?? null) === (newP.recommendedExperiment ?? null);

    const fields = [sameEmotion, sameGenome, sameWeather, sameDifficulty, sameLighting, sameMusic, sameCamera, sameCrowd, sameHazards, sameNarrativeEvent, sameExperiment];
    const fieldAgreement = fields.filter(Boolean).length / fields.length;

    const oe = EMOTION_ORDER.indexOf(oldP.targetEmotion);
    const ne = EMOTION_ORDER.indexOf(newP.targetEmotion);
    const emotionDelta = oe >= 0 && ne >= 0 ? Math.abs(oe - ne) / (EMOTION_ORDER.length - 1) : 0;

    return {
      sameEmotion, sameGenome, sameWeather, sameDifficulty,
      sameLighting, sameMusic, sameCamera, sameCrowd,
      sameHazards, sameNarrativeEvent, sameExperiment,
      fieldAgreement, emotionDelta,
    };
  }

  private formatSummary(r: ReplayReport): string {
    const dir = r.meanImprovement >= 0 ? "improved" : "regressed";
    return `Replayed ${r.replayedSamples}/${r.totalSamples} samples from ${r.sourceModelId} through ${r.newModelId} (prompt ${r.newPromptVersion}).\n` +
      `Mean quality ${dir} by ${(r.meanImprovement * 100).toFixed(2)}%. Mean field agreement: ${(r.meanAgreement * 100).toFixed(2)}%.\n` +
      `Strongest agreement: ${this.strongest(r.agreementByField, true)}. Weakest: ${this.strongest(r.agreementByField, false)}.\n` +
      `Per-version improvement: ${JSON.stringify(r.improvementByVersion)}.`;
  }

  private strongest(agreement: Record<string, number>, pickMax: boolean): string {
    let best = "";
    let bestVal = pickMax ? -1 : Infinity;
    for (const [k, v] of Object.entries(agreement)) {
      if ((pickMax && v > bestVal) || (!pickMax && v < bestVal)) {
        bestVal = v;
        best = `${k}=${(v * 100).toFixed(1)}%`;
      }
    }
    return best || "n/a";
  }
}
