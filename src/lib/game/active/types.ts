// ============================================================================
// ACTIVE LEARNING ENGINE — SHARED TYPES
//
// The student model only asks the teacher for examples where it is
// uncertain, disagrees with the historical plan, or performed poorly. This
// module defines the shared types for that loop. The result is a much
// smaller, higher-quality fine-tuning set per iteration — typically a few
// hundred samples instead of one hundred thousand.
//
// Reuses:
//   - GameDesignSample from gamedesigner/GameDesignDatasetLogger
//   - DistilledSample, DistillationConfig from distillation/types
//   - PlanComparison from gamedesigner/ReplayEvaluator
//
// We never modify the original sample type — the active learning engine is
// a layer on top that decides which samples get re-taught.
// ============================================================================

import type { GameDesignSample } from "../gamedesigner/GameDesignDatasetLogger";
import type { DistilledSample, DistillationConfig } from "../distillation/types";
import type { PlanComparison } from "../gamedesigner/ReplayEvaluator";

// ---- Why a sample was flagged for re-teaching ----
export type DisagreementReason =
  | "low_confidence"        // student was unsure about the original plan
  | "plan_disagreement"     // new student plan differs from historical plan
  | "bad_outcome"           // player lost, quit, or low engagement
  | "high_uncertainty"      // high entropy across top-K candidate plans
  | "novel_context"         // context far from the training distribution
  | "field_ambiguity";      // specific fields are unreliable (e.g. music, crowd)

// ---- A single scored candidate for re-teaching ----
export interface ScoredSample {
  sampleId: string;
  // Underlying sample (carried through for the teacher query)
  sample: GameDesignSample;
  // Composite 0..1 score (higher = more worth re-teaching)
  value: number;
  // The four raw signals (all 0..1)
  signals: {
    confidence: number;       // 1 - student confidence on the original plan
    disagreement: number;     // 1 - plan agreement with historical plan
    outcome: number;          // 1 - outcome quality (high = bad outcome)
    novelty: number;          // distance from training distribution
  };
  // Why we flagged it (may be multiple)
  reasons: DisagreementReason[];
  // Comparison vs the historical plan (if computed)
  comparison?: PlanComparison;
  // How many teacher queries we estimate this will cost
  estimatedTeacherCost: number;
}

// ---- Sampling strategy ----
export type SamplingStrategy =
  | "uncertainty"            // rank by confidence signal only
  | "disagreement"           // rank by plan-disagreement signal only
  | "outcome"                // rank by bad-outcome signal only
  | "hybrid"                 // weighted blend of all signals (default)
  | "diversity"              // MMR — pick a diverse subset
  | "rare_context";          // prefer rare contextHashes, then by value

// ---- Budget ----
export interface TeacherBudget {
  // Maximum number of teacher queries per active-learning round
  maxQueriesPerRound: number;
  // Maximum number of samples to consider in one round
  maxCandidates: number;
  // Minimum selection size (even if the queue is small, send at least this many)
  minSelectionSize: number;
  // Maximum ratio of selected samples to total pool (0..1)
  maxSelectionRatio: number;
  // Cap on total teacher latency in ms
  maxLatencyMs: number;
}

export const DEFAULT_TEACHER_BUDGET: TeacherBudget = {
  maxQueriesPerRound: 500,
  maxCandidates: 5000,
  minSelectionSize: 25,
  maxSelectionRatio: 0.05,
  maxLatencyMs: 30 * 60 * 1000, // 30 minutes
};

// ---- The per-round config ----
export interface ActiveLearningConfig {
  // Composite weighting of the four signals
  weights: {
    confidence: number;        // default 0.35
    disagreement: number;      // default 0.40
    outcome: number;           // default 0.20
    novelty: number;           // default 0.05
  };
  // Confidence threshold below which a sample is auto-flagged
  confidenceFloor: number;     // default 0.5
  // Outcome threshold above which a sample is auto-flagged as bad
  badOutcomeThreshold: number; // default 0.4
  // Plan-disagreement threshold above which the sample is auto-flagged
  disagreementFloor: number;   // default 0.3 (i.e. fieldAgreement < 0.7)
  // Sampling strategy
  strategy: SamplingStrategy;
  // Budget
  budget: TeacherBudget;
  // Distillation config to use when querying the teacher
  distillation?: DistillationConfig;
  // Diversity weight (only for "diversity" / "rare_context", 0..1)
  diversityWeight: number;
  // RNG seed for deterministic sampling
  seed: number;
}

export const DEFAULT_ACTIVE_LEARNING_CONFIG: ActiveLearningConfig = {
  weights: { confidence: 0.35, disagreement: 0.40, outcome: 0.20, novelty: 0.05 },
  confidenceFloor: 0.5,
  badOutcomeThreshold: 0.4,
  disagreementFloor: 0.3,
  strategy: "hybrid",
  budget: DEFAULT_TEACHER_BUDGET,
  distillation: undefined,
  diversityWeight: 0.3,
  seed: 42,
};

// ---- The result of one active-learning round ----
export interface ActiveLearningReport {
  // Round id (timestamp-based)
  roundId: string;
  generatedAt: number;
  // Pool size (samples considered)
  poolSize: number;
  // How many were scored (i.e. had a parseable plan)
  scored: number;
  // How many were selected for the teacher
  selected: number;
  // How many actually got a teacher response
  queried: number;
  // How many fell back (e.g. teacher failed or skipped)
  fellback: number;
  // Total teacher latency in ms
  totalLatencyMs: number;
  // Estimated teacher cost (sum of estimatedTeacherCost across selection)
  teacherCost: number;
  // Distribution of reasons samples were selected
  reasonBreakdown: Record<DisagreementReason, number>;
  // Value distribution: mean, p50, p95 of the selection
  valueStats: { mean: number; p50: number; p95: number; min: number; max: number };
  // The selected samples, sorted by value descending
  selection: ScoredSample[];
  // The teacher responses, paired by sampleId
  teachingSet: DistilledSample[];
  // Human-readable summary
  summary: string;
  // JSON dump (for tests / persistence)
  jsonReport: string;
}

// ---- Zero-valued reason tally (helper for the report builder) ----
export function emptyReasonBreakdown(): Record<DisagreementReason, number> {
  return {
    low_confidence: 0,
    plan_disagreement: 0,
    bad_outcome: 0,
    high_uncertainty: 0,
    novel_context: 0,
    field_ambiguity: 0,
  };
}
