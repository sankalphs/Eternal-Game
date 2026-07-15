// ============================================================================
// OFFLINE DISTILLATION — SHARED TYPES
//
// Reuses GameDesignSample from the gamedesigner module. The
// DistilledSample wrapper adds provenance: which candidate won, why,
// what temperatures were tried, and what the other candidates scored.
//
// We never modify the original GameDesignSample type — the distillation
// pipeline is a layer on top that emits DistilledSample records.
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import type { GameDesignPlan } from "../gamedesigner/GameDesignPlan";
import type { GameDesignQualityScore } from "../gamedesigner/GameDesignQualityEngine";

// ---- One candidate plan, with everything needed to score and rank it ----
export interface CandidatePlan {
  // Sequential index in the candidate batch (0-based)
  index: number;
  // The plan itself
  plan: GameDesignPlan;
  // Quality score from the GameDesignQualityEngine
  score: GameDesignQualityScore;
  // Absolute overall quality (0..1) — convenience for ranking
  overall: number;
  // Model self-reported confidence (plan.confidence)
  llmConfidence: number;
  // Generation parameters used for this candidate
  generation: {
    temperature: number;
    seed: number;
    promptVersion: string;
    modelId: string;
  };
  // Latency in ms
  latencyMs: number;
  // Whether the candidate passed schema validation
  validated: boolean;
  // Whether it fell back to the safe default
  fellback: boolean;
  // Validation errors
  errors: string[];
  // Validation warnings
  warnings: string[];
}

// ---- Provenance stored on a DistilledSample ----
export interface DistillationProvenance {
  // Total candidates generated for this context
  candidatesGenerated: number;
  // The winning candidate's index
  winnerIndex: number;
  // The winning candidate's overall quality
  winnerScore: number;
  // The runner-up's overall quality (or null if there was only one)
  runnerUpScore: number | null;
  // The quality of the original (pre-distillation) plan, if known
  originalScore: number | null;
  // Improvement: winnerScore − originalScore (can be negative if distillation downgraded)
  improvement: number;
  // Did the original plan win, or did a new candidate? "original" | "candidate" | "tied"
  winnerSource: "original" | "candidate" | "tied";
  // Distribution of candidate scores — useful for analysis
  scoreDistribution: {
    min: number;
    max: number;
    mean: number;
    stddev: number;
  };
  // The strategy used (temperature, seed, prompt, model)
  strategy: DistillationStrategyId;
  // The exact generation params tried
  generationParams: CandidateGenerationParams[];
  // Time taken for distillation of this sample
  totalLatencyMs: number;
}

// ---- Generation strategy ----
export type DistillationStrategyId = "temperature" | "seed" | "prompt" | "model" | "mixed";

export interface CandidateGenerationParams {
  index: number;
  temperature: number;
  seed: number;
  promptVersion: string;
  modelId: string;
}

// ---- Pipeline configuration ----
export interface DistillationConfig {
  // Number of candidates per context (5-10 recommended)
  numCandidates: number;
  // Temperature schedule. If null, uses the default schedule.
  temperatures: number[] | null;
  // Seed schedule. If null, deterministic per-sample seeds are used.
  seeds: number[] | null;
  // Prompt versions to rotate through. If null, uses the active version.
  promptVersions: string[] | null;
  // Whether to keep the original plan as one of the candidates
  includeOriginal: boolean;
  // Whether to require schema validation to win (skip invalids)
  requireValidation: boolean;
  // Maximum time per sample in ms. 0 = unlimited.
  perSampleTimeoutMs: number;
  // Whether to skip the sample if no candidate beats the original
  skipIfNoImprovement: boolean;
  // Random seed for the pipeline itself (used for tie-breaks and shuffling)
  seed: number;
  // Progress callback. Optional.
  onProgress?: (progress: DistillationProgress) => void;
}

export interface DistillationProgress {
  processed: number;
  total: number;
  currentSampleId: string;
  candidatesForCurrent: number;
  averageImprovement: number;
  winnersFromCandidates: number;
  winnersFromOriginal: number;
}

export const DEFAULT_DISTILLATION_CONFIG: DistillationConfig = {
  numCandidates: 5,
  // Standard Best-of-N temperature schedule: focus, slight variation, creative
  temperatures: [0.2, 0.4, 0.6, 0.8, 1.0],
  seeds: null,
  promptVersions: null,
  includeOriginal: true,
  requireValidation: true,
  perSampleTimeoutMs: 0,
  skipIfNoImprovement: false,
  seed: 12345,
};

// ---- A distilled sample (original sample + winner candidate + provenance) ----
export interface DistilledSample {
  // The original sample (untouched — original context preserved)
  original: GameDesignSample;
  // The winning plan (either the original or a new candidate)
  winner: {
    plan: GameDesignPlan;
    quality: GameDesignQualityScore;
    candidateIndex: number;
    source: "original" | "candidate" | "tied";
  };
  // Provenance
  provenance: DistillationProvenance;
  // Re-runnable: a re-distillation with a different seed should produce
  // a comparable but not identical result. The lineage tag lets us
  // group related distillations.
  lineageId: string;
  // Generation timestamp
  distilledAt: number;
}

// ---- The full distillation report ----
export interface DistillationReport {
  generatedAt: number;
  config: DistillationConfig;
  inputSamples: number;
  distilledSamples: number;
  skippedSamples: number;
  // Score statistics
  scoreStats: {
    originalMean: number;
    distilledMean: number;
    improvementMean: number;
    improvementStddev: number;
    improvementMin: number;
    improvementMax: number;
    pImproved: number;             // fraction of samples where distillation helped
    pIdentical: number;            // fraction where original won
    pDowngraded: number;           // fraction where distillation hurt
  };
  // Per-strategy breakdown
  winnersBySource: { original: number; candidate: number; tied: number };
  // Per-temperature breakdown
  winnersByTemperature: Record<string, number>;
  // Per-prompt-version breakdown
  winnersByPromptVersion: Record<string, number>;
  // Confidence in the distillation (average winner score)
  averageWinnerScore: number;
  // Tokens / time
  totalLatencyMs: number;
  averageLatencyPerSampleMs: number;
  // Sample lineage (for traceability)
  lineageId: string;
  // Markdown summary
  summary: string;
  jsonReport: string;
}
