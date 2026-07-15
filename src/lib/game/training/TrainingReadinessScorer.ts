// ============================================================================
// PHASE 9: TRAINING READINESS SCORE
//
// Produces a single 0..100 score with per-metric breakdown and
// actionable recommendations. Combines the existing TrainingReadinessExporter
// assessment with the new quality + balance + validation signals.
//
// Does NOT generate new datasets. Only assesses what's there.
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import type { Curriculum } from "./DatasetCurriculumBuilder";
import type { BenchmarkBundle } from "./BenchmarkBuilder";
import type { ValidationReport } from "./DatasetValidator";
import type { BalanceReport } from "./DatasetBalancer";
import type { DuplicateReport } from "./NearDuplicateDetector";

export interface ReadinessMetrics {
  datasetSize: number;              // 0..100
  coverage: number;                 // 0..100
  balance: number;                  // 0..100
  novelty: number;                  // 0..100
  duplicates: number;               // 0..100 (100 = none)
  quality: number;                  // 0..100
  confidence: number;               // 0..100
  generalization: number;           // 0..100 (does the benchmark set exist)
  validation: number;               // 0..100
}

export interface TrainingCostEstimate {
  totalTokens: number;
  estimatedHours: number;
  estimatedGpuCostUsd: number;
  recommendedGpu: string;
  recommendedEpochs: number;
}

export interface ReadinessReport {
  generatedAt: number;
  score: number;                    // 0..100
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  metrics: ReadinessMetrics;
  breakdown: { metric: string; score: number; weight: number; contribution: number }[];
  recommendations: string[];
  issues: string[];
  cost: TrainingCostEstimate;
  summary: string;
  jsonReport: string;
}

export interface ReadinessInputs {
  samples: GameDesignSample[];
  curriculum: Curriculum;
  benchmark: BenchmarkBundle;
  validation: ValidationReport;
  balanceReport: BalanceReport;
  duplicateReport: DuplicateReport;
  recommendedEpochs?: number;
}

const WEIGHTS: Record<keyof ReadinessMetrics, number> = {
  datasetSize: 0.10,
  coverage: 0.12,
  balance: 0.10,
  novelty: 0.08,
  duplicates: 0.10,
  quality: 0.18,
  confidence: 0.10,
  generalization: 0.07,
  validation: 0.15,
};

export class TrainingReadinessScorer {
  /**
   * Build the readiness report.
   */
  score(inputs: ReadinessInputs): ReadinessReport {
    const m = this.computeMetrics(inputs);
    const breakdown = (Object.keys(WEIGHTS) as (keyof ReadinessMetrics)[]).map(metric => {
      const v = m[metric];
      return { metric, score: v, weight: WEIGHTS[metric], contribution: v * WEIGHTS[metric] };
    });
    const score = Math.round(breakdown.reduce((a, b) => a + b.contribution, 0));
    const grade = this.gradeOf(score);
    const recommendations = this.recommend(m, inputs);
    const issues = this.collectIssues(m, inputs);
    const cost = this.estimateCost(inputs);
    const summary = this.summarise(score, grade, m, recommendations);
    return {
      generatedAt: Date.now(),
      score,
      grade,
      metrics: m,
      breakdown,
      recommendations,
      issues,
      cost,
      summary,
      jsonReport: JSON.stringify({
        generatedAt: Date.now(),
        score,
        grade,
        metrics: m,
        breakdown,
        recommendations,
        issues,
        cost,
      }, null, 2),
    };
  }

  // --------------------------------------------------------------------------
  // Per-metric scoring
  // --------------------------------------------------------------------------

  private computeMetrics(i: ReadinessInputs): ReadinessMetrics {
    const totalKept = i.curriculum.totalKeptSamples;
    const datasetSize = this.scoreDatasetSize(totalKept);
    const coverage = this.scoreCoverage(i.curriculum);
    const balance = Math.round((i.balanceReport.overallEntropy) * 100);
    const novelty = this.scoreNovelty(i.curriculum);
    const duplicates = this.scoreDuplicates(i.curriculum, i.duplicateReport);
    const quality = Math.round(this.avg(i.curriculum.rankerResult.ranked.map(r => r.overallQuality)) * 100);
    const confidence = Math.round(this.avg(i.curriculum.rankerResult.ranked.map(r => r.llmConfidence)) * 100);
    const generalization = this.scoreGeneralization(i.benchmark);
    const validation = i.validation.ok ? 100 : Math.max(0, 100 - i.validation.bySeverity.errors * 2);
    return {
      datasetSize, coverage, balance, novelty, duplicates,
      quality, confidence, generalization, validation,
    };
  }

  private scoreDatasetSize(n: number): number {
    if (n <= 0) return 0;
    if (n >= 2000) return 100;
    if (n >= 1000) return 90;
    if (n >= 500) return 80;
    if (n >= 200) return 60;
    if (n >= 100) return 40;
    if (n >= 50) return 20;
    return 10;
  }

  private scoreCoverage(c: Curriculum): number {
    // Coverage = how many curriculum levels are populated
    const populated = c.levels.filter(l => l.sampleCount > 0).length;
    return (populated / 4) * 100;
  }

  private scoreNovelty(c: Curriculum): number {
    const all = c.rankerResult.ranked;
    if (all.length === 0) return 0;
    return Math.round((this.avg(all.map(r => r.novelty)) * 0.5 + 0.5) * 100);
  }

