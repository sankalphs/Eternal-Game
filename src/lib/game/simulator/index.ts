// ============================================================================
// SIMULATOR — PUBLIC API
//
// Research Simulation Framework for Project Eternal. Headless, fully
// deterministic, no rendering, no React, no audio, no particles, no
// browser APIs. Reuses every existing system; never modifies it.
//
//   PHASE 1: HeadlessEngine    — bypass render/audio/particles
//   PHASE 2: SimulationRunner  — runFight / runSeries / runBatch / runTournament / runCampaign
//   PHASE 3: BatchExecutor     — large-scale with checkpoint + resume
//   PHASE 4: MatchTypes        — 7 match-type adapters
//   PHASE 5: BenchmarkSuite    — 17 metrics
//   PHASE 6: StatisticsEngine  — mean / CI / t-test / effect size / histogram / trend
//   PHASE 7: ExperimentManager — reproducible experiments
//   PHASE 8: CheckpointStore   — resume after interruption
//   PHASE 9: DatasetSink       — configurable sampling rates
//   PHASE 10: ReportWriter     — Markdown / JSON / CSV
//
// Architecture:
//   - Adapters wrap (never modify) the existing GameEngine, Fighter,
//     EnemyAI, EvolutionManager, CampaignPlanner, DirectorV3/V4.
//   - The combat engine is invoked identically to the live game, but
//     with VFX arrays drained each frame, audio never created, and
//     Math.random overridden by a deterministic Rng.
//   - Multi-million-fight batches run via setImmediate chunking + a
//     pluggable CheckpointIO (in-memory by default; Node fs via
//     `NodeFsIO`).
// ============================================================================

// PHASE 1 — Headless Engine
export {
  HeadlessEngine,
  EnemySideController,
  IdleSideController,
  defaultOpponent,
  defaultOpponents,
  DEFAULT_HEADLESS_CONFIG,
  type HeadlessEngineConfig,
  type SideController,
} from "./HeadlessEngine";

// Deterministic RNG
export {
  Rng,
  installMathRandom,
  uninstallMathRandom,
  isMathRandomInstalled,
  withDeterministicRandom,
} from "./Rng";

// Match result types
export {
  emptySideStats,
  type FightResult,
  type FightMetadata,
  type RoundResult,
  type SideStats,
  type SeriesResult,
  type SeriesAggregate,
  type MatchTypeId,
  type DirectorDecision,
} from "./MatchResult";

// PHASE 2 — Simulation Runner
export {
  SimulationRunner,
  createRunner,
  archetypeEntries,
  aggregateFights,
  type RunFightParams,
  type RunSeriesParams,
  type RunBatchParams,
  type RunTournamentParams,
  type RunCampaignParams,
  type CampaignDirector,
  type CampaignChapter,
  type CampaignResult,
  type TournamentEntry,
  type TournamentResult,
} from "./SimulationRunner";

// PHASE 3 — Batch Executor
export {
  BatchExecutor,
  constantMatchupBatch,
  DEFAULT_BATCH_CONFIG,
  type BatchConfig,
  type BatchProgress,
  type BatchResult,
  type CheckpointState,
} from "./BatchExecutor";

// PHASE 4 — Match Types
export {
  matchGaVsGa,
  matchGaVsArchetypes,
  matchStudentVsGa,
  matchStudentVsTeacher,
  matchStudentVsBaseline,
  matchDirectorV3VsV4,
  matchCampaignVsCampaign,
  V3DirectorAdapter,
  V4DirectorAdapter,
  STANDARD_ARCHETYPES,
  type GaVsGaParams,
  type GaVsArchetypesParams,
  type StudentVsGaParams,
  type StudentVsTeacherParams,
  type StudentVsBaselineParams,
  type DirectorComparisonParams,
  type CampaignVsCampaignParams,
} from "./MatchTypes";

// PHASE 5 — Benchmark Suite
export {
  BenchmarkSuite,
  type BenchmarkReport,
  type BenchmarkMetrics,
} from "./BenchmarkSuite";

// PHASE 6 — Statistics Engine
export {
  describe,
  sum,
  mean,
  median,
  percentile,
  variance,
  stddev,
  shannonEntropy,
  welchTTest,
  pairedTTest,
  cohensD,
  histogram,
  rollingAverage,
  linearTrend,
  correlation,
  correlationMatrix,
  type DescriptiveStats,
  type Histogram,
  type TrendResult,
} from "./StatisticsEngine";

// PHASE 7 — Experiment Manager
export {
  ExperimentManager,
  type Experiment,
  type ExperimentResults,
  type ExperimentComparison,
} from "./ExperimentManager";

// PHASE 8 — Checkpoint Store
export {
  CheckpointStore,
  InMemoryIO,
  NodeFsIO,
  type CheckpointIO,
} from "./CheckpointStore";

// PHASE 9 — Dataset Sink
export {
  DatasetSink,
  createOnePercentSink,
  createFivePercentSink,
  createTenPercentSink,
  createFullSink,
  createInterestingSink,
  DEFAULT_SINK_CONFIG,
  type DatasetKind,
  type DatasetSinkConfig,
  type SinkSample,
} from "./DatasetSink";

// PHASE 10 — Report Writer
export {
  renderMarkdownBenchmark,
  renderMarkdownExperiments,
  renderMarkdownCorrelation,
  renderJsonBenchmark,
  renderJsonExperiments,
  renderCsvBenchmark,
  renderCsvBenchmarkHeader,
  renderCsvBenchmarkRow,
  renderCsvSeries,
  renderTrainingRecommendations,
  buildReportBundle,
  type ReportBundle,
} from "./ReportWriter";
