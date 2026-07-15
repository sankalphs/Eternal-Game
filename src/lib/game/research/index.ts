// ============================================================================
// RESEARCH EVALUATION FRAMEWORK — PUBLIC API
//
// Publication-quality evaluation layer on top of the existing
// simulator. Reuses every system; never modifies gameplay, combat,
// physics, or AI.
//
//   PHASE 1  RatingSystem    — Elo + Glicko-2
//   PHASE 2  MatchupMatrix   — NxN matrix with CIs
//   PHASE 3  Bootstrap       — Bootstrap CIs (95% / 99%)
//   PHASE 4  LargeScaleBench — 500 / 1k / 5k / 10k / 25k+ per cell
//   PHASE 5  ParetoFrontier  — Multi-objective frontier
//   PHASE 6  SurvivalAnalysis — Kaplan-Meier, hazard ratios
//   PHASE 7  Clustering      — K-Means, Hierarchical, DBSCAN, PCA
//   PHASE 8  StatsTests      — t, MWU, chi-square, permutation, Cohen's d
//   PHASE 9  LearningCurves  — Convergence + plateau + collapse detection
//   PHASE 10 Dashboard       — Unified evaluation pipeline
//   PHASE 11 ExperimentTracker — UUID + git + config hash
//   PHASE 12 PerfMonitor     — CPU / memory / throughput / bottlenecks
//
// Reuses:
//   - simulator/ (SimulationRunner, BatchExecutor, BenchmarkSuite, StatisticsEngine)
//   - evolution/ (IGenome, createRandomGenome, genomeDistance, GENOME_SPECS)
//   - distillation/ (OfflineDistillationPipeline)
//   - active/ (ActiveLearningEngine)
//   - gamedesigner/ (ReplayEvaluator, GameDesignQualityEngine)
// ============================================================================

// PHASE 1 — Rating
export {
  RatingSystem, EloRating, Glicko2Rating,
  renderLeaderboardMd, renderLeaderboardCsv, renderLeaderboardJson,
  type RatingAlgorithm,
} from "./RatingSystem";

// PHASE 2 — Matchup Matrix
export {
  buildMatchupMatrix, makeSubjectAdapter,
  renderMatchupMatrixCsv, renderMatchupMatrixJson,
  renderMatchupMatrixMd, renderMatchupMatrixHeatmapSpec,
  DEFAULT_MATCHUP_MATRIX_CONFIG,
  type MatchupMatrixConfig, type SubjectAdapter,
} from "./MatchupMatrix";

// PHASE 3 — Bootstrap / Confidence Intervals
export {
  bootstrap, bootstrapWinRate, bootstrapMean, bootstrapMedian, bootstrapSum,
  proportionCi, meanCi, proportionDiffCi, cohensDCi, cohensH,
  bootstrapFightBatch,
  type FightBatchStats,
} from "./Bootstrap";

// PHASE 4 — Large Scale Bench
export { LargeScaleBench, type SubjectBenchmark, type LargeScaleBenchmarkReport } from "./LargeScaleBench";

// PHASE 5 — Pareto Frontier
export {
  computeParetoFrontier, dominates,
  renderParetoCsv, renderParetoJson, renderParetoMd, renderParetoPlotSpec,
  buildObjectiveMapFromBenchmark,
  DEFAULT_OBJECTIVES,
  type ObjectiveSpec,
} from "./ParetoFrontier";

// PHASE 6 — Survival Analysis
export {
  kaplanMeier, survivalFromFights, hazardRatio, logRankTest,
  renderSurvivalMd, renderSurvivalCsv, renderSurvivalJson, renderSurvivalPlotSpec,
} from "./SurvivalAnalysis";

// PHASE 7 — Clustering
export {
  genomeToFeatures, zNormalise, pca,
  kmeans, hierarchical, dbscan, silhouette, daviesBouldin,
  clusterGenomes,
  renderClustersJson, renderClustersMd, renderClustersPlotSpec,
  type ClusterOptions, type Linkage,
} from "./Clustering";

// PHASE 8 — Statistical Tests
export {
  tTest, pairedTTestResult, mannWhitneyU, chiSquare2x2, chiSquareGof,
  permutationTest, allTests,
} from "./StatsTests";

// PHASE 9 — Learning Curves
export {
  learningCurveFromSnapshots, learningCurveFromRaw, detectConvergence,
  renderLearningCurveMd, renderLearningCurveCsv, renderLearningCurveJson, renderLearningCurvePlotSpec,
} from "./LearningCurves";

// PHASE 10 — Dashboard
export {
  ResearchDashboard,
  SIMULATOR_NAME, SIMULATOR_VERSION,
  DEFAULT_DASHBOARD_CONFIG,
  type DashboardInput, type DashboardConfig,
} from "./Dashboard";

// PHASE 11 — Experiment Tracker
export {
  ExperimentTracker,
  sha256, canonicalize, uuid4,
} from "./ExperimentTracker";

// PHASE 12 — Performance Monitor
export {
  PerfMonitor, measureAsync,
  type PerfRunResult,
} from "./PerfMonitor";

// PHASE 13 — Project Eternal evaluation harness (baseline vs fine-tuned)
export {
  EvaluationHarness,
  DEFAULT_EVAL_CONFIG,
  type EvaluationConfig,
  type EvaluationReport,
  type ContextEvaluation,
} from "./EvaluationHarness";

// Shared types
export type {
  Subject, SubjectKind, Rating, RatingConfig,
  MatchupCell, MatchupMatrix,
  BootstrapResult, BootstrapConfig,
  LargeScaleBenchmarkConfig,
  ParetoPoint, ParetoFrontier,
  SurvivalPoint, SurvivalCurve, HazardRatio,
  ClusterAssignment, ClusterResult,
  TestResult,
  LearningCurvePoint, LearningCurve,
  ExperimentRecord,
  PerfMeasurement,
  ResearchReport,
} from "./types";