  private scoreDuplicates(c: Curriculum, dup: DuplicateReport): number {
    // Higher is better. 100 means no duplicates.
    const totalIn = c.totalInputSamples;
    if (totalIn === 0) return 0;
    const removed = dup.exactDuplicates + dup.nearDuplicates;
    const ratio = removed / totalIn;
    if (ratio === 0) return 100;
    if (ratio < 0.1) return 90;
    if (ratio < 0.2) return 80;
    if (ratio < 0.4) return 60;
    if (ratio < 0.6) return 40;
    return 20;
  }

  private scoreGeneralization(b: BenchmarkBundle): number {
    const allPopulated = b.suites.every(s => s.sampleCount > 0);
    if (!allPopulated) return 50;
    if (b.holdoutSize < 100) return 60;
    return 100;
  }

  // --------------------------------------------------------------------------
  // Cost estimate
  // --------------------------------------------------------------------------

  private estimateCost(i: ReadinessInputs): TrainingCostEstimate {
    const total = i.curriculum.totalKeptSamples;
    const avgTokensPerSample = Math.round(
      this.avg(i.curriculum.rankerResult.ranked.map(r => {
        const input = JSON.stringify(r.sample.context).length;
        const output = JSON.stringify(r.sample.plan).length;
        return (input + output) / 4;
      })),
    );
    const totalTokens = total * avgTokensPerSample * (i.recommendedEpochs ?? 3);
    // A100-class GPU, ~200k tokens/sec training throughput on a 7-13B base
    const tokensPerSec = 200_000;
    const estimatedHours = totalTokens / tokensPerSec / 3600;
    // A100-80GB on-demand is roughly $2/hr
    const estimatedGpuCostUsd = Math.round(estimatedHours * 2 * 100) / 100;
    return {
      totalTokens,
      estimatedHours: Math.round(estimatedHours * 100) / 100,
      estimatedGpuCostUsd,
      recommendedGpu: "1x A100-80GB (or 1x H100)",
      recommendedEpochs: i.recommendedEpochs ?? 3,
    };
  }

  // --------------------------------------------------------------------------
  // Grading
  // --------------------------------------------------------------------------

  private gradeOf(score: number): ReadinessReport["grade"] {
    if (score >= 95) return "A+";
    if (score >= 85) return "A";
    if (score >= 75) return "B";
    if (score >= 65) return "C";
    if (score >= 50) return "D";
    return "F";
  }

  // --------------------------------------------------------------------------
  // Recommendations + issues
  // --------------------------------------------------------------------------

  private recommend(m: ReadinessMetrics, i: ReadinessInputs): string[] {
    const out: string[] = [];
    if (m.datasetSize < 80) {
      out.push("Collect at least 200 more high-quality samples before training.");
    }
    if (m.balance < 70) {
      out.push("Several dimensions are imbalanced. Consider targeted collection for under-represented buckets: " +
        i.balanceReport.flaggedBuckets.slice(0, 5).join(", "));
    }
    if (m.quality < 70) {
      out.push("Average quality is below 0.7. Increase confidence thresholds or improve the underlying LLM.");
    }
    if (m.confidence < 60) {
      out.push("LLM confidence is low. Consider upgrading the model or adding more context.");
    }
    if (m.novelty < 50) {
      out.push("Samples are very similar. Increase player behaviour diversity or add new chapters.");
    }
    if (m.duplicates < 80) {
      out.push("Duplicate rate is high. Tighten the contextHash / similarity threshold.");
    }
    if (m.generalization < 80) {
      out.push("Benchmark suite is incomplete. Add more samples to under-populated suites.");
    }
    if (m.validation < 100) {
      out.push("Validation has errors. Fix the schema/enum violations before training.");
    }
    if (m.coverage < 100) {
      out.push("Some curriculum levels are empty. Lower tier thresholds or collect more data.");
    }
    if (out.length === 0) {
      out.push("Dataset looks ready. Proceed to training.");
    }
    return out;
  }

  private collectIssues(m: ReadinessMetrics, i: ReadinessInputs): string[] {
    const out: string[] = [];
    if (i.validation.bySeverity.errors > 0) {
      out.push(`${i.validation.bySeverity.errors} validation error(s) detected.`);
    }
    if (i.balanceReport.imbalancesDetected > 0) {
      out.push(`${i.balanceReport.imbalancesDetected} imbalanced dimension(s) detected.`);
    }
    if (i.curriculum.levels.some(l => l.sampleCount === 0)) {
      const empty = i.curriculum.levels.filter(l => l.sampleCount === 0).map(l => l.id).join(",");
      out.push(`Empty curriculum level(s): ${empty}.`);
    }
    return out;
  }

  private summarise(score: number, grade: string, m: ReadinessMetrics, recs: string[]): string {
    return `Training readiness: ${score}/100 (${grade}). ` +
      `Dataset=${m.datasetSize} Coverage=${m.coverage} Balance=${m.balance} ` +
      `Quality=${m.quality} Confidence=${m.confidence} ` +
      `Validation=${m.validation} Generalization=${m.generalization}. ` +
      `Top recommendation: ${recs[0] ?? "Proceed to training."}`;
  }

  private avg(xs: number[]): number {
    if (xs.length === 0) return 0;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }
}
