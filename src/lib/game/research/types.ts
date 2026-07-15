// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — SHARED TYPES
//
// Publishable-quality types for the academic-grade evaluation layer that
// sits on top of the existing simulator. All types are pure data so they
// can be serialized to JSON, CSV, or Markdown without further work.
//
// Reuses:
//   - IGenome from evolution/
//   - FightResult from simulator/
//   - DescriptiveStats from simulator/StatisticsEngine
// ============================================================================

import type { IGenome } from "../evolution/types";
import type { FightResult, SeriesResult } from "../simulator/MatchResult";
import type { DescriptiveStats } from "../simulator/StatisticsEngine";

// ----------------------------------------------------------------------------
// Subject types — anything that can fight
// ----------------------------------------------------------------------------

/** A participant in the evaluation (genome, student, teacher, archetype, ...). */
export type SubjectKind =
  | "ga_genome"           // Evolved by the GA
  | "student_model"       // Fine-tuned model
  | "teacher_model"       // Distilled teacher
  | "frozen_genome"       // Frozen (champion) genome
  | "player_archetype"    // Scripted archetype (AggressiveAgent, etc.)
  | "director_genome"     // Genome selected by the Director
  | "baseline"            // Frozen story opponent
  | "custom";             // Anything else (with a free-form id)

