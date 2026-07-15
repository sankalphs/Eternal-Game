// ============================================================================
// PHASE 6: DATASET ANALYTICS DASHBOARD
//
// Produces both a structured JSON report and a dashboard-friendly
// chart description. All metrics are derived from the existing
// GameDesignSample type — no duplicated types.
//
// Reuses:
//   - extractBuckets (training/types)
//   - GameDesignQualityEngine (gamedesigner)
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import { GameDesignQualityEngine } from "../gamedesigner/GameDesignQualityEngine";
import { extractBuckets } from "./types";

export interface DistributionStat {
  bucket: string;
  count: number;
  share: number;        // 0..1
}

export interface ChartSpec {
  type: "bar" | "pie" | "line" | "scatter";
  title: string;
  unit?: string;
  data: Array<{ label: string; value: number }>;
  description: string;
}

export interface DatasetAnalyticsReport {
  generatedAt: number;
  totals: {
    samples: number;
    uniqueSamples: number;
    duplicates: number;
    duplicateRate: number;
    nearDuplicates: number;
    nearDuplicateRate: number;
    uniqueByContextHash: number;
  };
  distributions: {
    emotion: DistributionStat[];
    difficulty: DistributionStat[];
    genome: DistributionStat[];
    weather: DistributionStat[];
    narrative: DistributionStat[];
    campaign: DistributionStat[];
    promptVersion: DistributionStat[];
    model: DistributionStat[];
    quality: DistributionStat[];
  };
  metrics: {
    averageConfidence: number;
    averageQuality: number;
    averageTrainingValue: number;
    averageExplanationLength: number;
    averageTokensPerSample: number;
    estimatedFineTuningCostUsd: number;
  };
  charts: ChartSpec[];
  jsonReport: string;
}

export class DatasetAnalyticsDashboard {
  private quality = new GameDesignQualityEngine();

  /**
   * Build the full analytics report.
   */
  build(samples: GameDesignSample[], opts: { uniqueSamples?: GameDesignSample[]; nearDuplicates?: number } = {}): DatasetAnalyticsReport {
    const unique = opts.uniqueSamples ?? samples;
    const total = samples.length;
    const uniqueCount = unique.length;
    const contextHashes = new Set(samples.map(s => s.contextHash));
    const duplicates = total - contextHashes.size;
    const nearDuplicates = opts.nearDuplicates ?? 0;

    const buckets = unique.map(s => extractBuckets(s));
    const emotion = dist(buckets.map(b => b.emotion));
    const difficulty = dist(buckets.map(b => b.difficulty));
    const genome = dist(buckets.map(b => b.bossStyle));
    const weather = dist(buckets.map(b => b.weather));
    const narrative = dist(buckets.map(b => b.narrativeEvent));
    const campaign = dist(buckets.map(b => b.campaignStage));
    const promptVersion = dist(unique.map(s => s.promptVersion));
    const model = dist(unique.map(s => s.modelId));
    const qualityDist = dist(unique.map(s => s.quality?.quality ?? "low"));

    // Metrics
    const averageConfidence = avg(unique.map(s => s.plan.confidence));
    const averageQuality = avg(unique.map(s => s.quality?.overall ?? 0));
    const averageTrainingValue = avg(unique.map(s => trainingValue(s)));
    const averageExplanationLength = avg(unique.map(s => s.explanation?.length ?? 0));
    const averageTokensPerSample = Math.round(avg(unique.map(s => tokenEstimate(s))) / 4);
    const estimatedFineTuningCostUsd = estimateCost(unique.length, averageTokensPerSample);

    // Charts
    const charts: ChartSpec[] = [
      chartBar("Emotion Distribution", emotion),
      chartBar("Difficulty Distribution", difficulty),
      chartBar("Genome Style Distribution", genome),
      chartBar("Weather Distribution", weather),
      chartPie("Quality Distribution", qualityDist),
      chartBar("Prompt Version Distribution", promptVersion),
      chartBar("Model Distribution", model),
    ];

    const jsonReport = JSON.stringify({
      totals: {
        samples: total,
        uniqueSamples: uniqueCount,
        duplicates,
        duplicateRate: total > 0 ? duplicates / total : 0,
        nearDuplicates,
        nearDuplicateRate: total > 0 ? nearDuplicates / total : 0,
        uniqueByContextHash: contextHashes.size,
      },
      distributions: {
        emotion: distributionToRecord(emotion),
        difficulty: distributionToRecord(difficulty),
        genome: distributionToRecord(genome),
        weather: distributionToRecord(weather),
        narrative: distributionToRecord(narrative),
        campaign: distributionToRecord(campaign),
        promptVersion: distributionToRecord(promptVersion),
        model: distributionToRecord(model),
        quality: distributionToRecord(qualityDist),
      },
      metrics: {
        averageConfidence,
        averageQuality,
        averageTrainingValue,
        averageExplanationLength,
        averageTokensPerSample,
        estimatedFineTuningCostUsd,
      },
    }, null, 2);

    return {
      generatedAt: Date.now(),
      totals: {
        samples: total,
        uniqueSamples: uniqueCount,
        duplicates,
        duplicateRate: total > 0 ? duplicates / total : 0,
        nearDuplicates,
        nearDuplicateRate: total > 0 ? nearDuplicates / total : 0,
        uniqueByContextHash: contextHashes.size,
      },
      distributions: {
        emotion, difficulty, genome, weather, narrative, campaign, promptVersion, model, quality: qualityDist,
      },
      metrics: {
        averageConfidence, averageQuality, averageTrainingValue,
        averageExplanationLength, averageTokensPerSample,
        estimatedFineTuningCostUsd,
      },
      charts,
      jsonReport,
    };
  }
}

// ---- Pure helpers ----
function dist(values: string[]): DistributionStat[] {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  const total = values.length;
  return Object.entries(counts)
    .map(([bucket, count]) => ({ bucket, count, share: total > 0 ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
}

function distributionToRecord(d: DistributionStat[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of d) out[x.bucket] = x.count;
  return out;
}

function trainingValue(s: GameDesignSample): number {
  let v = 0.5;
  if (s.actualResult.engaged) v += 0.2;
  if (s.actualResult.damageDealt > 0 || s.actualResult.damageTaken > 0) v += 0.15;
  if (s.quality && s.quality.overall >= 0.7) v += 0.1;
  return Math.max(0, Math.min(1, v));
}

function tokenEstimate(s: GameDesignSample): number {
  // Approximate: 1 token per 4 chars of input+output
  const input = JSON.stringify(s.context).length;
  const output = JSON.stringify(s.plan).length;
  return input + output;
}

/**
 * Cost estimate. Uses a generic LoRA-fine-tune rate of $3 / 1M tokens
 * (representative of public-API rates as of 2026) plus a 1-epoch default.
 * Conservative, no commitment to any specific provider.
 */
function estimateCost(numSamples: number, avgTokensPerSample: number): number {
  const totalTokens = numSamples * avgTokensPerSample * 3; // 3 epochs default
  const usd = (totalTokens / 1_000_000) * 3.0;
  return Math.round(usd * 100) / 100;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---- Chart helpers ----
function chartBar(title: string, d: DistributionStat[]): ChartSpec {
  return {
    type: "bar",
    title,
    data: d.map(x => ({ label: x.bucket, value: x.count })),
    description: `Distribution of ${title.toLowerCase()}.`,
  };
}

function chartPie(title: string, d: DistributionStat[]): ChartSpec {
  return {
    type: "pie",
    title,
    data: d.map(x => ({ label: x.bucket, value: x.count })),
    description: `Share of ${title.toLowerCase()}.`,
  };
}