export interface Subject {
  /** Stable id. */
  id: string;
  /** Display name. */
  name: string;
  /** Kind. */
  kind: SubjectKind;
  /** Free-form version tag (e.g. "1.2.0", "champion-2024-01-15"). */
  version?: string;
  /** Optional description. */
  description?: string;
  /** Optional genome (only for ga_genome / frozen_genome / director_genome). */
  genome?: IGenome;
  /** Free-form metadata. */
  meta?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// PHASE 1: Rating
// ----------------------------------------------------------------------------

export interface Rating {
  /** Subject id. */
  subjectId: string;
  /** Rating (Elo scale, or Glicko-2 rating). */
  rating: number;
  /** Rating deviation (uncertainty). */
  ratingDeviation: number;
  /** Volatility (Glicko-2 only; 0 for Elo). */
  volatility: number;
  /** Number of wins. */
  wins: number;
  /** Number of losses. */
  losses: number;
  /** Number of draws. */
  draws: number;
  /** Total matches. */
  matches: number;
  /** Number of rated periods (Glicko-2). */
  ratedPeriods: number;
  /** When this rating was last updated. */
  lastUpdated: number;
}

export interface RatingConfig {
  /** Initial rating (Elo default 1500). */
  initialRating: number;
  /** Initial rating deviation (Glicko-2 default 350). */
  initialRd: number;
  /** Initial volatility (Glicko-2 default 0.06). */
  initialVolatility: number;
  /** Elo K-factor (default 32). */
  kFactor: number;
  /** Glicko-2 system constant tau (default 0.5). */
  tau: number;
  /** Convergence tolerance for phi* (default 1e-6). */
  convergenceEpsilon: number;
  /** Scale factor (default 173.7178). */
  scale: number;
}

export const DEFAULT_RATING_CONFIG: RatingConfig = {
  initialRating: 1500,
  initialRd: 350,
  initialVolatility: 0.06,
  kFactor: 32,
  tau: 0.5,
  convergenceEpsilon: 1e-6,
  scale: 173.7178,
};

// ----------------------------------------------------------------------------
// PHASE 2: Matchup matrix
// ----------------------------------------------------------------------------

export interface MatchupCell {
  /** Row subject id. */
  rowId: string;
  /** Column subject id. */
  colId: string;
  /** Number of matches in this cell. */
  n: number;
  /** Row subject's win rate (when playing as the row). */
  winRate: number;
  /** Average damage dealt by the row. */
  avgDamage: number;
  /** Average duration (s). */
  avgDuration: number;
  /** Average remaining HP of the row. */
  avgRemainingHp: number;
  /** Average adaptation score (duration stddev). */
  avgAdaptation: number;
  /** 95% CI on win rate. */
  winRateCi95: number;
  /** Standard error on win rate. */
  winRateSe: number;
  /** Statistical significance flag (vs 50% baseline). */
  pValue: number;
}

export interface MatchupMatrix {
  /** All subject ids. */
  subjectIds: string[];
  /** Cells. */
  cells: MatchupCell[];
  /** Symmetric flag — true if every (i,j) is the same as (j,i). */
  symmetric: boolean;
  /** Generated timestamp. */
  generatedAt: number;
}

// ----------------------------------------------------------------------------
// PHASE 3: Confidence intervals
// ----------------------------------------------------------------------------

export interface BootstrapResult {
  /** Point estimate. */
  estimate: number;
  /** Sample size. */
  n: number;
  /** Standard error. */
  standardError: number;
  /** Standard deviation. */
  standardDeviation: number;
  /** 95% CI (lower, upper). */
  ci95: [number, number];
  /** 99% CI (lower, upper). */
  ci99: [number, number];
  /** All bootstrap samples (for plotting). */
  bootstrapDistribution: number[];
  /** Mean of bootstrap. */
  bootstrapMean: number;
  /** Bias (bootstrapMean - estimate). */
  bias: number;
}

export interface BootstrapConfig {
  /** Number of bootstrap resamples. */
  resamples: number;
  /** RNG seed for reproducibility. */
  seed: number;
  /** Confidence levels. */
  confidenceLevels: number[];
}

export const DEFAULT_BOOTSTRAP_CONFIG: BootstrapConfig = {
  resamples: 1000,
  seed: 42,
  confidenceLevels: [0.95, 0.99],
};

// ----------------------------------------------------------------------------
// PHASE 4: Large-scale benchmark
// ----------------------------------------------------------------------------

export interface LargeScaleBenchmarkConfig {
  /** Matches per (subject × opponent) cell. */
  matchesPerCell: number;
  /** Checkpoint interval (in matches). */
  checkpointEvery: number;
  /** Parallel workers (0 = no workers). */
  workers: number;
  /** Optional resume from a checkpoint id. */
  resumeFrom?: string;
}

export const DEFAULT_LARGE_SCALE_CONFIG: LargeScaleBenchmarkConfig = {
  matchesPerCell: 1000,
  checkpointEvery: 5000,
  workers: 0,
};

// ----------------------------------------------------------------------------
// PHASE 5: Pareto frontier
// ----------------------------------------------------------------------------

export interface ParetoPoint {
  /** Subject id. */
  subjectId: string;
  /** Objective values (one per axis). */
  objectives: Record<string, number>;
  /** Whether this point is on the Pareto frontier. */
  isFrontier: boolean;
  /** Set of subjects that dominate this one. */
  dominatedBy: string[];
}

export interface ParetoFrontier {
  /** All evaluated points. */
  points: ParetoPoint[];
  /** Indices of frontier points. */
  frontierIndices: number[];
  /** Objective names. */
  objectiveNames: string[];
  /** Direction per objective (true = maximize). */
  maximize: Record<string, boolean>;
  /** Hypervolume (if computable in 2D/3D). */
  hypervolume: number | null;
  generatedAt: number;
}

// ----------------------------------------------------------------------------
// PHASE 6: Survival analysis
// ----------------------------------------------------------------------------

export interface SurvivalPoint {
  /** Time (s). */
  time: number;
  /** Number at risk at this time. */
  atRisk: number;
  /** Number of events (deaths). */
  events: number;
  /** Survival probability S(t). */
  survival: number;
  /** 95% CI on S(t). */
  ciLower: number;
  ciUpper: number;
  /** Cumulative hazard H(t). */
  hazard: number;
}

export interface SurvivalCurve {
  /** Subject id. */
  subjectId: string;
  /** Survival points. */
  points: SurvivalPoint[];
  /** Median survival time (s). */
  medianSurvival: number;
  /** Mean survival time (s). */
  meanSurvival: number;
  /** Total subjects. */
  n: number;
  /** Total events. */
  totalEvents: number;
}

export interface HazardRatio {
  /** Treatment subject id. */
  treatmentId: string;
  /** Reference subject id. */
  referenceId: string;
  /** Hazard ratio (treatment / reference). */
  hr: number;
  /** 95% CI on log(HR). */
  logHrCi95: [number, number];
  /** p-value (Wald test). */
  pValue: number;
}

// ----------------------------------------------------------------------------
// PHASE 7: Clustering
// ----------------------------------------------------------------------------

export interface ClusterAssignment {
  /** Subject id. */
  subjectId: string;
  /** Cluster index (-1 for noise in DBSCAN). */
  cluster: number;
  /** 2D coordinates after projection. */
  x: number;
  y: number;
  /** Distance to cluster centroid. */
  distanceToCentroid: number;
  /** Whether the subject is an outlier (DBSCAN noise). */
  isOutlier: boolean;
}

export interface ClusterResult {
  /** Cluster labels (one per subject). */
  assignments: ClusterAssignment[];
  /** Cluster centroids. */
  centroids: number[][];
  /** Number of clusters found. */
  k: number;
  /** Algorithm used. */
  algorithm: "kmeans" | "hierarchical" | "dbscan";
  /** Silhouette score (-1..1; higher = better). */
  silhouette: number;
  /** Inertia (kmeans) or null. */
  inertia: number | null;
  /** Davies-Bouldin index. */
  daviesBouldin: number;
  /** Named cluster labels (e.g. "aggressive", "counter"). */
  namedClusters: { cluster: number; name: string; memberIds: string[] }[];
  /** PCA components (n_features × n_components). */
  pcaComponents: number[][];
  /** Variance explained per component. */
  varianceExplained: number[];
}

// ----------------------------------------------------------------------------
// PHASE 8: Significance tests
// ----------------------------------------------------------------------------

export interface TestResult {
  /** Test name. */
  test: string;
  /** Test statistic. */
  statistic: number;
  /** p-value. */
  pValue: number;
  /** Significance flag (alpha = 0.05). */
  significant: boolean;
  /** Effect size (Cohen's d for means, etc.). */
  effectSize: number;
  /** 95% CI on the effect. */
  effectCi95: [number, number];
  /** Sample size. */
  n: number;
  /** Free-form interpretation. */
  interpretation: string;
}

// ----------------------------------------------------------------------------
// PHASE 9: Learning curves
// ----------------------------------------------------------------------------

export interface LearningCurvePoint {
  /** Generation / step. */
  generation: number;
  /** Best fitness. */
  bestFitness: number;
  /** Mean fitness. */
  meanFitness: number;
  /** Worst fitness. */
  worstFitness: number;
  /** Population diversity. */
  diversity: number;
  /** Mutation success rate. */
  mutationSuccess: number;
  /** Genome entropy. */
  entropy: number;
  /** Novelty (avg distance to nearest neighbour). */
  novelty: number;
}

export interface LearningCurve {
  /** Source id (e.g. experiment id). */
  id: string;
  /** Per-generation points. */
  points: LearningCurvePoint[];
  /** Convergence detection. */
  convergence: {
    converged: boolean;
    plateauGenerations: number;
    collapsed: boolean;
    collapseGeneration: number | null;
    /** Generation where best fitness was last improved. */
    lastImprovementGen: number;
    /** Total improvement over the run. */
    totalImprovement: number;
  };
}

// ----------------------------------------------------------------------------
// PHASE 11: Experiment tracking
// ----------------------------------------------------------------------------

export interface ExperimentRecord {
  /** UUID v4. */
  uuid: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Unix timestamp (ms). */
  timestampMs: number;
  /** Master seed. */
  seed: number;
  /** Git commit hash (if available). */
  gitCommit: string | null;
  /** Simulator version. */
  simulatorVersion: string;
  /** Config hash (sha-256 of canonicalized config). */
  configHash: string;
  /** Genome library version. */
  genomeLibraryVersion: string;
  /** Dataset version. */
  datasetVersion: string;
  /** Model version. */
  modelVersion: string;
  /** Configuration snapshot. */
  config: Record<string, unknown>;
  /** Notes. */
  notes?: string;
}

// ----------------------------------------------------------------------------
// PHASE 12: Performance
// ----------------------------------------------------------------------------

export interface PerfMeasurement {
  /** Label. */
  label: string;
  /** Matches per second. */
  matchesPerSec: number;
  /** CPU usage (0..1). */
  cpuUsage: number;
  /** Memory (bytes). */
  memoryBytes: number;
  /** Serialization time (ms). */
  serializationMs: number;
  /** Checkpoint write time (ms). */
  checkpointMs: number;
  /** Dataset generation throughput (samples/sec). */
  samplesPerSec: number;
  /** Total wall time (ms). */
  totalMs: number;
  /** When measured. */
  measuredAt: number;
}

// ----------------------------------------------------------------------------
// Aggregate report (PHASE 10 dashboard)
// ----------------------------------------------------------------------------

export interface ResearchReport {
  /** Generated timestamp. */
  generatedAt: number;
  /** Experiment record (PHASE 11). */
  experiment: ExperimentRecord;
  /** ELO leaderboard. */
  ratings: Rating[];
  /** Matchup matrix. */
  matchupMatrix: MatchupMatrix;
  /** Pareto frontier. */
  paretoFrontier: ParetoFrontier;
  /** Survival curves. */
  survival: SurvivalCurve[];
  /** Hazard ratios (pairwise). */
  hazardRatios: HazardRatio[];
  /** Cluster assignments. */
  clusters: ClusterResult;
  /** Statistical tests (pairwise). */
  tests: { pair: [string, string]; result: TestResult }[];
  /** Learning curves. */
  learningCurves: LearningCurve[];
  /** Per-subject benchmark metrics (with CIs). */
  benchmarks: { subjectId: string; metrics: Record<string, BootstrapResult> }[];
  /** Active learning efficiency. */
  activeLearning: {
    teacherQueries: number;
    agreementRate: number;
    studentImprovement: number;
    perRound: { round: number; agreement: number; improvement: number }[];
  } | null;
  /** Distillation improvement. */
  distillation: {
    originalScore: number;
    distilledScore: number;
    improvement: number;
    perSample: { id: string; before: number; after: number }[];
  } | null;
  /** Performance measurements. */
  performance: PerfMeasurement;
  /** Markdown export. */
  markdown: string;
  /** JSON export. */
  json: string;
}
